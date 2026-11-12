"""Editable Blender dressing for the four walkable Al Marfa shops.

Coordinates are in the existing storefront frame: u along the facade, v
towards the street and h measured from grade. Fixture details stay on
existing counters, against walls or above the playable volume.
"""

import math

import bpy
import numpy as np
from mathutils import Matrix, Vector


def linear(rgb):
    value = np.array(rgb, dtype=np.float32) / 255
    return np.where(value < .04045, value / 12.92, ((value + .055) / 1.055) ** 2.4)


def finish(name, rgb, roughness, metal=0., pattern=None, strength=.0):
    """Make a shared PBR finish with an optional packed tileable color/relief map."""
    mat = bpy.data.materials.new("M_Shop_" + name)
    tint = tuple(float(channel) for channel in linear(rgb)) + (1.,)
    mat.diffuse_color = tint
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    shader = next(node for node in nodes if node.type == 'BSDF_PRINCIPLED')
    shader.inputs['Base Color'].default_value = tint
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = metal
    if not pattern:
        return mat

    size = 128
    rng = np.random.default_rng(sum(map(ord, name)))
    x, y = np.meshgrid(np.arange(size) / size * math.tau, np.arange(size) / size * math.tau)
    noise = rng.normal(0, 1, x.shape).clip(-2, 2)
    cloud = np.sin(3*x + 4*y) * np.cos(x - 2*y) * .35 + np.sin(5*x - 3*y) * .32 + noise * .18
    if pattern == 'grain':
        groove = np.sin(x * 23 + 2.5 * np.sin(y * 2 + x * 3) + 2 * np.cos(x * 8 + y))
        cloud += groove * .27 + np.cos(x * 59 + 2 * np.sin(y * 2)) * .12
    elif pattern == 'woven':
        cloud *= .43
        cloud += np.cos(x * 31) * .38 + np.cos(y * 33) * .38 + np.cos(x * 31 + y * 33) * .11
    elif pattern == 'ceramic':
        cloud = cloud * .77 + np.sin(x * 4 + 1.7 * np.cos(y * 3)) * .32 + np.sin(13*x + 19*y) * .10

    color = np.empty((size, size, 4), dtype=np.float32)
    color[..., :3] = np.clip(np.asarray(rgb) / 255 * (1. + strength * cloud[..., None]), 0, 1)
    color[..., 3] = 1
    image = bpy.data.images.new("T_Shop_" + name + "_BC", size, size, alpha=False)
    # The image is byte-backed, so its pixel values are already encoded sRGB.
    image.pixels.foreach_set(color.ravel())
    image.pack()
    texture = nodes.new('ShaderNodeTexImage')
    texture.image = image
    texture.label = "Packed tileable surface"
    texture.location = (-420, 280)
    links.new(texture.outputs['Color'], shader.inputs['Base Color'])

    height = np.clip(cloud, -1.4, 1.4) * .0022
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * .5 * size
    dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * .5 * size
    norm = np.sqrt(1. + dx * dx + dy * dy)
    color[..., 0] = .5 - .5 * dx / norm
    color[..., 1] = .5 - .5 * dy / norm
    color[..., 2] = .5 + .5 / norm
    image = bpy.data.images.new("T_Shop_" + name + "_N", size, size, alpha=False)
    image.colorspace_settings.name = 'Non-Color'
    image.pixels.foreach_set(color.ravel())
    image.pack()
    texture = nodes.new('ShaderNodeTexImage')
    texture.image = image
    texture.location = (-420, 10)
    normal = nodes.new('ShaderNodeNormalMap')
    normal.location = (-180, 0)
    normal.inputs['Strength'].default_value = .65
    links.new(texture.outputs['Color'], normal.inputs['Color'])
    links.new(normal.outputs['Normal'], shader.inputs['Normal'])
    return mat


def finishes():
    return {
        'wood': finish('Oiled_Walnut', (94, 65, 44), .56, pattern='grain', strength=.43),
        'brass': finish('Oxidized_Brass', (177, 133, 72), .44, .79, 'metal', .25),
        'steel': finish('Brushed_Steel', (116, 117, 108), .41, .83, 'grain', .20),
        'iron': finish('Dark_Cast_Iron', (56, 64, 58), .65, .42, 'metal', .45),
        'enamel': finish('Worn_Olive_Enamel', (93, 102, 75), .57, .28, 'metal', .33),
        'cotton': finish('Unbleached_Linen', (167, 147, 110), .88, pattern='woven', strength=.37),
        'red': finish('Dull_Red_Dye', (135, 71, 49), .83, pattern='woven', strength=.33),
        'paper': finish('Cream_Paper', (191, 173, 135), .93, pattern='woven', strength=.19),
        'ink': finish('Printed_Ink', (59, 70, 59), .90),
        'white': finish('Cream_Stoneware', (203, 185, 145), .37, pattern='ceramic', strength=.23),
        'green': finish('Green_Glaze', (67, 103, 83), .31, pattern='ceramic', strength=.40),
        'blue': finish('Blue_Glaze', (55, 92, 105), .34, pattern='ceramic', strength=.38),
        'amber': finish('Tea_Amber', (100, 50, 20), .29),
        'terracotta': finish('Terracotta', (160, 94, 61), .73, pattern='ceramic', strength=.33),
        'ground': finish('Cracked_Rubber', (54, 50, 43), .92, pattern='metal', strength=.29),
        'turmeric': finish('Ground_Turmeric', (184, 121, 38), .91, pattern='woven', strength=.35),
        'paprika': finish('Paprika', (154, 64, 43), .92, pattern='woven', strength=.34),
        'coriander': finish('Ground_Coriander', (148, 121, 79), .92, pattern='woven', strength=.34),
        'zaatar': finish('Dried_Herbs', (96, 104, 65), .96, pattern='woven', strength=.37),
    }


class Room:
    def __init__(self, collection, materials, x, z, sign, width, depth):
        self.collection = collection
        self.materials = materials
        self.width, self.depth = width, depth
        self.sign = sign
        self.origin = Vector((x, -z, 0))
        self.basis = Matrix.Rotation(sign * math.pi / 2, 4, 'Z')
        self.assembly = None

    def begin(self, name):
        label = self.collection.name.split(' | ')[-1].replace(' ', '_')
        self.assembly = bpy.data.objects.new(f"Interior_{label}_{name}", None)
        self.assembly.empty_display_type = 'PLAIN_AXES'
        self.assembly.empty_display_size = .035
        self.collection.objects.link(self.assembly)

    def mesh(self, name, verts, faces, material, uv_faces=None, smooth=False, at=(0, 0, 0), yaw=0):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(verts, [], faces)
        mesh.update()
        ob = bpy.data.objects.new(name, mesh)
        ob.parent = self.assembly
        ob.location = self.origin + self.basis @ Vector((at[0], -at[1], at[2]))
        ob.rotation_euler[2] = self.sign * math.pi / 2 - yaw
        self.collection.objects.link(ob)
        mesh.materials.append(self.materials[material])
        layer = mesh.uv_layers.new(name='UVMap')
        for poly in mesh.polygons:
            poly.use_smooth = smooth
            if uv_faces and uv_faces[poly.index] is not None:
                uvs = uv_faces[poly.index]
            else:
                normal = poly.normal
                axes = sorted(range(3), key=lambda axis: abs(normal[axis]))[:2]
                uvs = [(verts[index][axes[0]] / .21, verts[index][axes[1]] / .21) for index in poly.vertices]
            for loop, uv in zip(poly.loop_indices, uvs):
                layer.uv[loop].vector = uv
        return ob

    def box(self, name, at, size, material, bevel=.003, yaw=0):
        a, b, c = (dimension / 2 for dimension in size)
        verts = [(-a,-b,-c), (a,-b,-c), (a,b,-c), (-a,b,-c),
                 (-a,-b,c), (a,-b,c), (a,b,c), (-a,b,c)]
        ob = self.mesh(name, verts, [(0,3,2,1), (4,5,6,7), (0,1,5,4),
                                     (1,2,6,5), (2,3,7,6), (3,0,4,7)], material, at=at, yaw=yaw)
        if bevel:
            modifier = ob.modifiers.new('Rounded exposed edges', 'BEVEL')
            modifier.width = min(bevel, min(size) * .34)
            modifier.segments = 2 if bevel > .0035 else 1
            modifier.harden_normals = True
        return ob

    def lathe(self, name, at, profile, material, segments=24):
        verts, rings, faces, uvs = [], [], [], []
        for row, (radius, height) in enumerate(profile):
            if row and row == len(profile) - 1 and profile[0] == (radius, height):
                rings.append(rings[0])
                continue
            ring = []
            for i in range(segments if radius else 1):
                angle = math.tau * i / segments
                ring.append(len(verts))
                verts.append((radius * math.cos(angle), radius * math.sin(angle), height))
            rings.append(ring)
        for row, (lower, upper) in enumerate(zip(rings, rings[1:])):
            lo, hi = (profile[row][1] / .18, profile[row + 1][1] / .18)
            if len(lower) == len(upper) == 1:
                continue
            for i in range(segments):
                j = (i + 1) % segments
                u0, u1 = i / segments, (i + 1) / segments
                if len(lower) == 1:
                    faces.append((lower[0], upper[j], upper[i]))
                    uvs.append(None if lo == hi else [((u0 + u1) / 2, lo), (u1, hi), (u0, hi)])
                elif len(upper) == 1:
                    faces.append((lower[i], lower[j], upper[0]))
                    uvs.append(None if lo == hi else [(u0, lo), (u1, lo), ((u0 + u1) / 2, hi)])
                else:
                    faces.append((lower[i], lower[j], upper[j], upper[i]))
                    uvs.append(None if lo == hi else [(u0, lo), (u1, lo), (u1, hi), (u0, hi)])
        return self.mesh(name, verts, faces, material, uvs, True, at)

    def tube(self, name, path, radius, material, sides=8, closed=False):
        points = [Vector((u, -v, h)) for u,v,h in path]
        origin = points[0].copy()
        verts, faces = [], []
        uvs = []
        distances = [0.]
        axis = None
        count = len(points)
        for i, point in enumerate(points):
            previous = (i - 1) % count if closed else max(0, i - 1)
            following = (i + 1) % count if closed else min(count - 1, i + 1)
            direction = (points[following] - points[previous]).normalized()
            if axis is None:
                reference = Vector((0, 0, 1)) if abs(direction.z) < .94 else Vector((1, 0, 0))
                axis = direction.cross(reference).normalized()
            else:
                # Carry the previous ring orientation through tight elbows.
                axis = (axis - direction * axis.dot(direction)).normalized()
                distances.append(distances[-1] + (point - points[previous]).length / .21)
            side = direction.cross(axis).normalized()
            for j in range(sides):
                angle = math.tau * j / sides
                verts.append(tuple(point - origin + radius * (math.cos(angle) * axis + math.sin(angle) * side)))
        if closed:
            distances.append(distances[-1] + (points[-1] - points[0]).length / .21)
        for i in range(count if closed else count - 1):
            for j in range(sides):
                a, b = i * sides, ((i + 1) % count) * sides
                k = (j + 1) % sides
                faces.append((a + j, a + k, b + k, b + j))
                u0, u1 = math.tau * radius / .21 * j / sides, math.tau * radius / .21 * (j + 1) / sides
                uvs.append([(u0, distances[i]), (u1, distances[i]),
                            (u1, distances[i+1]), (u0, distances[i+1])])
        if not closed:
            faces += [tuple(reversed(range(sides))), tuple(range(len(verts) - sides, len(verts)))]
            uvs += [None, None]
        return self.mesh(name, verts, faces, material, uvs, True, at=(origin.x, -origin.y, origin.z))

    def oval(self, name, at, radii, material, noise=0., phase=0.):
        a, b, c = radii
        rings = [(.43, -.91), (.79, -.61), (1, -.19), (.94, .22), (.74, .62), (.42, .9)]
        verts = [(0, 0, -c)]
        sides = 16
        for row, (radius, height) in enumerate(rings):
            for i in range(sides):
                angle = math.tau * i / sides
                fold = noise * (.65 * math.cos(5 * angle + 1.2 * row + phase) + .35 * math.sin(3 * angle - row))
                verts.append((a * math.cos(angle) * radius * (1 + fold),
                              b * math.sin(angle) * radius * (1 + fold), c * height))
        faces = [(0, (i + 1) % sides + 1, i + 1) for i in range(sides)]
        for row in range(len(rings) - 1):
            for i in range(sides):
                a0, b0 = 1 + row * sides + i, 1 + row * sides + (i + 1) % sides
                faces.append((a0, b0, b0 + sides, a0 + sides))
        top = len(verts)
        verts.append((0, 0, c))
        faces.extend((top - sides + i, top - sides + (i + 1) % sides, top) for i in range(sides))
        return self.mesh(name, verts, faces, material, smooth=True, at=at)


def saucer(room, x, v, h, size=.081, glaze='green'):
    return room.lathe('Ceramic_saucer', (x, v, h),
                      [(0,0), (size*.64,0), (size*.82,.004), (size,.015), (size,.019),
                       (size*.91,.018), (size*.66,.008), (0,.008)], glaze)


def cup(room, x, v, h, glaze='white', filled=False):
    room.lathe('Tea_cup', (x,v,h), [(0,0),(.026,0),(.033,.008),(.043,.051),(.042,.056),
                                  (.038,.056),(.038,.05),(.029,.01),(0,.01)], glaze, 24)
    room.tube('Cup_handle', [(x + .035 + .019 * math.sin(a), v, h + .029 + .016 * math.cos(a))
                              for a in np.linspace(0., math.tau, 15, endpoint=False)], .0042, glaze, 7, True)
    if filled:
        room.lathe('Tea_surface', (x,v,h + .035), [(0,0),(.036,0),(.037,.002),(0,.002)], 'amber', 20)


def tea_service(room, x, v, h):
    room.lathe('Hand_hammered_tray', (x,v,h), [(0,0),(.14,0),(.176,.012),(.178,.018),
                                            (.168,.017),(.149,.005),(0,.005)], 'brass')
    for i, (dx, dv) in enumerate([(-.092, -.041),(.068, .075),(.047, -.083)]):
        saucer(room, x+dx, v+dv, h+.006, .055, 'green' if i == 1 else 'blue')
        cup(room, x+dx, v+dv, h+.014, 'green' if i == 1 else 'white', filled=i != 2)
    room.tube('Tea_spoon_stem', [(x-.08,v+.077,h+.018),(x-.03,v+.117,h+.022)], .0035, 'brass')
    room.oval('Tea_spoon_bowl', (x-.094,v+.066,h+.019), (.019,.012,.004), 'brass')


def teapot(room, x, v, h, glaze):
    room.lathe('Glazed_teapot', (x,v,h), [(0,0),(.065,0),(.088,.018),(.105,.047),
                                        (.102,.083),(.079,.111),(.064,.121),(.067,.126),
                                        (.058,.135),(.026,.148),(.014,.151),(.016,.163),
                                        (.012,.172),(0,.172)], glaze, 32)
    room.tube('Cast_bronze_spout', [(x+.07,v,h+.048),(x+.109,v,h+.067),
                                  (x+.133,v,h+.094),(x+.162,v,h+.119)], .015, 'brass', 12)
    room.tube('Cast_bronze_handle', [(x-.07,v,h+.028),(x-.114,v,h+.032),(x-.133,v,h+.053),
                                   (x-.137,v,h+.085),(x-.119,v,h+.112),(x-.072,v,h+.109)],
              .009, 'brass', 10)


def wall_tiles(room, v, center, height, count):
    for i in range(count):
        x = center + (i - (count - 1) / 2) * .142
        room.box('Glazed_tile', (x, v, height), (.136,.014,.136), ['blue','white','green','white'][i % 4], .0013)
        room.box('Inlaid_rosette', (x, v + .008, height), (.036,.003,.036),
                 ['white','green','white','blue'][i % 4], .0007, yaw=0.)


def tea_room(room):
    w, d = room.width, room.depth
    room.begin('Service_Counter')
    x, v = -w / 2 + .755, d * .268
    # The original tea service occupies v + .68 and the tins occupy v - 1.31…-.44.
    teapot(room, x + .03, v + 1.35, .907, 'green')
    for i in range(3):
        saucer(room, x + .25, v + 1.13, .907 + i * .008, .052, 'white')
    cup(room, x + .25, v + 1.13, .941, 'white')
    room.box('Folded_service_linen', (x + .176, v + .16, .912), (.24,.33,.012), 'cotton', .004, yaw=.16)
    room.box('Folded_linen_edge', (x + .191, v + .154, .921), (.205,.299,.007), 'red', .003, yaw=.16)

    rear = -d / 2 + .333
    room.begin('Lounge_Wall')
    wall_tiles(room, rear + .058, -w * .21, 1.023, 33)
    wall_tiles(room, rear + .058, w * .22, 1.023, 33)
    for x in [-w * .36, .11, w * .38]:
        room.box('Brass_sconce_mount', (x,rear+.072,1.96), (.084,.038,.143), 'brass', .006)
        room.tube('Bent_lamp_arm', [(x,rear+.085,1.94),(x,rear+.138,1.92),
                                  (x,rear+.181,1.96),(x,rear+.186,2.00)], .009, 'brass')
        room.lathe('Sconce_cup', (x,rear+.186,1.993),
                   [(0,0),(.039,0),(.053,.022),(.055,.028),(.051,.03),(.038,.023),(0,.02)], 'brass')
        room.lathe('Opaque_opaline_chimney', (x,rear+.186,2.015),
                   [(0,0),(.031,0),(.044,.024),(.040,.047),(.029,.064),(.028,.12),
                    (.032,.143),(.029,.146),(.025,.144),(.023,.12),(.024,.063),
                    (.034,.045),(.038,.024),(.026,.005),(0,.005)], 'white')

    room.begin('Arch_Finishes')
    for center, span in [(-w*.277, 3.18), (w*.219, 3.42)]:
        for side in (-1, 1):
            facade = .58 + side*.144
            room.box('Oiled_arch_header', (center,facade,2.709), (span+.12,.046,.116), 'wood', .004)
            room.box('Narrow_brass_inlay', (center,facade+side*.025,2.74),
                     (span+.066,.008,.007), 'brass', .0008)
            for i in range(21):
                at = center + (i - 10) * span / 22
                room.box('Arch_header_inlay', (at,facade+side*.024,2.700), (.047,.008,.040),
                         ['green','white','blue','white'][i%4], .001)

    room.begin('Lounge_Tables')
    table_v = -d / 2 + 1.98
    for i, x in enumerate([-w * .246, w * .23]):
        tea_service(room, x + .238, table_v + .04, .4825)
        saucer(room, x - .026, table_v - .149, .4825, .071, 'green')
        for k in range(5):
            room.oval('Pressed_date', (x-.065+.021*k,table_v-.14+(k%2)*.015,.507), (.017,.010,.010), 'amber', .12, k)
        room.box('Linen_napkin', (x + .522, table_v + .162, .486), (.13,.16,.007), 'cotton', .002, yaw=.25 - i*.44)

    room.begin('Bench_Upholstery')
    bench_v = -d / 2 + .72
    for center, span in [(-w*.244, w*.392), (w*.228, w*.371)]:
        count = math.floor(span / .65 + .5)
        for i in range(count):
            x = center + (i - (count - 1) / 2) * span / count
            base_h = .505 + (i % 3) * .004
            half = span / count * .45
            room.tube('Seat_double_stitch', [(x-half,bench_v+.283,base_h),
                                            (x-half+.012,bench_v+.289,base_h+.004),
                                            (x+half-.012,bench_v+.289,base_h+.004),
                                            (x+half,bench_v+.283,base_h)], .0024, 'cotton', 5)


def workbench_vice(room, x, v, h):
    room.lathe('Vise_swivel_base', (x,v,h), [(0,0),(.121,0),(.13,.012),
                                           (.129,.035),(.105,.046),(0,.046)], 'iron')
    room.box('Vise_cast_body', (x,v,h+.105), (.158,.208,.12), 'enamel', .021)
    room.box('Vise_fixed_jaw', (x,v-.106,h+.152), (.192,.045,.081), 'iron', .009)
    room.box('Vise_sliding_jaw', (x,v+.117,h+.143), (.192,.053,.087), 'iron', .009)
    for offset in (-.082, .09):
        room.box('Hardened_jaw_insert', (x,v+offset,h+.177), (.166,.016,.032), 'steel', .0015)
        for tooth in range(15):
            room.box('Jaw_serration', (x + (tooth-7)*.0105, v+offset, h+.194),
                     (.0035,.015,.0038), 'steel', .0005)
    room.tube('Vise_lead_screw', [(x,v-.13,h+.092),(x,v+.189,h+.092)], .019, 'steel', 12)
    room.tube('Vise_sliding_handle', [(x-.132,v+.179,h+.076),(x+.128,v+.179,h+.106)], .008, 'steel', 10)
    for offset in (-.13, .128):
        room.oval('Handle_stop', (x+offset,v+.179,h+.091+offset*.116), (.011,.011,.011), 'steel')


def electrical_spool(room, x, v, h):
    room.lathe('Cable_reel_hub', (x,v,h), [(0,0),(.125,0),(.125,.014),(.064,.015),(.064,.145),
               (.128,.146),(.128,.158),(.113,.162),(.028,.162),(.025,.153),(0,.153)], 'wood', 24)
    for i in range(10):
        rise = i * .0113
        path = [(x+.069*math.cos(a), v+.069*math.sin(a), h+.022+rise)
                for a in np.linspace(0, math.tau, 28, endpoint=False)]
        room.tube('Wound_power_cord', path, .0055, 'ground', 6, True)
    room.tube('Loose_cable_tail', [(x+.064,v+.02,h+.123),(x+.108,v+.019,h+.131),
                                 (x+.135,v+.016,h+.081),(x+.164,v+.022,h+.02),
                                 (x+.19,v+.075,h+.008),(x+.158,v+.142,h+.007)],
              .006, 'ground', 8)


def wrench(room, x, v, h, size, angle):
    c, s = math.cos(angle), math.sin(angle)

    def put(u, z, z_height):
        return (x+size*(u*c-z*s), v+size*(u*s+z*c), h+z_height)

    room.tube('Wrench_forged_shank', [put(.1,0,.007), put(.54,0,.009), put(.87,0,.010)], size*.04, 'steel', 8)
    room.tube('Wrench_box_end', [put(.093+.10*math.cos(a), .10*math.sin(a), .009)
                                 for a in np.linspace(0, math.tau, 12, endpoint=False)], size*.031, 'steel', 7, True)
    room.tube('Wrench_open_jaw', [put(u,z,.010) for u,z in [(1.04,-.109),(.95,-.118),(.874,-.064),
                                                          (.857,0),(.878,.067),(.951,.122),(1.04,.102)]],
              size*.033, 'steel', 7)


def workshop(room, west):
    w,d = room.width, room.depth
    x,v = -w / 2 + .44, d * .185
    top = .8665
    room.begin('Vise_And_Tools')
    if west:
        workbench_vice(room, x + .081, v - .89, top)
    else:
        electrical_spool(room, x + .081, v - .89, top)
    for dx,dv,a,length in [(.049,-.40,.75,.26),(.12,-.063,1.40,.21),
                           (-.08,-.18,1.10,.18),(-.16,.23,1.78,.20)]:
        wrench(room, x+dx, v+dv, top, length, a)
    room.box('Tool_parts_tray', (x+.041,v+.84,top+.015), (.315,.365,.03), 'iron', .009)
    for side in (-1,1):
        room.box('Tray_rolled_side', (x+.041+side*.149,v+.84,top+.035), (.019,.36,.03), 'enamel', .006)
        room.box('Tray_rolled_end', (x+.041,v+.84+side*.172,top+.035), (.297,.019,.03), 'enamel', .006)
    for i in range(8):
        px, pv = x - .068 + (i % 4) * .069, v + .744 + (i // 4) * .096
        room.lathe('Hex_nut', (px,pv,top+.031), [(.013,0),(.026,0),(.030,.007),(.030,.025),
                                               (.025,.031),(.014,.031),(.012,.024),(.012,0),(.013,0)], 'steel', 6)
    room.begin('Workshop_Utilities')
    top = 2.72
    wall_x = -w / 2 + .259
    cable_color = 'ground' if west else 'iron'
    room.tube('Surface_mounted_conduit', [(wall_x+.035,-d/2+.62,top),(wall_x+.035,-d/2+1.3,top),
                                         (wall_x+.035,d*.2,top),(wall_x+.035,d*.23,top-.035),
                                         (wall_x+.035,d*.23,top-.58)], .012, cable_color, 8)
    for dz in (-d/2+1.08, -d*.13, d*.08):
        room.box('Conduit_wall_clip', (wall_x+.027,dz,top), (.046,.026,.039), 'iron', .003)
    room.box('Electrical_junction_box', (wall_x+.055,d*.23,2.09), (.119,.161,.184), 'enamel', .014)
    room.box('Fuse_label', (wall_x+.118,d*.229,2.117), (.007,.096,.045), 'paper', .001)
    for i in range(4):
        room.box('Fuse_label_print', (wall_x+.123,d*.229,2.103+i*.010), (.003,.065-i*.006,.003), 'ink', .0005)
    room.begin('Parts_Shelf')
    base_v = -d*.23
    room.box('Workshop_catalogue', (x+.30,base_v+.60,.91+.013), (.218,.284,.024), 'red', .004, yaw=.26)
    room.box('Catalogue_spine', (x+.203,base_v+.626,.924), (.027,.245,.028), 'paper', .002, yaw=.26)
    for i in range(2):
        room.lathe('Oil_tin', (x+.18,base_v-.69+.22*i,.905),
                   [(0,0),(.061,0),(.066,.007),(.066,.139),(.058,.148),(.048,.151),(.015,.151),
                    (.016,.176),(.020,.180),(.020,.197),(.017,.201),(0,.201)], 'enamel' if i else 'iron')
        room.box('Stamped_tin_label', (x+.246,base_v-.69+.22*i,.985), (.005,.067,.071), 'paper', .002)


def fill_surface(room, x, v, h, a, b, kind, phase):
    verts = [(0.,0.,.024)]
    rings, sides = 3, 20
    for row in range(1, rings+1):
        distance = row / rings
        for i in range(sides):
            angle = math.tau * i / sides
            z = .026 * (1 - distance ** 1.6)
            z += .005 * math.sin(3*angle + phase) * distance + .003 * math.cos(7*angle + row)
            verts.append((a*distance*math.cos(angle), b*distance*math.sin(angle), z))
    faces = [(0, i+1, (i+1)%sides+1) for i in range(sides)]
    for row in range(rings-1):
        for i in range(sides):
            a0 = 1 + row*sides + i
            b0 = 1 + row*sides + (i+1)%sides
            faces.append((a0, a0+sides, b0+sides, b0))
    # Add a closed underside to the small spice piles for reliable shadows.
    verts.append((0.,0.,-.007))
    for i in range(sides):
        base = 1 + (rings-1)*sides
        faces.append((len(verts)-1, base+(i+1)%sides, base+i))
    room.mesh('Loose_spice_pile', verts, faces, kind, smooth=True, at=(x,v,h))


def provisions(room):
    w,d = room.width, room.depth
    x,v = -w / 2 + .69, d * .22
    room.begin('Spice_Trays')
    for i, spice in enumerate(['turmeric','paprika','coriander','zaatar']):
        at = v + (i-1.5)*.78
        room.lathe('Hand_thrown_spice_bowl', (x-.075,at,1.048),
                   [(0,0),(.074,0),(.083,.01),(.118,.045),(.128,.084),(.128,.092),(.119,.092),
                    (.112,.081),(.099,.055),(.067,.022),(0,.021)], 'terracotta' if i%2 else 'green', 28)
        fill_surface(room, x-.075, at, 1.125, .111, .111, spice, i*.88)
        room.oval('Tied_sample_bag', (x+.112,at+.149,1.092), (.088,.073,.043), 'cotton', .15, i)
        room.tube('Sample_twist_tie', [(x+.135,at+.186,1.112),(x+.151,at+.2,1.123),
                                      (x+.166,at+.197,1.120)], .003, 'red')
        room.box('Spice_label_block', (x+.259,at-.189,1.095), (.085,.141,.088), 'wood', .006)
        room.box('Paper_label_face', (x+.305,at-.189,1.096), (.007,.123,.067), 'paper', .002)
        for line in range(3):
            room.box('Spice_label_type', (x+.31,at-.189,1.080+line*.013),
                     (.003,.096-line*.013,.0035), 'ink', .0005)
    room.begin('Warehouse_Parcels')
    for i in range(3):
        dx, dv = .27 + i*.053, -.77 + i*.62
        room.box('Wrapped_paper_parcel', (x+dx,-d*.23+dv,.905+.068), (.27,.357,.137), 'paper', .012, yaw=.16-i*.17)
        for side in (-1,1):
            room.tube('Parcel_cotton_string', [(x+dx-.132,-d*.23+dv+side*.075,1.034),
                                              (x+dx-.087,-d*.23+dv+side*.075,1.044),
                                              (x+dx+.095,-d*.23+dv+side*.075,1.044),
                                              (x+dx+.129,-d*.23+dv+side*.075,1.037)], .0026, 'cotton')
        room.box('Parcel_ink_stamp', (x+dx+.031,-d*.23+dv-.002,1.044), (.085,.045,.004), 'ink', .001, yaw=.05-i*.14)
    rear = -d / 2 + .333
    room.begin('Provision_Wall')
    wall_tiles(room, rear+.059, -w*.23, 1.027, 29)
    for i in range(3):
        px = w*(.10+i*.105)
        room.box('Shelf_wall_batten', (px,rear+.084,1.55), (.071,.092,.74), 'wood', .004)
    for h in [1.32,1.73]:
        room.box('Provision_high_wall_ledge', (w*.205,rear+.16,h), (w*.31,.214,.047), 'wood', .005)
        for i in range(6):
            px = w*.205 + (i-2.5)*.405
            size = .053 + (i%3)*.012
            jar_h = .146 + ((i+int(h*5))%4)*.023
            room.lathe('Stoneware_preserve_jar', (px,rear+.16,h+.024),
                       [(0,0),(size*.72,0),(size,.018),(size,jar_h*.66),
                        (size*.78,jar_h*.81),(size*.70,jar_h*.87),(size*.88,jar_h*.88),
                        (size*.91,jar_h*.95),(size*.70,jar_h),(0,jar_h)],
                       ['white','green','blue','terracotta'][(i+int(h*5))%4], 20)


def build(ctx):
    mats = finishes()
    for name, x, z, sign, width, depth, action in [
        ('Tea Room', -15.1, 24.2, 1, 13.9, 14., tea_room),
        ('West Workshop', -14.35, 5.75, 1, 14.8, 12.5, lambda room: workshop(room, True)),
        ('Provisions', 14., 5.2, -1, 14.25, 11.7, provisions),
        ('East Workshop', 15.2, -11.64, -1, 12.95, 14.1, lambda room: workshop(room, False)),
    ]:
        room = Room(ctx.collection('Interiors | ' + name), mats, x, z, sign, width, depth)
        action(room)
