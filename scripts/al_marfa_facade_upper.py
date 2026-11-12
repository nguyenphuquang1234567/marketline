"""Rebuild Al Marfa's upper street elevations with editable window assemblies."""

from math import atan2, cos, pi, sin, tau
from random import Random

import bpy
from mathutils import Vector

from al_marfa_interiors import finish
from al_marfa_street import Fabrication, material


class ElevationMesh(Fabrication):
    """Local u runs along the wall, d projects toward the street, and z is up."""

    def __init__(self, collection, name, facade):
        super().__init__(collection, name)
        self.normal = 1 if facade['side'] == 'west' else -1
        self.face_x = facade['faceX']
        self.center_y = -facade['centerZ']
        self.hinge = None

    def append(self, verts, faces, mat, smooth=False):
        if self.hinge:
            u0, d0, turn = self.hinge
            c, s = cos(turn), sin(turn)
            verts = [
                (u0 + c*(u-u0) - s*(d-d0), d0 + s*(u-u0) + c*(d-d0), z)
                for u, d, z in verts
            ]
        # The facade frame looks out toward the street and is left-handed.
        super().append(
            [(self.face_x + self.normal*d, self.center_y + self.normal*u, z) for u, d, z in verts],
            [tuple(reversed(face)) for face in faces], mat, smooth,
        )

    def pipe(self, points, radius, mat, sides=8):
        """Sweep the section with a transported frame through bent ironwork."""
        centers = [Vector(point) for point in points]
        along = (centers[1] - centers[0]).normalized()
        ref = Vector((0, 1, 0)) if abs(along.y) < .9 else Vector((1, 0, 0))
        across = ref.cross(along).normalized()
        verts, faces = [], []
        for i, center in enumerate(centers):
            tangent = (centers[min(i + 1, len(centers) - 1)] - centers[max(0, i - 1)]).normalized()
            across = along.rotation_difference(tangent) @ across
            up = tangent.cross(across)
            along = tangent
            for j in range(sides):
                angle = tau*j/sides
                verts.append(center + radius*(cos(angle)*across + sin(angle)*up))
        for i in range(len(centers) - 1):
            for j in range(sides):
                a = i*sides+j
                b = i*sides+(j+1)%sides
                faces.append((a,b,b+sides,a+sides))
        smooth = set(range(len(faces)))
        faces.append(tuple(reversed(range(sides))))
        faces.append(tuple(range(len(verts) - sides, len(verts))))
        self.append(verts, faces, mat, smooth)


def upper_materials():
    colors = {
        'ecru': (199, 185, 157), 'sand': (172, 151, 120), 'slate': (124, 142, 141),
        'oak': (117, 88, 64), 'teal': (64, 108, 103), 'blue': (68, 100, 121),
        'red': (122, 72, 57), 'iron': (51, 57, 53), 'brass': (142, 111, 66),
        'linen': (184, 172, 147), 'reed': (157, 128, 88), 'terracotta': (149, 91, 65),
    }
    result = {
        key: finish('Elevation_' + key, colors[key], rough, metal, pattern, grain)
        for key, rough, metal, pattern, grain in (
            ('oak', .68, 0, 'grain', .48), ('teal', .71, 0, 'grain', .58),
            ('blue', .65, 0, 'grain', .56), ('red', .74, 0, 'grain', .48),
            ('iron', .58, .38, 'metal', .28), ('brass', .49, .65, None, 0),
            ('linen', .90, 0, 'woven', .46), ('reed', .82, 0, 'woven', .48),
            ('terracotta', .77, 0, 'ceramic', .43),
        )
    }
    for key in ('ecru', 'sand', 'slate'):
        color = tuple((channel / 255) ** 2.2 for channel in colors[key])
        result[key] = material('M_Elevation_' + key, color, .78, scan='limestone')
    result['interior'] = finish('Elevation_DarkReveal', (60, 57, 48), .9)
    result['seal'] = finish('Elevation_GlazingPutty', (65, 65, 56), .81)
    glass = finish('Elevation_DustyGlass', (145, 165, 167), .24)
    glass.surface_render_method = 'BLENDED'
    shader = next(node for node in glass.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
    shader.inputs['Alpha'].default_value = .24
    shader.inputs['IOR'].default_value = 1.46
    result['glass'] = glass
    return result


def reveal(mesh, u, bottom, top, width, stone, dark):
    """Line each opening and put the glass behind the projecting jamb."""
    z = (bottom + top) / 2
    h = top - bottom
    mesh.block((u, -.274, z), (width + .018, .038, h + .025), dark, .002)
    for side in (-1, 1):
        edge = u + side*(width/2 + .011)
        mesh.block((edge, -.074, z), (.083, .255, h + .012), stone, .008)
    for height in (bottom, top):
        mesh.block((u, -.070, height), (width - .060, .248, .076), stone, .006)


def curtain(mesh, u, bottom, top, width, cloth, side, half):
    half_width = width * (.38 if half else .47)
    start = u + side*width*.44
    verts, faces = [], []
    spans, rows = 18, 8
    for row in range(rows + 1):
        t = row / rows
        for span in range(spans + 1):
            q = span / spans
            fold = sin(q * 5.5*tau)
            # The fabric is pinched at the rod and opens toward the hem.
            x = start - side*q*half_width*(.86 + .14*t)
            height = top - .084 - t*(top - bottom - .15) + t**4*.017*fold
            verts.append((x, -.214 + .022*fold + .011*sin(3*q + t), height))
    for row in range(rows):
        for span in range(spans):
            i = row*(spans + 1) + span
            face = (i, i + spans + 1, i + spans + 2, i + 1)
            faces.append(face if side > 0 else tuple(reversed(face)))
    mesh.append(verts, faces, cloth, True)


def shutter(mesh, u, bottom, top, width, side, turn, paint, iron):
    h = top - bottom
    pivot = u + side*(width/2 + .011)
    depth = .115
    leaf = width*.47
    center = pivot + side*leaf/2
    mesh.hinge = (pivot, depth, side*turn)
    for x in (pivot + side*.032, pivot + side*(leaf - .032)):
        mesh.block((x, depth, (top + bottom)/2), (.067, .053, h - .046), paint, .006)
    for height in (bottom + .059, top - .056):
        mesh.block((center, depth, height), (leaf - .110, .052, .077), paint, .006)
    count = round((h - .19)/.068)
    for slat in range(count):
        height = bottom + .109 + slat*(h - .216)/(count - 1)
        # Tilt the solid slats to leave shadowed gaps.
        length = leaf - .129
        q = .027
        slope = .017
        verts = [
            (center + sx*length/2, depth + sd*q, height + sd*slope + sz*.011)
            for sz in (-1, 1) for sd in (-1, 1) for sx in (-1, 1)
        ]
        mesh.append(verts, [(0,2,3,1),(4,5,7,6),(0,1,5,4),(1,3,7,5),(3,2,6,7),(2,0,4,6)], paint)
    mesh.block((center, depth - .033, bottom + h*.39), (leaf - .110, .024, .045), paint, .004)
    for height in (bottom + .255, top - .244):
        mesh.block((pivot + side*.055, depth + .027, height), (.113, .025, .032), iron, .003)
    mesh.hinge = None
    for height in (bottom + .255, top - .244):
        mesh.pipe([(pivot, depth, height-.037), (pivot, depth, height+.037)], .015, iron, 6)


def crown(mesh, u, top, width, style, stone):
    if style == 'workshop':
        mesh.block((u, .049, top + .077), (width + .204, .148, .113), stone, .013)
        return
    mesh.block((u, .057, top + .054), (width + .255, .169, .083), stone, .012)
    mesh.block((u, .097, top + .106), (width + .317, .218, .036), stone, .007)
    if style == 'carved':
        height, radius = .117, width*.518
        count = 11
        for i in range(count):
            t = pi*(i + .5)/count
            span = pi*radius/count * .93
            mesh.block((u + radius*cos(t), .065, top + .127 + height*sin(t)),
                       (span, .123, .068), stone, .008,
                       angle=atan2(-height*cos(t), -radius*sin(t)))


def roller_shade(mesh, u, bottom, top, width, reed, iron, position):
    """A shallow cane roller attached to the top rail in selected service rooms."""
    length = (top - bottom) * position
    lower = top - length
    width -= .235
    d = -.130
    mesh.pipe([(u-width/2,d,top-.086),(u+width/2,d,top-.086)], .043, reed, 10)
    mesh.block((u,d-.015,(lower+top-.074)/2), (width,.012,top-.074-lower), reed, .002)
    for row in range(round((length-.09)/.024)):
        h = lower + .012 + row*.024
        mesh.pipe([(u-width/2,d-.002,h),(u+width/2,d-.002,h)], .005, reed, 6)
    mesh.pipe([(u-width/2,d,lower),(u+width/2,d,lower)], .014, iron, 8)


def window(mesh, panes, data, style, stone, paint, mats, rng):
    u, width = data['u'], data['w']
    bottom, top = data['bottom'], data['top']
    h = top - bottom
    z = (top + bottom)/2
    balcony = data['balcony']
    reveal(mesh, u, bottom, top, width, stone, mats['interior'])
    # A stepped sill with drip edge and sculpted return catches grazing light.
    mesh.block((u, .049, bottom - .051), (width + .225, .236, .108), stone, .012)
    mesh.block((u, .116, bottom + .006), (width + .302, .248, .049), stone, .009)
    mesh.block((u, .137, bottom - .023), (width + .268, .076, .020), stone, .003)
    crown(mesh, u, top, width, style, stone)

    inset = -.087
    for side in (-1, 1):
        jamb = u + side*(width/2 - .064)
        mesh.block((jamb, .020, z), (.092, .137, h - .110), stone, .008)
        mesh.block((jamb - side*.035, inset, z), (.077, .073, h - .117), paint, .005)
    for bar in (bottom + .057, top - .064):
        mesh.block((u, inset, bar), (width - .199, .074, .070), paint, .005)
    rail = top - (h*.29 if style in ('carved','tiled') else h*.50)
    mesh.block((u, inset + .003, rail), (width - .200, .068, .042), paint, .005)
    mesh.block((u, inset + .004, z), (.043, .061, h - .153), paint, .004)

    # The old random insert choice influences whether the house is shuttered,
    # glazed, curtained, or protected by ironwork.
    variant = data['variant']
    shutters = style != 'workshop' and (variant in (0, 2, 4) or balcony)
    if shutters:
        left_angle, right_angle = ((.13, .26), (.59, .98), (.11, .83))[rng.randrange(3)]
        if width > 1.4:
            left_angle *= .75
            right_angle *= .75
        shutter(mesh, u, bottom, top, width, -1, left_angle, paint, mats['iron'])
        shutter(mesh, u, bottom, top, width, 1, right_angle, paint, mats['iron'])
    if variant in (1, 3) and not balcony:
        for j in (-1, 0, 1):
            x = u + j*width*.236
            mesh.pipe([(x, .069, bottom + .094), (x, .109, bottom + .248),
                       (x, .109, top - .186), (x, .069, top - .079)], .010, mats['iron'], 6)
        for y in (bottom + h*.27, bottom + h*.76):
            mesh.block((u, .098, y), (width - .168, .028, .025), mats['iron'], .002)
    if variant != 3:
        if style == 'workshop' and variant in (0, 2, 4):
            roller_shade(mesh, u, bottom, top, width, mats['reed'], mats['iron'], rng.uniform(.52, .81))
        else:
            curtain_side = 1 if rng.random() < .5 else -1
            curtain(mesh, u, bottom, top, width - .12, mats['linen'], curtain_side, True)
            if variant == 4:
                curtain(mesh, u, bottom, top, width - .12, mats['linen'], -curtain_side, False)
    for side in (-1, 1):
        x = u + side*(width-.178)/4
        for a, b in ((bottom+.095, rail-.028),(rail+.028, top-.102)):
            pane_width = (width - .215)/2 - .020
            # A pane is a single face. A rear visible cavity gives it depth.
            vertices = [(x-pane_width/2, -.113, a), (x-pane_width/2, -.113, b),
                        (x+pane_width/2, -.113, b), (x+pane_width/2, -.113, a)]
            panes.append(vertices, [(0, 1, 2, 3)], mats['glass'])
        mesh.block((u + side*.061, inset + .037, rail - .079), (.027, .027, .061), mats['brass'], .005)


def iron_scroll(mesh, u, depth, bottom, height, iron, invert, spacing):
    lower = bottom + height*.50 - invert*.087
    mesh.pipe([(u-spacing/2,depth,lower), (u+spacing/2,depth,lower)], .009, iron, 6)
    for side in (-1, 1):
        p = []
        for i in range(15):
            t = i / 14
            a = -pi/2 + t*1.29*tau
            r = .087*(1 - .80*t)
            p.append((u + side*r*cos(a), depth, bottom + height*.50 + invert*r*sin(a)))
        mesh.pipe(p, .009, iron, 6)


def balcony(mesh, data, style, stone, mats, rng):
    width = data['balconyWidth']
    if not width:
        raise ValueError('A balcony needs its measured original slab width')
    u, y = data['u'], data['floor']*3.1 + .96
    half = width/2
    iron = mats['iron']
    decorative = style in ('carved', 'tiled')
    for d in (.263, 1.151):
        for side in (-1, 1):
            x = u + side*(half - .049)
            mesh.block((x, d, y + .116), (.094, .084, .031), iron, .004)
            mesh.pipe([(x, d, y+.117),(x, d, y+1.007)], .025, iron, 8)
            mesh.pipe([(x, d, y+.992),(x, d, y+1.027)], .032, iron, 8)
    for z in (y+.255, y+.953):
        mesh.block((u, 1.151, z), (width - .062, .062, .050), iron, .006)
        for side in (-1, 1):
            mesh.block((u + side*(half - .049), .643, z), (.044, 1.019, .045), iron, .005)
    divisions = max(9, round(width/.172))
    for j in range(1, divisions):
        x = u + (j/divisions - .5)*(width - .098)
        d = 1.151
        mesh.pipe([(x,d,y+.245), (x,d,y+.954)], .012, iron, 6)
        if decorative and j % 4 == 1:
            spacing = (width - .098)/divisions
            iron_scroll(mesh, x+spacing/2, d, y+.273, .67, iron, -1 if j%2 else 1, spacing)
    for side in (-1, 1):
        x = u + side*(half - .049)
        for d in (.42, .59, .76, .94):
            mesh.pipe([(x,d,y+.245),(x,d,y+.954)], .011, iron, 6)
        # Tie the underside of the inherited platform into the masonry.
        x = u + side*min(half*.71, .79)
        d = .77
        mesh.block((x, -.001, y - .202), (.205,.144,.355), stone, .021)
        mesh.block((x, .369, y - .126), (.205,.751,.104), stone, .019)
        mesh.pipe([(x,.031,y-.332),(x,.32,y-.290),(x,d,y-.133)], .022, iron, 8)
    if decorative and rng.random() < .78:
        plant_box(mesh, u - width*.32, .875, y+.111, mats, rng)


def plant_box(mesh, u, d, base, mats, rng):
    pots = mats['terracotta']
    mesh.block((u, d, base+.088), (.467,.205,.176), pots, .018)
    mesh.block((u, d, base+.172), (.488,.230,.043), pots, .009)
    mesh.block((u, d, base+.196), (.420,.161,.018), mats['interior'], .004)
    for stem in range(8):
        x = u + rng.uniform(-.18,.18)
        start = Vector((x,d+rng.uniform(-.04,.04),base+.202))
        tip = start + Vector((rng.uniform(-.07,.07),rng.uniform(-.07,.07),rng.uniform(.09,.20)))
        mesh.pipe([start, tip], .004, mats['leaves'], 5)
        for side in (-1, 1):
            a = start.lerp(tip, .54 if side<0 else .79)
            b = a + Vector((side*rng.uniform(.037,.073), rng.uniform(.013,.047), .034))
            mid = a.lerp(b, .53)
            mesh.append([a, mid+Vector((.010,0,.020)), b, mid-Vector((.010,0,.016))],
                        [(0,1,2,3)], mats['leaves'])


def roofline(mesh, facade, style, stone, mats, index):
    width = facade['width']
    top = facade['levels'] * 3.1
    # The original parapet faces remain as the structural substrate.
    edge = width/2 - .063
    if style in ('carved', 'tiled'):
        for y, d, extent, height in [
            (top+.620,.112,.148,.097),
            (top+.675,.152,.201,.071),
            (top+.726,.165,.233,.052),
        ]:
            mesh.block((0,d,y), (width+.057,extent,height), stone, .008)
        for j in range(round(width/.53)):
            x = -edge + (j+.5)*(2*edge/round(width/.53))
            mesh.block((x,.117,top+.548), (.139,.146,.128), stone, .012)
        if style == 'tiled' and index % 3 != 1:
            clay_eave(mesh, width, top, mats['terracotta'])
    else:
        # Only service buildings keep a plain stone weather cap and exposed
        # storm outlets. The recess beneath it reads at the next intersection.
        mesh.block((0,.122,top+.758), (width+.05,.245,.072), stone, .008)
        for side in (-1, 1):
            u = side*width*.343
            mesh.pipe([(u,.041,top+.430),(u,.222,top+.428),
                       (u,.293,top+.386)], .028, mats['iron'], 8)
            mesh.block((u,.052,top+.432), (.141,.075,.121), stone, .011)


def clay_eave(mesh, width, top, clay):
    # Shallow clay copings project over the street above the stone parapet.
    step = .225
    count = max(2, round(width/step))
    for tile in range(count):
        u = (tile + .5)*width/count - width/2
        radius = width/count*.46
        verts = []
        for d, z in ((-.154, top+.843),(.133, top+.830),(.345,top+.783)):
            for i in range(7):
                a = pi*i/6
                verts.append((u + radius*cos(a), d, z+.064*sin(a)))
        faces = []
        for row in range(2):
            for j in range(6):
                i = row*7 + j
                faces.append((i,i+7,i+8,i+1))
        # Shell with an open curved profile and enough thickness to cast a lip.
        rim = list(verts)
        rim.extend((x,d,z-.016) for x,d,z in verts)
        faces.extend(tuple(reversed(tuple(i+21 for i in face))) for face in faces[:])
        for i, j in [(0,7),(7,14),(6,13),(13,20)]:
            faces.append((i,j,j+21,i+21) if i%7 == 6 else (j,i,i+21,j+21))
        for j in range(6):
            faces.append((j,j+1,j+22,j+21))
            faces.append((15+j,14+j,35+j,36+j))
        mesh.append(rim, faces, clay, set(range(24)))


def build(ctx):
    mats = upper_materials()
    mats['leaves'] = finish('Elevation_Leaves', (69, 91, 49), .76)
    mats['leaves'].use_backface_culling = False
    mats['linen'].use_backface_culling = False
    mats['terracotta'].use_backface_culling = False
    collection = ctx.collection('Exterior | Rebuilt upper elevations')
    facades = ctx.facades
    if not facades:
        raise ValueError('Upper elevations require the measured facade layout')
    for index, facade in enumerate(facades):
        label = str(facade['id']).replace(' ', '_')
        mesh = ElevationMesh(collection, 'SM_Upper_' + label, facade)
        panes = ElevationMesh(collection, 'SM_UpperGlass_' + label, facade)
        style = facade['style']
        rng = Random(8023 + index*183)
        stone = mats['slate' if index in (1, 6, 11) else 'sand' if style == 'workshop' else 'ecru']
        paint = mats[('oak','teal','red','blue','oak','teal','blue','red','oak','blue','teal','red')[index%12]]
        for data in facade['openings']:
            if data['floor'] < 1:
                continue
            window(mesh, panes, data, style, stone, paint, mats, rng)
            if data['balcony']:
                balcony(mesh, data, style, stone, mats, rng)
        roofline(mesh, facade, style, stone, mats, index)
        mesh.finish(1.05)
        glass = panes.finish(.92)
        glass['worldCastShadow'] = False
        glass['worldReceiveShadow'] = True
