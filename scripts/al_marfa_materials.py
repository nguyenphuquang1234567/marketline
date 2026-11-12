"""Editable Blender weathering and web-ready street repair finishes."""

from math import cos, sin
from pathlib import Path

import bpy
import numpy as np


TEXTURES = Path(__file__).resolve().parents[1] / "src" / "assets" / "world-textures"

# Street drain positions and puddle extents in map meters (x, game z, rx, rz).
POOLS = (
    (-5.45, 39, 1.04, 2.9), (4.65, 32.9, 1.5, 3.2),
    (-4.60, 26.4, 1.02, 2.7), (5.62, 11.2, .73, 3.8),
    (-4.80, -16.1, 1.25, 3.2), (5.2, -39, .97, 3.4),
    (-29.4, 35.6, 1.18, 2.9), (29.9, 12, .87, 2.7),
)
MASK_MIN = (-34., -46.)
MASK_SPAN = (68., 92.)
REPAIRS = (
    (-.89, 42.21, 1.65, 2.37, .18), (2.16, 30.04, 1.32, 1.92, -.34),
    (-1.4, 7.45, 1.33, 1.72, -.17), (.61, -24.86, 1.92, 2.31, .32),
    (2.78, -44.07, 1.65, 2.24, -.32), (-28.5, 30.1, 1.87, 2.55, .25),
)
REPAIR_EDGE = (
    (-.50, -.38), (-.43, -.50), (.26, -.47), (.46, -.32), (.50, .24),
    (.34, .48), (-.18, .50), (-.41, .35),
)


def _smooth(lo, hi, value):
    unit = np.clip((value - lo) / (hi - lo), 0., 1.)
    return unit * unit * (3. - 2. * unit)


def _value_noise(x, y, seed):
    x, y = np.broadcast_arrays(x, y)
    ix, iy = np.floor(x), np.floor(y)
    u, v = _smooth(0., 1., x - ix), _smooth(0., 1., y - iy)

    def corner(dx, dy):
        phase = np.sin((ix + dx) * 127.1 + (iy + dy) * 311.7 + seed * 74.7) * 43758.5453
        return phase - np.floor(phase)

    low = corner(0, 0) * (1. - u) + corner(1, 0) * u
    high = corner(0, 1) * (1. - u) + corner(1, 1) * u
    return low * (1. - v) + high * v


def _packed_image(name, pixels, colorspace, alpha=False):
    height, width, _ = pixels.shape
    image = bpy.data.images.new(name, width=width, height=height, alpha=alpha)
    image.colorspace_settings.name = colorspace
    image.pixels.foreach_set(np.ascontiguousarray(pixels, dtype=np.float32).ravel())
    image.pack()
    return image


def _packed_water_mask():
    name = "Al Marfa · Drainage basins"
    if name in bpy.data.images:
        return bpy.data.images[name]
    # Evaluate only the compact footprint around each basin. Rows follow
    # Blender's bottom-up image convention, in the x/-game-z ground plane.
    size = 2048
    pixels = np.zeros((size, size, 4), dtype=np.float32)
    pixels[:, :, 3] = 1.
    for x, game_z, radius_x, radius_z in POOLS:
        y = -game_z

        def extent(center, radius, offset, span):
            return (
                max(0, int((center - radius * 1.42 - offset) * size / span)),
                min(size, int((center + radius * 1.42 - offset) * size / span) + 1),
            )

        left, right = extent(x, radius_x, MASK_MIN[0], MASK_SPAN[0])
        bottom, top = extent(y, radius_z, MASK_MIN[1], MASK_SPAN[1])
        px = MASK_MIN[0] + (np.arange(left, right)[None, :] + .5) * MASK_SPAN[0] / size
        py = MASK_MIN[1] + (np.arange(bottom, top)[:, None] + .5) * MASK_SPAN[1] / size
        bowl = ((px - x) / radius_x) ** 2 + ((py - y) / radius_z) ** 2
        bank = _value_noise(px * 2.6, py * 1.25, 42) - .5
        grit = _value_noise(px * 8.1, py * 8.1, 187) - .5
        coverage = 1. - _smooth(.52, 1.16, bowl + bank * .53 + grit * .18)
        patch = pixels[bottom:top, left:right, :3]
        np.maximum(patch, coverage[:, :, None], out=patch)
    return _packed_image(name, pixels, "Non-Color")


def _distance_to_segment(x, y, start, end):
    dx, dy = end[0] - start[0], end[1] - start[1]
    px, py = x - start[0], y - start[1]
    u = np.clip((px * dx + py * dy) / (dx * dx + dy * dy), 0., 1.)
    return np.hypot(px - u * dx, py - u * dy)


def _repair_stamp(index):
    """Bake an irregular tarred saw cut into small, portable texture maps."""
    size = 256
    coordinate = (np.arange(size, dtype=np.float32) + .5) / size * 1.12 - .56
    x, y = np.meshgrid(coordinate, coordinate)
    seed = (23, 127)[index]
    deformation = .0037 * (_value_noise(x * 91., y * 91., seed) - .5)
    fracture = np.full_like(x, np.inf)
    for start, end in zip(REPAIR_EDGE, REPAIR_EDGE[1:] + REPAIR_EDGE[:1]):
        edge = _distance_to_segment(x, y, start, end)
        np.minimum(fracture, edge, out=fracture)
    for start, end in (
        (((-.42, -.49), (-.39, -.534)), ((.36, .46), (.411, .486)))
        if index == 0 else
        (((-.47, -.17), (-.541, -.134)), ((.44, -.29), (.50, -.311)))
    ):
        edge = _distance_to_segment(x, y, start, end) * 1.8
        np.minimum(fracture, edge, out=fracture)
    coarse = _value_noise(x * 18., y * 19., seed + 1)
    crumbs = _value_noise(x * 197., y * 173., seed + 7)
    width = .0038 + .0051 * coarse
    saw = fracture + deformation
    coverage = 1. - _smooth(width * .37, width * 1.7, saw)
    coverage *= _smooth(.20, .48, coarse * .73 + crumbs * .27)
    core = 1. - _smooth(.0015, width, saw)
    bleed = 1. - _smooth(.017, .026, saw)

    albedo = np.empty((*x.shape, 4), dtype=np.float32)
    tone = .26 + .17 * crumbs + .05 * coarse - .098 * core
    tint = tone[:, :, None] * np.array((1.04, 1., .90))
    albedo[:, :, :3] = .30 + (tint - .30) * bleed[:, :, None]
    albedo[:, :, 3] = coverage
    roughness = np.ones_like(albedo)
    roughness[:, :, 0] = 1.
    roughness[:, :, 1] = .74 + (-.12 + .27 * crumbs - .19 * core) * bleed
    roughness[:, :, 2] = 0.

    height = -.0014 * core + .0003 * crumbs * coverage
    dy, dx = np.gradient(height, 1.12 / size)
    magnitude = np.sqrt(1. + dx * dx + dy * dy)
    normal = np.ones_like(albedo)
    normal[:, :, 0] = .5 - .5 * dx / magnitude
    normal[:, :, 1] = .5 - .5 * dy / magnitude
    normal[:, :, 2] = .5 + .5 / magnitude
    label = "Municipal saw cut " + ("A" if index == 0 else "B")
    return (
        _packed_image(f"{label} · Color", albedo, "sRGB", alpha=True),
        _packed_image(f"{label} · ORM", roughness, "Non-Color"),
        _packed_image(f"{label} · Tangent normal", normal, "Non-Color"),
    )


def _repair_material(index):
    albedo, orm, tangent = _repair_stamp(index)
    material = bpy.data.materials.new(f"Municipal saw cut {index + 1:02}")
    material.use_backface_culling = True
    tree = material.node_tree
    bsdf = next(node for node in tree.nodes if node.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Roughness"].default_value = .74
    maps = []
    for row, image in enumerate((albedo, orm, tangent)):
        sampler = tree.nodes.new("ShaderNodeTexImage")
        sampler.image = image
        sampler.extension = "EXTEND"
        sampler.location = (-640, -row * 285)
        maps.append(sampler)
    base, packed, detail = maps
    tree.links.new(base.outputs["Color"], bsdf.inputs["Base Color"])
    clip = tree.nodes.new("ShaderNodeMath")
    clip.operation = "GREATER_THAN"
    clip.inputs[1].default_value = .33
    clip.location = (-325, -65)
    tree.links.new(base.outputs["Alpha"], clip.inputs[0])
    tree.links.new(clip.outputs[0], bsdf.inputs["Alpha"])
    channels = tree.nodes.new("ShaderNodeSeparateColor")
    channels.location = (-325, -290)
    tree.links.new(packed.outputs["Color"], channels.inputs[0])
    tree.links.new(channels.outputs["Green"], bsdf.inputs["Roughness"])
    normal = tree.nodes.new("ShaderNodeNormalMap")
    normal.location = (-325, -510)
    normal.inputs["Strength"].default_value = .73
    tree.links.new(detail.outputs["Color"], normal.inputs["Color"])
    tree.links.new(normal.outputs["Normal"], bsdf.inputs["Normal"])
    return material


def build(ctx):
    """Add near-flush saw cuts fitted to the six existing utility repairs."""
    collection = ctx.collection("Exterior | Utility repair finishes")
    materials = [_repair_material(index) for index in range(2)]
    corners = ((-.56, -.56), (.56, -.56), (.56, .56), (-.56, .56))
    for index, (x, game_z, width, depth, angle) in enumerate(REPAIRS):
        cosine, sine = cos(angle), sin(angle)
        vertices = [
            (x + u * width * cosine - v * depth * sine,
             -game_z + u * width * sine + v * depth * cosine, .0038)
            for u, v in corners
        ]
        name = f"SM_Utility_Patch_Sealant_{index + 1:02}"
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(vertices, (), ((0, 1, 2, 3),))
        mesh.update()
        uv = mesh.uv_layers.new(name="Repair stamp UV")
        for loop, (u, v) in zip(uv.data, corners):
            loop.uv = (u / 1.12 + .5, v / 1.12 + .5)
        mesh.materials.append(materials[index % 2])
        mark = bpy.data.objects.new(name, mesh)
        collection.objects.link(mark)
        mark["worldCastShadow"] = False
        mark["worldReceiveShadow"] = True


class SurfaceGraph:
    """Build a labeled Blender node group around the imported PBR inputs."""

    def __init__(self, name):
        self.tree = bpy.data.node_groups.new(name, "ShaderNodeTree")
        self.depth = {}
        for name, socket_type in (
            ("Base Color", "NodeSocketColor"), ("Roughness", "NodeSocketFloat"),
            ("Normal", "NodeSocketVector"), ("Metallic", "NodeSocketFloat"), ("Amount", "NodeSocketFloat"),
        ):
            item = self.tree.interface.new_socket(name=name, in_out="INPUT", socket_type=socket_type)
            if name == "Amount":
                item.default_value = 1.
                item.min_value, item.max_value = 0., 1.
        self.inputs = self.node("NodeGroupInput", "Original scanned PBR")
        self.geometry = self.node("ShaderNodeNewGeometry", "World coordinates in meters")
        self.position = self.geometry.outputs["Position"]
        self.normal = self.geometry.outputs["Normal"]
        axis = self.node("ShaderNodeSeparateXYZ", "Height above street grade")
        self.put(self.position, axis.inputs[0])
        self.height = axis.outputs["Z"]
        axis_normal = self.node("ShaderNodeSeparateXYZ", "Surface orientation")
        self.put(self.normal, axis_normal.inputs[0])
        self.up = axis_normal.outputs["Z"]

    def node(self, node_type, label):
        node = self.tree.nodes.new(node_type)
        node.label = label
        self.depth[node] = 0
        return node

    def put(self, value, socket):
        if isinstance(value, bpy.types.NodeSocket):
            self.tree.links.new(value, socket)
            self.depth[socket.node] = max(self.depth[socket.node], self.depth[value.node] + 1)
        else:
            socket.default_value = value

    def math(self, operation, a, b=None, label=""):
        node = self.node("ShaderNodeMath", label)
        node.operation = operation
        self.put(a, node.inputs[0])
        if b is not None:
            self.put(b, node.inputs[1])
        return node.outputs[0]

    def vector(self, operation, a, b, label=""):
        node = self.node("ShaderNodeVectorMath", label)
        node.operation = operation
        self.put(a, node.inputs[0])
        self.put(b, node.inputs[1])
        return node.outputs[0]

    def scale_vector(self, vector, scale, label=""):
        node = self.node("ShaderNodeVectorMath", label)
        node.operation = "SCALE"
        self.put(vector, node.inputs[0])
        self.put(scale, node.inputs["Scale"])
        return node.outputs[0]

    def ramp(self, value, bounds, output=(0., 1.), label=""):
        node = self.node("ShaderNodeMapRange", label)
        node.clamp = True
        node.interpolation_type = "SMOOTHSTEP"
        self.put(value, node.inputs["Value"])
        node.inputs["From Min"].default_value, node.inputs["From Max"].default_value = bounds
        node.inputs["To Min"].default_value, node.inputs["To Max"].default_value = output
        return node.outputs[0]

    def noise(self, scale, detail, label):
        coords = self.vector("MULTIPLY", self.position, scale)
        node = self.node("ShaderNodeTexNoise", label)
        self.put(coords, node.inputs["Vector"])
        node.inputs["Scale"].default_value = 1.
        node.inputs["Detail"].default_value = detail
        return node.outputs["Fac"]

    def tint(self, original, color, factor, label):
        node = self.node("ShaderNodeMixRGB", label)
        node.blend_type = "MULTIPLY"
        for value, socket in zip((factor, original, color), node.inputs):
            self.put(value, socket)
        return node.outputs[0]

    def mix_color(self, base, finish, factor, label):
        node = self.node("ShaderNodeMixRGB", label)
        for value, socket in zip((factor, base, finish), node.inputs):
            self.put(value, socket)
        return node.outputs[0]

    def mix_float(self, base, finish, factor, label):
        node = self.node("ShaderNodeMix", label)
        node.data_type = "FLOAT"
        for value, socket_index in zip((factor, base, finish), (0, 2, 3)):
            self.put(value, node.inputs[socket_index])
        return node.outputs[0]

    def texture(self, image, coords, label, clip=False):
        node = self.node("ShaderNodeTexImage", label)
        node.image = image
        if clip:
            node.extension = "CLIP"
        self.put(coords, node.inputs["Vector"])
        return node.outputs["Color"]

    def normal_map(self, color, strength, label):
        node = self.node("ShaderNodeNormalMap", label)
        self.put(color, node.inputs["Color"])
        self.put(strength, node.inputs["Strength"])
        return node.outputs["Normal"]

    def bump(self, original, height, strength, distance, label):
        node = self.node("ShaderNodeBump", label)
        self.put(original, node.inputs["Normal"])
        self.put(height, node.inputs["Height"])
        self.put(strength, node.inputs["Strength"])
        node.inputs["Distance"].default_value = distance
        return node.outputs["Normal"]

    def finish(self, **outputs):
        result = self.node("NodeGroupOutput", "Weathered surface")
        for name, (socket_type, value) in outputs.items():
            self.tree.interface.new_socket(name=name, in_out="OUTPUT", socket_type=socket_type)
            self.put(value, result.inputs[name])
        columns = {}
        for node, column in self.depth.items():
            row = columns.get(column, 0)
            node.location = (column * 215, row * -235)
            columns[column] = row + 1
        return self.tree


def _scan(name, space):
    path = TEXTURES / f"{name}.webp"
    image = bpy.data.images.load(str(path), check_existing=True)
    image.colorspace_settings.name = space
    return image


def _facade(kind):
    g = SurfaceGraph("Al Marfa · " + ("Weathered lime plaster" if kind == "plaster" else "Weathered limestone"))
    incoming = g.inputs.outputs
    vertical = g.math("SUBTRACT", 1., g.math("ABSOLUTE", g.up))
    patch = g.noise((.65, .71, 1.05), 2., "Salt and mineral deposits")
    streak = g.noise((4.1, 4.4, .37), 2., "Vertical rain streaks")
    fine = g.noise((33., 37., 31.), 2., "Sand grain and salt crystals")
    splash_top = g.ramp(patch, (.25, .73), (.28, 1.05), "Variable rising damp")
    splash = g.ramp(g.math("DIVIDE", g.height, splash_top), (.03, 1.), (.83, 0.))
    runoff = g.ramp(streak, (.53, .80), (0., .44), "Oxidized runoff")
    damp = g.math("MULTIPLY", g.math("MAXIMUM", splash, runoff), vertical)
    damp = g.math("MULTIPLY", damp, incoming["Amount"])
    color = g.tint(incoming["Base Color"], (.68, .61, .48, 1.), damp, "Damp mineral discoloration")
    mineral = g.ramp(patch, (.31, .77), (0., .40))
    color = g.tint(color, (1.13, 1.07, .94, 1.), mineral, "Alkaline bloom")
    roughness = g.mix_float(incoming["Roughness"], .66, damp, "Moisture lowers roughness")
    relief = incoming["Normal"]
    if kind == "plaster":
        flakes = g.noise((1.14, 1.16, 1.33), 5., "Irregular spall edges")
        lower = g.ramp(g.height, (.42, 4.5), (.77, .25))
        peel = g.math("MULTIPLY", g.ramp(flakes, (.54, .69)), g.math("MULTIPLY", lower, vertical))
        peel = g.math("MULTIPLY", peel, incoming["Amount"])
        uv = g.node("ShaderNodeTexCoord", "Imported wall texture coordinates").outputs["UV"]
        worn_albedo = g.texture(_scan("plaster-damage-albedo", "sRGB"), uv, "Scanned exposed masonry")
        worn_normal = g.texture(_scan("plaster-damage-normal", "Non-Color"), uv, "Masonry surface normal")
        color = g.mix_color(color, worn_albedo, peel, "Lime plaster wears through to masonry")
        masonry = g.normal_map(worn_normal, .62, "OpenGL tangent-space normal")
        # Geometry and mapped normals are both world-space vectors at this point.
        dry_weight = g.math("SUBTRACT", 1., peel)
        original_scaled = g.scale_vector(relief, dry_weight, "Intact plaster normal")
        exposed_scaled = g.scale_vector(masonry, peel, "Exposed masonry normal")
        relief = g.vector("ADD", original_scaled, exposed_scaled)
        normalized = g.node("ShaderNodeVectorMath", "Normalize blended wall normal")
        normalized.operation = "NORMALIZE"
        g.put(relief, normalized.inputs[0])
        relief = normalized.outputs[0]
        relief = g.bump(relief, g.math("SUBTRACT", 1., peel), .31, .006, "Shallow plaster flake lip")
    relief = g.bump(relief, fine, .27, .0013, "Micro relief")
    return g.finish(**{
        "Base Color": ("NodeSocketColor", color),
        "Roughness": ("NodeSocketFloat", roughness),
        "Normal": ("NodeSocketVector", relief),
    })


def _road(kind, mask):
    g = SurfaceGraph("Al Marfa · " + ("Damp cobblestone" if kind == "road" else "Damp asphalt"))
    incoming = g.inputs.outputs
    offset = g.vector("SUBTRACT", g.position, (*MASK_MIN, 0.))
    uv = g.vector("MULTIPLY", offset, (1. / MASK_SPAN[0], 1. / MASK_SPAN[1], 0.))
    basin = g.texture(mask, uv, "Water collects beside the real drain locations", clip=True)
    near_grade = g.ramp(g.math("ABSOLUTE", g.height), (.024, .065), (1., 0.))
    flat = g.ramp(g.up, (.77, .96))
    water = g.math("MULTIPLY", basin, g.math("MULTIPLY", near_grade, flat))
    water = g.math("MULTIPLY", water, incoming["Amount"])
    grain = g.noise((64., 69., 51.), 2., "Road aggregate micro relief")
    dust = g.ramp(g.noise((.31, .43, .29), 3., "Dust carried across street"), (.33, .73), (0., .26))
    color = g.tint(incoming["Base Color"], (1.12, 1.05, .84, 1.), dust, "Dry mineral dust")
    color = g.tint(color, (.45, .53, .54, 1.), water, "Wet substrate")
    roughness = g.mix_float(incoming["Roughness"], .24, water, "Water smooths the aggregate")
    dry = g.math("SUBTRACT", 1., water)
    relief = g.bump(incoming["Normal"], grain, g.math("MULTIPLY", dry, .29), .0018, "Dry aggregate")
    ripple = g.noise((11., 16., 1.), 1., "Very fine standing water relief")
    film = g.bump(g.normal, ripple, g.math("MULTIPLY", water, .20), .0011, "Water surface")
    coat = g.math("MULTIPLY", g.ramp(water, (.38, .94)), .69, "Continuous surface film")
    return g.finish(**{
        "Base Color": ("NodeSocketColor", color),
        "Roughness": ("NodeSocketFloat", roughness),
        "Normal": ("NodeSocketVector", relief),
        "Coat Weight": ("NodeSocketFloat", coat),
        "Coat Normal": ("NodeSocketVector", film),
    })


def _painted_steel(kind):
    g = SurfaceGraph("Al Marfa · " + {
        "enamel": "Worn vehicle enamel", "coatedSteel": "Oxidized painted steel",
        "burntSteel": "Scorched vehicle steel",
    }[kind])
    incoming = g.inputs.outputs
    fleck = g.noise((62., 59., 68.), 2., "Fine oxide grains")
    wash = g.noise((11., 13., 2.3), 3., "Road grime and water streaks")
    broken_paint = g.math("ADD", g.math("MULTIPLY", fleck, .56), g.math("MULTIPLY", wash, .44))
    chip = g.ramp(broken_paint, (.61, .78), (0., .86), "Oxidation blooms under paint")
    dust = g.ramp(g.height, (.18, 1.23), (.48, .08), "Road dust at sill height")
    dust = g.math("MULTIPLY", dust, g.ramp(wash, (.37, .76)))
    color = g.tint(incoming["Base Color"], (.75, .63, .51, 1.), dust, "Warm road dirt")
    oxide = g.mix_color((.071, .042, .026, 1.), (.218, .104, .045, 1.), fleck, "Raw iron oxides")
    color = g.mix_color(color, oxide, chip, "Localized paint failure")
    weather = g.math("MAXIMUM", dust, chip)
    if kind == "burntSteel":
        plume = g.noise((2.4, 2.9, 2.1), 3., "Blistered paint around the burn")
        char = g.ramp(plume, (.27, .71), (.08, .94), "Carbon deposits")
        color = g.mix_color(color, (.023, .020, .017, 1.), char, "Carbonized coating")
        weather = g.math("MAXIMUM", weather, char)
    roughness = g.mix_float(incoming["Roughness"], .88, weather, "Deposits scatter light")
    metallic = g.mix_float(incoming["Metallic"], 0., weather, "Oxide is dielectric")
    relief = g.bump(incoming["Normal"], fleck, .29, .0006, "Pitted surface")
    output = {
        "Base Color": ("NodeSocketColor", color),
        "Roughness": ("NodeSocketFloat", roughness),
        "Normal": ("NodeSocketVector", relief),
        "Metallic": ("NodeSocketFloat", metallic),
    }
    if kind == "enamel":
        output["Coat Weight"] = ("NodeSocketFloat", g.mix_float(.52, .04, weather, "Worn clear coat"))
    return g.finish(**output)


def _attach(material, group):
    tree = material.node_tree
    principled = next((node for node in tree.nodes if node.type == "BSDF_PRINCIPLED"), None)
    if principled is None:
        return False
    layer = tree.nodes.new("ShaderNodeGroup")
    layer.node_tree = group
    layer.label = "Al Marfa · Weathering (Blender)"
    layer.location = principled.location.x - 240., principled.location.y - 290.
    layer.width = 210.
    for name in ("Base Color", "Roughness", "Normal", "Metallic"):
        if name not in layer.inputs:
            continue
        original = principled.inputs[name]
        if original.is_linked:
            source = original.links[0].from_socket
            tree.links.remove(original.links[0])
            tree.links.new(source, layer.inputs[name])
        elif name == "Normal":
            geometry = tree.nodes.new("ShaderNodeNewGeometry")
            geometry.location = layer.location.x - 190., layer.location.y - 180.
            tree.links.new(geometry.outputs["Normal"], layer.inputs[name])
        else:
            layer.inputs[name].default_value = original.default_value
    for socket in layer.outputs:
        tree.links.new(socket, principled.inputs[socket.name])
    if "Coat Normal" in layer.outputs:
        principled.inputs["Coat IOR"].default_value = 1.333
        principled.inputs["Coat Roughness"].default_value = .10
    material["al_marfa_weathering"] = True
    return True


def enhance_preview():
    """Layer weathering over imported scans without altering game assets."""
    groups = {}
    layered = []
    for material in bpy.data.materials:
        kind = material.name.split(".")[0].removeprefix("ml_")
        if material.get("al_marfa_weathering") or not material.name.startswith("ml_"):
            continue
        if kind not in groups:
            if kind in {"road", "asphalt"}:
                groups[kind] = _road(kind, _packed_water_mask())
            elif kind in {"plaster", "limestone"}:
                groups[kind] = _facade(kind)
            elif kind in {"enamel", "coatedSteel", "burntSteel"}:
                groups[kind] = _painted_steel(kind)
        if kind in groups and _attach(material, groups[kind]):
            layered.append(material.name)
        elif kind == "cabinGlass":
            bsdf = next(node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
            bsdf.inputs["Transmission Weight"].default_value = .94
            bsdf.inputs["Metallic"].default_value = 0.
            bsdf.inputs["Roughness"].default_value = .14
            bsdf.inputs["IOR"].default_value = 1.51
            bsdf.inputs["Coat Weight"].default_value = 0.
            material["al_marfa_weathering"] = True
            layered.append(material.name)
    return layered
