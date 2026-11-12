"""Blender-authored masonry and public works details for the Al Marfa district."""

from math import cos, pi, sin, tau
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector


TEXTURES = Path(__file__).resolve().parents[1] / "src" / "assets" / "world-textures"
ARCH = 34.8


def surface_uv(mesh, meters):
    uv = mesh.uv_layers.active or mesh.uv_layers.new(name="Surface")
    for face in mesh.polygons:
        axis = max(range(3), key=lambda i: abs(face.normal[i]))
        for loop in face.loop_indices:
            x, y, z = mesh.vertices[mesh.loops[loop].vertex_index].co
            u, v = [(y, z), (x, z), (x, y)][axis]
            uv.data[loop].uv = (u / meters, v / meters)


def material(name, color, roughness, metal=0.0, scan=None):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_backface_culling = True
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = next(node for node in nodes if node.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = roughness
    if scan:
        for channel, space in [("albedo", "sRGB"), ("normal", "Non-Color"), ("orm", "Non-Color")]:
            image = bpy.data.images.load(str(TEXTURES / f"{scan}-{channel}.webp"), check_existing=True)
            image.colorspace_settings.name = space
            if not image.packed_file:
                image.pack()
            sampler = nodes.new("ShaderNodeTexImage")
            sampler.image = image
            sampler.label = f"{scan.title()} scan / {channel}"
            if channel == "albedo":
                tint = nodes.new("ShaderNodeMix")
                tint.data_type = "RGBA"
                tint.blend_type = "MULTIPLY"
                tint.inputs["Factor"].default_value = 1
                tint.inputs["B"].default_value = (*color, 1)
                links.new(sampler.outputs["Color"], tint.inputs["A"])
                links.new(tint.outputs["Result"], bsdf.inputs["Base Color"])
            elif channel == "normal":
                normal = nodes.new("ShaderNodeNormalMap")
                normal.inputs["Strength"].default_value = .43
                links.new(sampler.outputs["Color"], normal.inputs["Color"])
                links.new(normal.outputs["Normal"], bsdf.inputs["Normal"])
            else:
                channels = nodes.new("ShaderNodeSeparateColor")
                links.new(sampler.outputs["Color"], channels.inputs["Color"])
                links.new(channels.outputs["Green"], bsdf.inputs["Roughness"])
    return mat


class Fabrication:
    """Merge small construction details by zone into a single multi-material mesh."""

    def __init__(self, collection, name):
        self.collection = collection
        self.name = name
        self.vertices, self.faces, self.finishes = [], [], []
        self.materials = []
        self.smooth_faces = set()

    def append(self, verts, faces, mat, smooth=False):
        if mat not in self.materials:
            self.materials.append(mat)
        start = len(self.vertices)
        self.vertices.extend(verts)
        for i, face in enumerate(faces):
            if smooth is True or (smooth and i in smooth):
                self.smooth_faces.add(len(self.faces))
            self.faces.append(tuple(start + index for index in face))
            self.finishes.append(self.materials.index(mat))

    def block(self, center, size, mat, bevel=.006, angle=0):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1)
        bm.transform(Matrix.Diagonal((*size, 1.0)))
        if bevel:
            bmesh.ops.bevel(
                bm, geom=list(bm.edges), offset=min(bevel, min(size) * .25),
                segments=1, affect="EDGES", clamp_overlap=True,
            )
        bm.verts.index_update()
        rot = Matrix.Rotation(angle, 3, "Y")
        self.append([tuple(rot @ v.co + Vector(center)) for v in bm.verts],
                    [tuple(v.index for v in f.verts) for f in bm.faces], mat)
        bm.free()

    def pipe(self, points, radius, mat, sides=8):
        if len(points) < 2:
            raise ValueError("A pipe needs at least two points")
        centers = [Vector(p) for p in points]
        along = (centers[-1] - centers[0]).normalized()
        reference = Vector((0, 0, 1)) if abs(along.z) < .88 else Vector((1, 0, 0))
        verts = []
        for i, center in enumerate(centers):
            tangent = (centers[min(i + 1, len(centers) - 1)] - centers[max(0, i - 1)]).normalized()
            across = reference.cross(tangent).normalized()
            up = tangent.cross(across)
            verts.extend(tuple(center + radius * (cos(tau * j / sides) * across + sin(tau * j / sides) * up))
                         for j in range(sides))
        faces = []
        for i in range(len(centers) - 1):
            for j in range(sides):
                a = i * sides + j
                b = i * sides + (j + 1) % sides
                faces.append((a, b, b + sides, a + sides))
        smooth_faces = set(range(len(faces)))
        faces.append(tuple(reversed(range(sides))))
        faces.append(tuple(range(len(verts) - sides, len(verts))))
        self.append(verts, faces, mat, smooth_faces)

    def finish(self, uv_meters=.82):
        mesh = bpy.data.meshes.new(self.name)
        mesh.from_pydata(self.vertices, [], self.faces)
        if mesh.validate(verbose=False):
            raise RuntimeError(f"{self.name}: Blender repaired an invalid mesh")
        mesh.update()
        for mat in self.materials:
            mesh.materials.append(mat)
        for face, index in zip(mesh.polygons, self.finishes, strict=True):
            face.material_index = index
            face.use_smooth = face.index in self.smooth_faces
        surface_uv(mesh, uv_meters)
        obj = bpy.data.objects.new(self.name, mesh)
        self.collection.objects.link(obj)
        return obj


def sign_text(collection, name, words, center, width, height, face, mat, depth=.0036):
    data = bpy.data.curves.new(name, "FONT")
    data.body = words
    data.align_x = "CENTER"
    data.align_y = "CENTER"
    data.size = height
    data.extrude = 0
    data.resolution_u = 4
    text = bpy.data.objects.new(name, data)
    collection.objects.link(text)
    bpy.context.view_layer.update()
    mesh = bpy.data.meshes.new_from_object(text.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(text, do_unlink=True)
    bpy.data.curves.remove(data)
    maximum = max(abs(v.co.x) for v in mesh.vertices) * 2
    scale = min(1, width / maximum)
    mesh.transform(Matrix.Diagonal((scale, 1, 1, 1)))
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-6)
    top = bmesh.ops.extrude_face_region(bm, geom=list(bm.faces), use_keep_orig=True)
    bmesh.ops.translate(bm, vec=(0, 0, depth),
                        verts=[v for v in top["geom"] if isinstance(v, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    surface_uv(mesh, .2)
    mesh.materials.append(mat)
    lettering = bpy.data.objects.new(name, mesh)
    lettering.location = center
    lettering.rotation_euler = (pi / 2, 0, pi if face > 0 else 0)
    collection.objects.link(lettering)
    return lettering


def carved_panel(mesh, x, y, z, face, mats):
    stone, joint, blue, grey, ochre = (mats[name] for name in ("stone", "joint", "blue", "grey", "ochre"))
    mesh.block((x, y + face * .029, z), (1.463, .107, 2.59), joint, .023)
    for edge in (-1, 1):
        mesh.block((x + edge * .696, y + face * .077, z), (.096, .083, 2.48), stone, .013)
        mesh.block((x, y + face * .078, z + edge * 1.258), (1.42, .089, .112), stone, .015)
    # A single geometric inlay repeats within the recessed field. Small
    # offsets keep neighboring glaze faces separated like hand-set tile.
    for row in range(6):
        for column in range(3):
            u = x + (column - 1) * .381
            v = z + (row - 2.5) * .387
            tile = (blue, grey, ochre)[(row + column + int(x > 0)) % 3]
            mesh.block((u, y + face * .066, v), (.364, .046, .369), stone, .008)
            mesh.block((u, y + face * .095, v), (.179, .015, .179), tile, .003, angle=pi / 4)
            mesh.block((u, y + face * .106, v), (.079, .009, .079), stone, .002, angle=pi / 4)
            for side in (-1, 1):
                for level in (-1, 1):
                    mesh.block((u + side * .115, y + face * .093, v + level * .115),
                               (.044, .012, .044), tile, .002, angle=pi / 4)


def arch_side(collection, face, mats):
    side_name = "South" if face < 0 else "North"
    arch = Fabrication(collection, f"SM_Passage_{side_name}_Stonework")
    face_y = ARCH + face * 1.365
    stone, joint, blue, grey = (mats[name] for name in ("stone", "joint", "blue", "grey"))
    iron, bolt, enamel, ink = (mats[name] for name in ("iron", "bolt", "enamel", "ink"))
    for side in (-1, 1):
        x = side * 6.40
        carved_panel(arch, side * 6.06, ARCH + face * 1.318, 7.65, face, mats)
        # Layers of dressed stone form a pilaster with a built-in plinth.
        pilaster = x + side * .48
        for z, width, height, depth in [
            (.647, .46, .13, .095), (.775, .385, .131, .131),
            (2.004, .245, 2.332, .105), (3.235, .34, .16, .126),
            (3.364, .432, .099, .151), (3.458, .398, .087, .116),
        ]:
            arch.block((pilaster, face_y + face * depth * .32, z), (width, depth, height), stone, .014)
        for v in (-1, 0, 1):
            arch.block((pilaster + .054 * v, face_y + face * .092, 1.985),
                       (.015, .034, 2.184), joint, .005)
        # Bolted ceramic wayfinding uses a backing bed to span masonry joints.
        plaque = side * 5.52
        arch.block((plaque, face_y + face * .028, 1.565), (.86, .11, .435), stone, .019)
        arch.block((plaque, face_y + face * .087, 1.565), (.761, .019, .342), enamel, .004)
        for du in (-.34, .34):
            for dz in (-.129, .129):
                u = plaque + du
                arch.pipe([(u, face_y + face * .093, 1.565 + dz),
                           (u, face_y + face * .111, 1.565 + dz)], .012, bolt, 8)
        route = "SOUK" if side * face > 0 else "MÉDINA"
        sign_text(collection, f"SM_{side_name}_{route}_Route", route,
                  (plaque, face_y + face * .0948, 1.608), .57, .104, face, ink)
        sign_text(collection, f"SM_{side_name}_{route}_Arrow", "←" if side * face < 0 else "→",
                  (plaque, face_y + face * .0948, 1.50), .21, .076, face, ink)
        # Mains conduit branches from the existing exterior sconce.
        x = side * 6.51
        surface = face_y + face * .055
        for z in (1.08, 1.92, 2.88, 3.36):
            arch.block((x, face_y + face * .036, z), (.106, .074, .046), iron, .006)
            for a in (-1, 1):
                arch.pipe([(x + a * .038, face_y + face * .070, z),
                           (x + a * .038, face_y + face * .080, z)], .008, bolt, 6)
        arch.pipe([(x, surface, .73), (x, surface, 3.38),
                   (x, surface + face * .013, 3.49), (x, surface + face * .081, 3.53),
                   (x, surface + face * .12, 3.67)], .023, iron)
        arch.block((x, face_y + face * .046, .725), (.15, .107, .149), grey, .014)
        arch.block((x, face_y + face * .105, .725), (.109, .014, .104), iron, .006)
    arch.finish()


def service_detail(collection, mats):
    iron, bolt, enamel, ink, stone = (mats[name] for name in ("iron", "bolt", "enamel", "ink", "stone"))
    for side, wall_x, mid, width, floors, station in [
        (-1, -8.1, 28.2, 10.25, 2, "24"),
        (1, 8.15, 28.75, 9.7, 3, "19"),
        (-1, -8.1, 49.2, 10.5, 2, "42"),
        (1, 8.15, 48.64, 9.95, 2, "37"),
        (-1, -8.1, 12.2, 13.5, 3, "16"),
        (1, 8.15, 11.64, 12.95, 2, "11"),
    ]:
        inward = -side
        mesh = Fabrication(collection, f"SM_Service_Frontage_{station}")
        # Each local placement is centered between the last two storefront
        # bays, clear of upper windows and the existing corner drainpipes.
        bays = max(2, int(width // 3.2))
        span = width / bays
        address_y = mid + side * (width * .5 - span)
        # Orient wall-mounted components in the yz plane.
        mesh.block((wall_x + inward * .026, address_y, 2.03), (.071, .29, .255), stone, .009)
        mesh.block((wall_x + inward * .064, address_y, 2.03), (.014, .23, .203), enamel, .006)
        for dy in (-.085, .085):
            mesh.pipe([(wall_x + inward * .067, address_y + dy, 2.025),
                       (wall_x + inward * .077, address_y + dy, 2.025)], .009, bolt, 6)
        number = sign_text(collection, f"SM_Address_{station}", station,
                           (wall_x + inward * .0698, address_y, 2.03), .14, .115, -1, ink)
        number.rotation_euler.z = inward * pi / 2
        # The parapet shades its rain pipe. Mount only on the exposed upper
        # cornice, past any balcony or storefront sign.
        cornice_z = floors * 3.1 + .41
        box_y = mid + width * .35
        x = wall_x + inward * .068
        mesh.block((x, box_y, cornice_z), (.157, .35, .225), iron, .012)
        mesh.block((x + inward * .079, box_y, cornice_z), (.024, .289, .176), enamel, .008)
        for along in (-1, 1):
            start = box_y + along * .156
            stop = box_y + along * .52
            mesh.pipe([(x, start, cornice_z - .02), (x, stop, cornice_z - .02),
                       (wall_x + inward * .025, stop + along * .073, cornice_z - .02)], .019, iron)
            mesh.block((x - inward * .014, stop - along * .08, cornice_z - .02),
                       (.09, .04, .069), bolt, .006)
        mesh.finish()


def ground_service(collection, mats):
    iron, bolt, ink = (mats[name] for name in ("iron", "bolt", "ink"))
    for index, (x, y, angle) in enumerate([
        (-3.60, 26.8, .21), (3.84, 39.6, -.06), (-4.02, -33.1, .14),
        (3.56, -14.6, -.13), (-30.80, 4.80, .07), (29.88, -23.70, -.03),
    ], 1):
        mesh = Fabrication(collection, f"SM_Municipal_Access_{index:02}")
        # A shallow lid above the existing street grade. Nothing in the
        # swept player volume stands proud enough to become a step.
        mesh.pipe([(x, y, -.014), (x, y, .002)], .352, iron, 32)
        mesh.pipe([(x, y, -.001), (x, y, .010)], .318, bolt, 32)
        for i in range(-4, 5):
            for j in range(-4, 5):
                u, v = i * .057, j * .057
                if u * u + v * v > .245 ** 2 or abs(i) < 2 and abs(j) < 2:
                    continue
                xx = x + u * cos(angle) - v * sin(angle)
                yy = y + u * sin(angle) + v * cos(angle)
                mesh.block((xx, yy, .012), (.037, .017, .004), iron, .001)
        for offset in (-.27, .27):
            mesh.pipe([(x + offset, y, .008), (x + offset, y, .016)], .020, ink, 10)
        mesh.finish()


def build(ctx):
    mats = {
        "stone": material("Passage limestone | Scan", (.73, .62, .48), .74, scan="limestone"),
        "joint": material("Passage aged lime mortar", (.24, .199, .151), .85),
        "blue": material("Passage glazed indigo ceramic", (.040, .086, .089), .41),
        "grey": material("Passage sage ceramic", (.143, .194, .158), .56),
        "ochre": material("Passage fired ochre ceramic", (.294, .164, .065), .47),
        "iron": material("Municipal cast iron", (.092, .079, .060), .69, .67, scan="metal"),
        "bolt": material("Municipal oxidized zinc", (.24, .206, .151), .52, .68),
        "enamel": material("Municipal blue vitreous enamel", (.026, .092, .123), .35),
        "ink": material("Municipal cream lettering", (.72, .63, .49), .52),
    }
    arch = ctx.collection("Exterior | Passage Nord masonry and signage")
    for face in (-1, 1):
        arch_side(arch, face, mats)
    service_detail(ctx.collection("Exterior | Facade numbers and public works"), mats)
    ground_service(ctx.collection("Exterior | Street utility covers"), mats)
