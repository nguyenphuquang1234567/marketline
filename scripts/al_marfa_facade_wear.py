"""Bake weathering stamps and place them on the original Al Marfa plaster."""

import random

import bpy
import numpy as np

from al_marfa_materials import _packed_image, _scan, _smooth, _value_noise


TILE = 256
PAD = 6
ATLAS = TILE * 4
KINDS = ('flaked-lime', 'rain-trail', 'rising-damp', 'patched-render')
SURFACE_OFFSET = .0035
WALL_TO_FACE = .012


def _scan_pixels(name, space):
    image = _scan(name, space)
    width, height = image.size
    pixels = np.empty(height * width * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    return pixels.reshape((height, width, 4))[:, :, :3]


def _sample(image, u, v):
    height, width, _ = image.shape
    x = u * width - .5
    y = v * height - .5
    i = np.floor(x).astype(int)
    j = np.floor(y).astype(int)
    a = (x - i)[..., None]
    b = (y - j)[..., None]
    low = image[j % height, i % width] * (1. - a) + image[j % height, (i + 1) % width] * a
    high = image[(j + 1) % height, i % width] * (1. - a) + image[(j + 1) % height, (i + 1) % width] * a
    return low * (1. - b) + high * b


def _hairline(u, v, variant):
    """A fine crack wandering along the joins of an older mortar repair."""
    drift = .48 + .10 * np.sin(v * 5.3 + variant) + .023 * np.sin(v * 22. + 1.8 * variant)
    drift += .018 * (_value_noise(v * 15., v * .3, 518 + variant) - .5)
    width = (.0015 + .005 * np.sin(v * np.pi) ** 2)
    run = (1. - _smooth(width * .35, width * 1.42, np.abs(u - drift)))
    run *= _smooth(.09, .19, v) * (1. - _smooth(.67, .90, v))
    spur = np.abs(u - drift - np.maximum(v - .28, 0.) * .72)
    run = np.maximum(run, (1. - _smooth(.001, .004, spur)) * _smooth(.28, .36, v)
                     * (1. - _smooth(.47, .58, v)))
    return run


def _stamp(kind, variant, scans):
    size = TILE - 2 * PAD
    axis = (np.arange(size, dtype=np.float32) + .5) / size
    u, v = np.meshgrid(axis, axis)
    seed = 41 + variant * 17 + KINDS.index(kind) * 19
    soft = _value_noise(u * 4.8, v * 4.1, seed)
    broken = _value_noise(u * 17.3, v * 15.2, seed + 24)
    grit = _value_noise(u * 69., v * 76., seed + 117)
    grain = _value_noise(u * 161., v * 169., seed + 199)
    pad = _smooth(.014, .07, u) * (1. - _smooth(.93, .986, u))
    pad *= _smooth(.009, .066, v) * (1. - _smooth(.941, .99, v))

    clean = _sample(scans['plaster'], u * .58 + variant * .241, v * .64 + .181 * variant)
    brick = _sample(scans['damage'], u * .57 + .169 * variant, v * .67 + .237 * variant)
    brick_normal = _sample(scans['normal'], u * .57 + .169 * variant, v * .67 + .237 * variant)
    paint = np.array(((.84, .77, .66), (.79, .82, .78), (.91, .78, .65), (.79, .75, .71))[variant])
    normal_amount = np.zeros_like(u)

    if kind == 'flaked-lime':
        center = .47 + .14 * (soft - .5) + (variant - 1.5) * .041
        radius = np.hypot((u - center) / .39, (v - .48) / (.40 - variant * .023))
        edge = radius + .53 * (soft - .5) + .37 * (broken - .5) + .16 * (grit - .5)
        intact = 1. - _smooth(.78, .84, edge)
        exposed = 1. - _smooth(.65, .76, edge)
        specks = _smooth(.64, .88, broken * .40 + grit * .60)
        alpha = np.maximum(intact, specks * (1. - _smooth(.80, 1.10, edge)) * .6)
        # A thin light mortar shoulder sits above the exposed brick layer.
        shoulder = np.clip(intact - exposed, 0., 1.)
        color = clean * paint * .88 + shoulder[..., None] * np.array((.10, .09, .076))
        color = color * (1. - exposed[..., None]) + brick * (.94 + grit[..., None] * .15) * exposed[..., None]
        normal_amount = exposed * .69
        height = -.005 * exposed + .0011 * shoulder + grit * .00078
        rough = .78 + .13 * soft + .06 * exposed

    elif kind == 'rain-trail':
        # Dirt follows gravity below the sill and tapers into a discontinuous tail.
        warp = .028 * (soft - .5) + .019 * np.sin(v * 6.9 + variant)
        trail = _value_noise((u + warp) * (17. + variant * 3.), v * 2.7, seed + 3)
        wide = .25 + .20 * v
        source = np.exp(-((u - .50 + warp) / wide) ** 4)
        fall = _smooth(.06, .94, v) ** (1.2 + variant * .25)
        fingers = _smooth(.34, .83, trail * .72 + broken * .16 + grit * .12)
        tide = .6 + .4 * _smooth(.16, .82, soft)
        alpha = (fall * (.24 + .48 * fingers) * source * tide)
        cool = np.array(((.54, .48, .38), (.48, .53, .47), (.61, .46, .33), (.50, .48, .43))[variant])
        color = clean * cool * (.84 + .26 * grain[..., None])
        height = .00025 * (grain - .6 * fingers)
        rough = .72 + .17 * grit

    elif kind == 'rising-damp':
        tide = .44 + .28 * _value_noise(u * 5.6, v * 1.3, seed + 8) + .09 * broken
        pool = 1. - _smooth(tide - .21, tide + .03, v)
        mineral = (_smooth(tide - .04, tide + .015, v) - _smooth(tide + .019, tide + .11, v))
        mineral *= _smooth(.32, .72, broken * .44 + grit * .56)
        pockets = _smooth(.14, .81, soft * .7 + broken * .3)
        width = .24 + .14 * v + .19 * (soft - .5)
        reach = np.abs(u - (.52 + .10 * (soft - .5)))
        sides = 1. - _smooth(width * .55, width * 1.45, reach + .16 * (broken - .5))
        alpha = np.clip((pool * (.23 + .58 * pockets) + mineral * .57) * sides, 0., .80)
        pad = 1. - _smooth(.941, .99, v)
        damp = np.array(((.47, .45, .34), (.43, .50, .43), (.55, .45, .34), (.49, .48, .43))[variant])
        color = clean * damp * (.77 + .28 * grit[..., None])
        color = color * (1. - mineral[..., None]) + clean * paint * .95 * mineral[..., None]
        height = .00035 * grit + .00055 * mineral
        rough = .75 + .17 * broken + .06 * mineral

    else:
        center = .49 + .10 * (soft - .5)
        radius = np.hypot((u - center) / .46, (v - .53) / .42)
        boundary = radius + .36 * (soft - .5) + .26 * (broken - .5)
        repaired = 1. - _smooth(.69, 1.01, boundary)
        fine = _hairline(u, v, variant) * repaired
        trowel = _value_noise(u * 8.2 + v * 3.6, v * 3.8, seed + 66)
        oxidized = _smooth(.39, .84, soft * .72 + grit * .28)
        color = clean * paint * (.82 + .18 * trowel[..., None] - .10 * oxidized[..., None])
        color = color * (1. - fine[..., None] * .64)
        alpha = np.clip(repaired * (.44 + .31 * trowel) + fine * .6, 0., .94)
        height = -.0016 * fine + .00088 * trowel + .00034 * grit
        rough = .82 + .12 * broken

    rgba = np.ones((size, size, 4), dtype=np.float32)
    rgba[:, :, :3] = np.clip(color, .08, .92)
    rgba[:, :, 3] = alpha * pad
    packed = np.ones_like(rgba)
    packed[:, :, 1] = np.clip(rough, .55, .99)
    packed[:, :, 2] = 0.

    dy, dx = np.gradient(height, 1. / size)
    x = -dx * .62 + (brick_normal[:, :, 0] * 2. - 1.) * normal_amount
    y = -dy * .62 + (brick_normal[:, :, 1] * 2. - 1.) * normal_amount
    z = 1. - normal_amount + normal_amount * (brick_normal[:, :, 2] * 2. - 1.)
    norm = np.sqrt(x * x + y * y + z * z)
    tangent = np.ones_like(rgba)
    tangent[:, :, :3] = np.stack((x / norm, y / norm, z / norm), axis=2) * .5 + .5
    # Sparse atlases compress better and neutral gutters protect filtered seams.
    clear = rgba[:, :, 3] <= 1. / 255.
    rgba[clear] = (.48, .45, .40, 0.)
    packed[clear] = (1., .85, 0., 1.)
    tangent[clear] = (.5, .5, 1., 1.)
    return rgba, packed, tangent


def _material():
    scans = {
        'plaster': _scan_pixels('plaster-albedo', 'sRGB'),
        'damage': _scan_pixels('plaster-damage-albedo', 'sRGB'),
        'normal': _scan_pixels('plaster-damage-normal', 'Non-Color'),
    }
    atlases = [np.ones((ATLAS, ATLAS, 4), dtype=np.float32) for _ in range(3)]
    for row, kind in enumerate(KINDS):
        for variant in range(4):
            left = variant * TILE
            bottom = row * TILE
            region = np.s_[bottom:bottom + TILE, left:left + TILE]
            for layer, pixels in enumerate(_stamp(kind, variant, scans)):
                padded = np.pad(pixels, ((PAD, PAD), (PAD, PAD), (0, 0)), mode='edge')
                if layer == 0:
                    # Transparent gutter keeps mip sampling inside the active atlas island.
                    padded[:PAD, :, 3] = padded[-PAD:, :, 3] = 0.
                    padded[:, :PAD, 3] = padded[:, -PAD:, 3] = 0.
                atlases[layer][region] = padded
    material = bpy.data.materials.new('Al Marfa | Facade weathering atlas')
    material.use_backface_culling = True
    material.surface_render_method = 'BLENDED'
    tree = material.node_tree
    bsdf = next(node for node in tree.nodes if node.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Roughness'].default_value = .85
    color = tree.nodes.new('ShaderNodeTexImage')
    color.image = _packed_image('Facade weathering | Color and coverage', atlases[0], 'sRGB', alpha=True)
    packed = tree.nodes.new('ShaderNodeTexImage')
    packed.image = _packed_image('Facade weathering | ORM', atlases[1], 'Non-Color')
    normal = tree.nodes.new('ShaderNodeTexImage')
    normal.image = _packed_image('Facade weathering | OpenGL normal', atlases[2], 'Non-Color')
    for index, node in enumerate((color, packed, normal)):
        node.location = (-575, -265 * index)
        node.extension = 'EXTEND'
    channels = tree.nodes.new('ShaderNodeSeparateColor')
    channels.location = (-290, -265)
    normals = tree.nodes.new('ShaderNodeNormalMap')
    normals.location = (-290, -530)
    normals.inputs['Strength'].default_value = .78
    tree.links.new(color.outputs['Color'], bsdf.inputs['Base Color'])
    tree.links.new(color.outputs['Alpha'], bsdf.inputs['Alpha'])
    tree.links.new(packed.outputs['Color'], channels.inputs['Color'])
    tree.links.new(channels.outputs['Green'], bsdf.inputs['Roughness'])
    tree.links.new(normal.outputs['Color'], normals.inputs['Color'])
    tree.links.new(normals.outputs['Normal'], bsdf.inputs['Normal'])
    return material


def _pier_extents(facade):
    openings = sorted((opening for opening in facade['openings'] if opening['floor'] == 0),
                      key=lambda opening: opening['u'])
    left = -facade['width'] * .5 + .09
    ranges = []
    for opening in openings:
        right = opening['u'] - opening['w'] / 2. - .155
        if right - left >= .42:
            ranges.append((left, right))
        left = opening['u'] + opening['w'] / 2. + .155
    right = facade['width'] * .5 - .10
    if right - left >= .42:
        ranges.append((left, right))
    return ranges


def _sites(facade):
    rng = random.Random(9241 + 13567 * facade['id'])
    palette = (2, 1, 0, 2, 3, 2, 1, 2, 0, 3, 0, 1)[facade['id']]
    piers = _pier_extents(facade)
    rng.shuffle(piers)
    for index, (left, right) in enumerate(piers[:3]):
        span = right - left
        width = min(span * rng.uniform(.85, .99), rng.uniform(.65, 1.03))
        u = rng.uniform(left + width / 2., right - width / 2.)
        bottom = .005
        height = rng.uniform(.56, .91)
        yield 'rising-damp', palette, u, bottom, width, height
        if index <= 1:
            if facade['style'] == 'workshop':
                kind = 'flaked-lime' if index == 0 else 'patched-render'
            elif facade['style'] == 'tiled':
                kind = 'patched-render' if index == 0 else 'flaked-lime'
            else:
                kind = rng.choice(('flaked-lime', 'patched-render'))
            height = rng.uniform(.39, .81)
            width = min(span * .99, height * rng.uniform(.78, 1.60))
            u = rng.uniform(left + width / 2., right - width / 2.)
            bottom = rng.uniform(.98, min(1.66, 2.37 - height))
            yield kind, (palette + index) % 4, u, bottom, width, height

    for floor in range(1, facade['levels']):
        windows = [opening for opening in facade['openings']
                   if opening['floor'] == floor and not opening['balcony']]
        rng.shuffle(windows)
        for opening in windows[:max(1, len(windows) - 1)]:
            bottom = opening['bottom']
            height = rng.uniform(.49, .84)
            width = opening['w'] * rng.uniform(.57, .96)
            u = opening['u'] + rng.uniform(-.15, .15)
            yield 'rain-trail', (palette + opening['bay']) % 4, u, bottom - height - .008, width, height


def build(ctx):
    """Add wall-fitted texture decals to the twelve central market frontages."""
    material = _material()
    collection = ctx.collection('Exterior | Localized facade weathering')
    for facade in ctx.facades:
        side = 1. if facade['side'] == 'west' else -1.
        x = facade['faceX'] - side * (WALL_TO_FACE - SURFACE_OFFSET)
        y = -facade['centerZ']
        vertices, faces, uv = [], [], []
        for kind, variant, center, bottom, width, height in _sites(facade):
            first = len(vertices)
            left, right = center - width * .5, center + width * .5
            high = bottom + height
            vertices.extend((x, y + side * u, z) for u, z in
                            ((left, bottom), (right, bottom), (right, high), (left, high)))
            faces.append((first, first + 1, first + 2, first + 3))
            col, row = variant * TILE, KINDS.index(kind) * TILE
            lo_x, hi_x = (col + PAD + .5) / ATLAS, (col + TILE - PAD - .5) / ATLAS
            lo_y, hi_y = (row + PAD + .5) / ATLAS, (row + TILE - PAD - .5) / ATLAS
            uv.extend(((lo_x, lo_y), (hi_x, lo_y), (hi_x, hi_y), (lo_x, hi_y)))
        if not faces:
            continue
        name = f"Facade_Wear_{facade['id']:02}_{facade['side']}"
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(vertices, (), faces)
        mesh.update()
        layout = mesh.uv_layers.new(name='Weathering atlas')
        for loop, point in zip(layout.data, uv):
            loop.uv = point
        mesh.materials.append(material)
        obj = bpy.data.objects.new(name, mesh)
        collection.objects.link(obj)
        obj['worldCastShadow'] = False
        obj['worldReceiveShadow'] = True
