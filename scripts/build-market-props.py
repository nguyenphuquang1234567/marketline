"""Build Marketline's four static market props in Blender.

blender -b --factory-startup --python-exit-code 1 -P scripts/build-market-props.py
Add -- --blend /path/to/market-props.blend to save the source scene.
"""
import argparse
import json
import math
from pathlib import Path
import random
import sys

import bmesh
import bpy
from mathutils import Euler, Vector
import numpy as np

TAU = math.tau
COLOR = "SurfaceColor"
SLOTS = {
    "wood": ("M_CrateTimber", .86, 0),
    "fruit": ("M_FruitSkin", .42, 0),
    "date": ("M_DateSkin", .48, 0),
    "leaf": ("M_StemsAndLeaves", .79, 0),
    "fiber": ("M_PalmFiber", .89, 0),
    "clay": ("M_Terracotta", .78, 0),
    "iron": ("M_PatinatedIron", .61, .7),
    "brass": ("M_OxidizedBrass", .46, .58),
    "glass": ("M_OpalDiffuser", .33, 0),
}


def linear(value):
    return value / 12.92 if value < .04045 else ((value + .055) / 1.055) ** 2.4


def swatch(hex_code, multiplier=1):
    return tuple(linear(int(hex_code[i:i + 2], 16) / 255) * multiplier
                 for i in (0, 2, 4)) + (1,)


def material(slot):
    name, roughness, metallic = SLOTS[slot]
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    result = bpy.data.materials.new(name)
    result.use_backface_culling = True
    nodes = result.node_tree.nodes
    shader = next(node for node in nodes if node.type == "BSDF_PRINCIPLED")
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    attribute = nodes.new("ShaderNodeVertexColor")
    attribute.layer_name = COLOR
    result.node_tree.links.new(attribute.outputs["Color"], shader.inputs["Base Color"])
    if slot == "glass":
        shader.inputs["Emission Color"].default_value = (1, .49, .17, 1)
        shader.inputs["Emission Strength"].default_value = .36
    return result


class Prop:
    """Collect all closed parts into one mesh with one draw per material."""

    def __init__(self, name):
        self.name = name
        self.vertices = []
        self.colors = []
        self.faces = []
        self.uvs = []
        self.face_slots = []
        self.smooth = []

    def part(self, vertices, faces, slot, color, smooth=True, shade=None, uv=None):
        start = len(self.vertices)
        self.vertices.extend(vertices)
        self.colors.extend(swatch(color, shade(*point) if shade else 1) for point in vertices)
        self.faces.extend(tuple(start + index for index in face) for face in faces)
        self.face_slots.extend([slot] * len(faces))
        self.smooth.extend([smooth] * len(faces))
        self.uvs.extend(uv or [tuple((.5 + .5 * math.cos(TAU * i / len(face)),
                                        .5 + .5 * math.sin(TAU * i / len(face)))
                                       for i in range(len(face))) for face in faces])

    def revolve(self, center, profile, slot, color, segments=24, wave=0, shade=None,
                transform=None, phase=0, tints=None):
        """Revolve a closed radial section, with single vertices on the axis."""
        cx, cy, cz = center
        vertices, faces, uvs, rows = [], [], [], []
        for radius, z in profile:
            row = []
            for index in range(segments if radius > 0 else 1):
                angle = TAU * index / segments + phase
                r = radius * (1 + wave * (.65 * math.cos(angle * 3) + .35 * math.sin(angle * 7 + z * 11)))
                point = (r * math.cos(angle), r * math.sin(angle), z)
                if transform is not None:
                    point = transform(point)
                row.append(len(vertices))
                vertices.append((cx + point[0], cy + point[1], cz + point[2]))
            rows.append(row)

        for layer, (lower, upper) in enumerate(zip(rows, rows[1:])):
            for index in range(segments):
                current, nxt = index, (index + 1) % segments
                s, t = index / segments, (index + 1) / segments
                v, w = layer / (len(rows) - 1), (layer + 1) / (len(rows) - 1)
                if len(lower) == 1:
                    face, uv = (lower[0], upper[nxt], upper[current]), (((s + t) / 2, v), (t, w), (s, w))
                elif len(upper) == 1:
                    face, uv = (lower[current], lower[nxt], upper[0]), ((s, v), (t, v), ((s + t) / 2, w))
                else:
                    face, uv = (lower[current], lower[nxt], upper[nxt], upper[current]), ((s, v), (t, v), (t, w), (s, w))
                faces.append(face)
                uvs.append(uv)
        self.part(vertices, faces, slot, color, shade=shade, uv=uvs)
        if tints:
            offset = len(self.vertices) - len(vertices)
            for row, tint in tints.items():
                for index in rows[row]:
                    multiplier = shade(*vertices[index]) if shade else 1
                    self.colors[offset + index] = swatch(tint, multiplier)

    def tube(self, points, radius, slot, color, sides=6, closed=False, shade=None):
        """Sweep a small round section along a sampled path."""
        vertices, faces, uvs = [], [], []
        n = len(points)
        for index, coords in enumerate(points):
            point = Vector(coords)
            before = Vector(points[(index - 1) % n if closed else max(0, index - 1)])
            after = Vector(points[(index + 1) % n if closed else min(n - 1, index + 1)])
            tangent = (after - before).normalized()
            up = Vector((0, 0, 1)) if abs(tangent.z) < .85 else Vector((0, 1, 0))
            normal = tangent.cross(up).normalized()
            binormal = tangent.cross(normal)
            for side in range(sides):
                angle = TAU * side / sides
                vertices.append(tuple(point + radius * (normal * math.cos(angle) + binormal * math.sin(angle))))
        for index in range(n if closed else n - 1):
            nxt = (index + 1) % n
            for side in range(sides):
                following = (side + 1) % sides
                faces.append((index * sides + side, index * sides + following,
                              nxt * sides + following, nxt * sides + side))
                uvs.append(((index / n, side / sides), (index / n, (side + 1) / sides),
                            ((index + 1) / n, (side + 1) / sides), ((index + 1) / n, side / sides)))
        if not closed:
            faces.extend((tuple(reversed(range(sides))), tuple(range((n - 1) * sides, n * sides))))
            cap = tuple((.5 + math.cos(TAU * i / sides) * .4, .5 + math.sin(TAU * i / sides) * .4)
                        for i in range(sides))
            uvs.extend((cap, cap))
        self.part(vertices, faces, slot, color, shade=shade, uv=uvs)

    def board(self, center, size, slot, color, bevel=.003, yaw=0, shade=None):
        """Make a bevelled solid with a grain-aligned UV strip."""
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1)
        for vertex in bm.verts:
            vertex.co = Vector(tuple(vertex.co[i] * size[i] for i in range(3)))
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=1, affect="EDGES")
        bm.verts.index_update()
        bm.normal_update()
        vertices, faces, uvs = [], [], []
        cs, sn = math.cos(yaw), math.sin(yaw)
        for vertex in bm.verts:
            x, y, z = vertex.co
            vertices.append((center[0] + x * cs - y * sn, center[1] + x * sn + y * cs, center[2] + z))
        offset = (center[2] * 7.35 + center[1] * 3.19 + center[0] * .57) % 1
        for face in bm.faces:
            faces.append(tuple(vertex.index for vertex in face.verts))
            face_axis = max(range(3), key=lambda axis: abs(face.normal[axis]))
            along, across = sorted((axis for axis in range(3) if axis != face_axis),
                                   key=lambda axis: size[axis], reverse=True)
            uvs.append(tuple((v.co[along] * 1.6 + offset, v.co[across] * 4.2 + offset) for v in face.verts))
        bm.free()
        self.part(vertices, faces, slot, color, smooth=False, shade=shade, uv=uvs)

    def finish(self):
        mesh = bpy.data.meshes.new(self.name)
        mesh.from_pydata(self.vertices, [], self.faces)
        mesh.update()
        slots = list(dict.fromkeys(self.face_slots))
        for slot in slots:
            mesh.materials.append(material(slot))
        colors = mesh.color_attributes.new(name=COLOR, domain="POINT", type="FLOAT_COLOR")
        for item, color in zip(colors.data, self.colors):
            item.color = color
        mesh.color_attributes.active_color = colors
        uv_layer = mesh.uv_layers.new(name="UVMap")
        for poly, slot, smooth, uvs in zip(mesh.polygons, self.face_slots, self.smooth, self.uvs):
            poly.material_index = slots.index(slot)
            poly.use_smooth = smooth
            for loop, uv in zip(poly.loop_indices, uvs):
                uv_layer.data[loop].uv = uv

        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(mesh)
        bm.free()
        mesh.update()
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj


def clay_wear(x, y, z):
    return .96 + .1 * math.sin(x * 37 + y * 13 + z * 27) + .06 * math.cos(z * 74 + y * 21)


def basket_wear(x, y, z):
    return .94 + .16 * math.sin(x * 73 - y * 25 + z * 43)


def crate():
    p = Prop("ProduceCrate")
    rng = random.Random(24)
    wood = ("887055", "a68860", "9b7b54", "7c654e", "ac926c")
    p.board((0, 0, .017), (.64, .41, .034), "wood", "7d654c", shade=clay_wear)
    for x in (-.293, .293):
        for y in (-.171, .171):
            p.board((x, y, .12), (.041, .041, .218), "wood", "887657", shade=clay_wear)
    for row in range(3):
        z = .055 + .067 * row
        for side in (-1, 1):
            p.board((0, side * .205, z), (.662, .031, .062), "wood",
                    rng.choice(wood), shade=clay_wear)
            p.board((side * .314, 0, z), (.386, .025, .062), "wood",
                    rng.choice(wood), yaw=math.pi / 2, shade=clay_wear)
            for x in (-.288, .288):
                nail = ((x, side * .220, z), (x, side * .222, z))
                p.tube(nail, .0026, "iron", "65605b", sides=5)
    # Rows are staggered and the smaller top layer nestles into their gaps.
    fruits = []
    for row, y in enumerate((-.125, -.044, .038, .121)):
        for column in range(6):
            x = -.247 + .098 * column + (row % 2) * .013
            fruits.append((x, y, .166 + rng.uniform(-.008, .009), .043 + rng.uniform(-.003, .006)))
    for row, y in enumerate((-.083, .004, .087)):
        for column in range(5):
            x = -.19 + .095 * column + rng.uniform(-.009, .009)
            fruits.append((x, y + rng.uniform(-.009, .009), .226 + rng.uniform(-.011, .008), .041 + rng.uniform(-.003, .006)))
    oranges = ("d97819", "ec991f", "d98418", "cf621a", "f29d29", "e7811a", "e5ac32")
    for i, (x, y, z, radius) in enumerate(fruits):
        turns = Euler((rng.uniform(-.37, .37), rng.uniform(-.37, .37), rng.uniform(0, TAU))).to_matrix()
        profile = [(radius * math.sin(math.pi * j / 10), -.91 * radius * math.cos(math.pi * j / 10))
                   for j in range(11)]
        profile[-1] = (0, .87 * radius)
        tint_phase = rng.uniform(0, TAU)
        p.revolve((x, y, z), profile, "fruit", rng.choice(oranges), segments=12, wave=.04,
                  transform=lambda xyz: tuple(turns @ Vector(xyz)), phase=rng.uniform(0, TAU),
                  shade=lambda xx, yy, zz: 1 + .18 * math.sin((xx - x) * 70 + (zz - z) * 31 + tint_phase)
                  + .065 * math.cos((yy - y) * 132 + (zz - z) * 74))
        if z > .21 and rng.random() < .75:
            point = Vector((x, y, z)) + turns @ Vector((0, 0, radius * .82))
            p.tube([point, point + turns @ Vector((.001, .003, .007))], .0024, "leaf", "5c6030", sides=5)
        if i in (26, 30, 37):
            leaf_shape = ((0, 0, .80 * radius), (.016, -.009, .89 * radius),
                          (.044, 0, .96 * radius), (.020, .009, 1.03 * radius),
                          (.021, 0, 1.10 * radius), (.020, 0, .86 * radius))
            origin = Vector((x, y, z))
            points = [origin + turns @ Vector(point) for point in leaf_shape]
            faces = [(j, (j + 1) % 4, 4) for j in range(4)] + [(j, 5, (j + 1) % 4) for j in range(4)]
            p.part(points, faces, "leaf", "6d7336")
    return p.finish()


def dates():
    p = Prop("DateBasket")
    rng = random.Random(62)
    p.revolve((0, 0, 0), [(0, 0), (.128, 0), (.142, .014), (.154, .045), (.171, .079),
                          (.195, .175), (.205, .218), (.195, .224), (.171, .151),
                          (.151, .082), (.137, .043), (0, .038)], "fiber", "96764a", shade=basket_wear)
    for row in range(13):
        t = row / 12
        z = .019 + .202 * t
        nominal = .14 + .061 * (t ** .73)
        coil = []
        for sample in range(84):
            angle = TAU * sample / 84
            radius = nominal + .004 * math.cos(angle * 21 + (row % 2) * math.pi)
            coil.append((radius * math.cos(angle), radius * math.sin(angle), z + .0017 * math.sin(angle * 9 + row)))
        def fiber_tint(x, y, z):
            segment = math.cos(math.atan2(y, x) * 21 + (row % 2) * math.pi)
            return basket_wear(x, y, z) * (.91 + .13 * segment)

        p.tube(coil, .0076 if row < 12 else .010, "fiber", rng.choice(("ba9663", "a6834e", "b99767", "aa8954")),
               sides=4 if row < 12 else 6, closed=True, shade=fiber_tint)
    for angle in (0, math.pi):
        grip = []
        for i in range(20):
            step = i / 19
            phi = angle - .3 + .6 * step
            radius = .2 + .022 * math.sin(math.pi * step)
            grip.append((radius * math.cos(phi), radius * math.sin(phi), .204 + .097 * math.sin(math.pi * step)))
        p.tube(grip, .008, "fiber", "b69561", shade=basket_wear)

    mound = [(0, .116), (.12, .117), (.155, .155), (.169, .189), (.143, .207),
             (.101, .236), (.067, .249), (0, .25)]
    p.revolve((0, 0, 0), mound, "date", "624124", segments=30, shade=clay_wear)
    for radius, count, elevation in ((.142, 22, .207), (.116, 18, .228), (.09, 14, .251),
                                      (.059, 10, .266), (.029, 5, .273)):
        for i in range(count):
            angle = TAU * (i + rng.uniform(-.31, .31)) / count
            cx, cy = radius * math.cos(angle), radius * math.sin(angle)
            rz = elevation + rng.uniform(-.004, .004)
            length = rng.uniform(.022, .026)
            tilt = Euler((rng.uniform(.95, 1.45), 0, rng.uniform(0, TAU))).to_matrix()
            profile = [(0, -length), (.007, -.8 * length), (.012, -.38 * length),
                       (.0115, .14 * length), (.011, .60 * length), (.0073, .87 * length), (0, length)]
            p.revolve((cx, cy, rz), profile, "date",
                      rng.choice(("744427", "90532f", "6a3e25", "774324", "a66636")),
                      segments=8, wave=.11, phase=rng.uniform(0, TAU), shade=clay_wear,
                      transform=lambda xyz: tuple(tilt @ Vector(xyz)))
    return p.finish()


def pottery():
    p = Prop("TerracottaPair")
    # Thick lips and interior walls keep the vessels readable when seen from above.
    tall = [(0, 0), (.080, 0), (.089, .008), (.090, .030), (.116, .063), (.145, .116),
            (.169, .180), (.174, .242), (.170, .283), (.168, .290), (.167, .299),
            (.164, .306), (.140, .348), (.107, .389), (.088, .421),
            (.087, .462), (.095, .468), (.096, .482), (.089, .488), (.075, .487), (.071, .478),
            (.072, .421), (.092, .381), (.133, .328), (.153, .277), (.156, .225), (.151, .173),
            (.126, .112), (.098, .062), (.074, .034), (0, .034)]
    jar_center = (-.12, .025, 0)
    p.revolve(jar_center, tall, "clay", "a75c42", segments=38, wave=.027, shade=clay_wear,
              tints={8: "86503c", 9: "96543c", 10: "8d533e"})
    short = [(0, 0), (.084, 0), (.095, .013), (.098, .04), (.123, .081), (.14, .126),
             (.142, .151), (.141, .155), (.142, .160), (.142, .167), (.140, .170), (.140, .176),
             (.138, .181), (.136, .186), (.130, .203), (.109, .225), (.099, .232), (.103, .238), (.103, .252),
             (.099, .258), (.087, .258), (.084, .25), (.089, .222), (.114, .195), (.123, .153),
             (.12, .106), (.100, .062), (.077, .030), (0, .030)]
    pot_center = (.175, -.071, 0)
    p.revolve(pot_center, short, "clay", "bc8158", segments=34, wave=.02, shade=clay_wear,
              tints={7: "74897c", 8: "b78358", 9: "bc8c5f", 10: "75867a", 11: "a57e59"})
    for side in (-1, 1):
        handle = []
        for i in range(21):
            t = i / 20
            handle.append((jar_center[0] + side * (.085 + .09 * t + .057 * math.sin(math.pi * t)),
                           jar_center[1] + .004 * math.sin(TAU * t), .443 - .169 * t))
        p.tube(handle, .013, "clay", "9e5c42", sides=8, shade=clay_wear)
    return p.finish()


def lantern():
    p = Prop("ShopLantern")
    # Front in Blender is -Y. The hanger's top edge is at world origin Z.
    p.board((0, -.016, -.115), (.070, .031, .219), "iron", "444a3f", bevel=.008, shade=clay_wear)
    for z in (-.037, -.189):
        p.tube([(0, -.032, z), (0, -.040, z)], .009, "brass", "8f7852", sides=6)
    path = [(0, -.032, -.062), (0, -.065, -.063), (0, -.101, -.067), (0, -.136, -.076),
            (0, -.170, -.091), (0, -.197, -.115), (0, -.208, -.145)]
    p.tube(path, .010, "iron", "5f6051", sides=8)
    p.tube([(0, -.032, -.171), (0, -.083, -.135), (0, -.147, -.107)], .006, "iron", "515548")
    cx, cy = 0, -.205
    p.revolve((cx, cy, 0), [(0, -.461), (.019, -.461), (.023, -.447), (.045, -.435),
                            (.074, -.420), (.077, -.402), (.071, -.392), (0, -.392)],
              "iron", "596054", segments=8, phase=math.pi / 8, shade=clay_wear)
    p.revolve((cx, cy, 0), [(0, -.403), (.067, -.403), (.086, -.301), (.073, -.250), (0, -.250)],
              "glass", "e3c289", segments=8, phase=math.pi / 8, shade=clay_wear)
    p.revolve((cx, cy, 0), [(0, -.254), (.079, -.254), (.090, -.249), (.093, -.234),
                            (.072, -.218), (.055, -.193), (.027, -.173), (.019, -.151),
                            (.012, -.140), (0, -.140)], "iron", "666954", segments=8,
              phase=math.pi / 8, shade=clay_wear)
    for index in range(8):
        angle = TAU * index / 8 + math.pi / 8
        radial_path = [(.066, -.409), (.076, -.365), (.089, -.301), (.075, -.250)]
        p.tube([(cx + r * math.cos(angle), cy + r * math.sin(angle), z) for r, z in radial_path],
               .0043, "brass", "a08856", sides=5, shade=clay_wear)
    for radius, height in ((.083, -.334), (.075, -.373), (.083, -.244), (.074, -.411)):
        p.tube([(cx + radius * math.cos(TAU * i / 8 + math.pi / 8),
                 cy + radius * math.sin(TAU * i / 8 + math.pi / 8), height) for i in range(8)],
               .0032, "brass", "a58b60", sides=5, closed=True, shade=clay_wear)
    return p.finish()


def add_timber_texture():
    """Bake a small linear-light grain multiplier into the timber's base color."""
    size = 256
    x, y = np.meshgrid(np.arange(size) / size, np.arange(size) / size)
    rng = np.random.default_rng(297)
    bend = .024 * np.sin(TAU * x) + .008 * np.sin(TAU * x * 3)
    ring = (y + bend + .006 * np.sin(TAU * (x * 4 + y * 2))) * 28
    growth = (.5 + .5 * np.cos(TAU * ring)) ** 5
    fibers = .5 + .5 * np.sin(TAU * (y * 76 + bend * 25 + .075 * np.sin(TAU * x * 2)))
    weather = .94 + .047 * np.cos(TAU * y * 5) * np.cos(TAU * x) + .024 * np.sin(TAU * y * 13)
    grain = np.clip(weather - .15 * growth - .048 * fibers - .055 * rng.random((size, size)), .64, 1)
    pixels = np.stack((grain, grain, grain, np.ones_like(grain)), axis=2).astype(np.float32)
    image = bpy.data.images.new("TimberGrain", width=size, height=size, alpha=False)
    image.colorspace_settings.name = "Linear Rec.709"
    image.pixels.foreach_set(pixels.ravel())
    image.pack()
    material = bpy.data.materials[SLOTS["wood"][0]]
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    shader = next(node for node in nodes if node.type == "BSDF_PRINCIPLED")
    attribute = next(node for node in nodes if node.type == "VERTEX_COLOR")
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = image
    mixed = nodes.new("ShaderNodeMixRGB")
    mixed.blend_type = "MULTIPLY"
    mixed.inputs[0].default_value = 1
    links.new(texture.outputs["Color"], mixed.inputs[1])
    links.new(attribute.outputs["Color"], mixed.inputs[2])
    links.new(mixed.outputs[0], shader.inputs["Base Color"])


def add_surface_normal(slot, texture_name, spacing, depth, seed):
    """Bake a repeatable pore normal from a tile of jittered mineral or citrus pits."""
    size = 128
    rng = np.random.default_rng(seed)
    x, y = np.meshgrid(np.arange(size) / size, np.arange(size) / size)
    elevation = np.zeros((size, size))
    for row in range(spacing):
        for column in range(spacing):
            cx = (column + rng.uniform(.12, .88)) / spacing
            cy = (row + rng.uniform(.12, .88)) / spacing
            radius = rng.uniform(.18, .37) / spacing
            dx = (x - cx + .5) % 1 - .5
            dy = (y - cy + .5) % 1 - .5
            elevation -= rng.uniform(.3, 1) * np.exp(-(dx ** 2 + dy ** 2) / radius ** 2)
    height_dx = np.roll(elevation, -1, axis=1) - np.roll(elevation, 1, axis=1)
    height_dy = np.roll(elevation, -1, axis=0) - np.roll(elevation, 1, axis=0)
    nx, ny = -height_dx * depth, -height_dy * depth
    norm = np.sqrt(nx * nx + ny * ny + 1)
    data = np.stack((.5 + .5 * nx / norm, .5 + .5 * ny / norm,
                     .5 + .5 / norm, np.ones_like(norm)), axis=2).astype(np.float32)
    image = bpy.data.images.new(texture_name, width=size, height=size, alpha=False)
    image.colorspace_settings.name = "Non-Color"
    image.pixels.foreach_set(data.ravel())
    image.pack()
    material = bpy.data.materials[SLOTS[slot][0]]
    nodes = material.node_tree.nodes
    shader = next(node for node in nodes if node.type == "BSDF_PRINCIPLED")
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = image
    normal = nodes.new("ShaderNodeNormalMap")
    material.node_tree.links.new(texture.outputs["Color"], normal.inputs["Color"])
    material.node_tree.links.new(normal.outputs["Normal"], shader.inputs["Normal"])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "src/assets/market-props.glb")
    parser.add_argument("--blend", type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])

    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1
    props = [crate(), dates(), pottery(), lantern()]
    add_timber_texture()
    add_surface_normal("fruit", "CitrusPores", 20, .32, 83)
    add_surface_normal("clay", "ClayPores", 32, .22, 16)
    bpy.context.view_layer.update()
    if args.blend:
        bpy.ops.wm.save_as_mainfile(filepath=str(args.blend.resolve()))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(args.output.resolve()), export_format="GLB",
                             export_vertex_color="ACTIVE", export_yup=True, export_animations=False)
    sizes = {}
    for prop in props:
        prop.data.calc_loop_triangles()
        sizes[prop.name] = {"triangles": len(prop.data.loop_triangles),
                            "dimensions_m": [round(value, 4) for value in prop.dimensions],
                            "materials": len(prop.data.materials)}
    print("@@JSON@@" + json.dumps({"blender": bpy.app.version_string, "bytes": args.output.stat().st_size,
                                   "assets": sizes}))


if __name__ == "__main__":
    main()
