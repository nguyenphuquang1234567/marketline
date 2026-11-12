"""Assemble and export Al Marfa with Blender 5.3."""
import argparse
import importlib
import json
from pathlib import Path
import sys

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parent.parent
VIEWS = {
    'market': ((-1.97, 1.66, 34.2), (-.3, 1.67, 20.2), 72),
    'arch': ((.9, 1.66, -27.3), (-1.1, 4.1, -33.435), 69),
    'plaza': ((-3.25, 1.64, -28.4), (1.3, 3.13, -34.5), 75),
    'civic': ((-1.15, 1.61, -29.5), (-5.9, 2.8, -33.25), 67),
    'tea': ((-9.82, 1.65, 28.92), (-15.8, 1.28, 27.06), 68),
    'lounge': ((-16.82, 1.66, 27.25), (-21.1, 1.2, 26.75), 65),
    'workshop': ((-9.24, 1.66, 11.47), (-16.43, 1.28, 9.31), 65),
    'provisions': ((9.16, 1.66, .91), (14.6, 1.26, 1.02), 68),
    'pickup': ((1.8, 1.67, 21.7), (4.54, .99, 18.86), 55),
    'tea-counter': ((-10.45, 1.60, 28.72), (-11.67, 1.22, 30.1), 61),
    'facade-market': ((-2.3, 1.66, 38.4), (-8.02, 3.78, 44.0), 67),
    'facade-epicerie': ((3.15, 1.66, 42.8), (8.10, 2.9, 46.45), 66),
    'facade-tea': ((-4.63, 1.66, 31.32), (-8.05, 2.65, 28.56), 67),
    'facade-atelier': ((2.25, 1.66, 27.2), (8.12, 3.05, 23.25), 67),
    'facade-housing': ((.6, 1.66, -6.6), (-8.10, 5.05, -12.1), 64),
}


def from_game(point):
    x, y, z = point
    return Vector((x, -z, y))


class District:
    def __init__(self, scene, facades=()):
        self.scene = scene
        self.facades = facades
        self.collections = {collection.name: collection for collection in scene.collection.children}

    def collection(self, name):
        if name not in self.collections:
            collection = bpy.data.collections.new(name)
            self.scene.collection.children.link(collection)
            self.collections[name] = collection
        return self.collections[name]

    def move(self, obj, name):
        for collection in tuple(obj.users_collection):
            collection.objects.unlink(obj)
        self.collection(name).objects.link(obj)


def import_map(ctx, workspace):
    bpy.ops.import_scene.gltf(filepath=str(workspace / 'al-marfa-base.glb'), import_shading='NORMALS')
    for obj in list(ctx.scene.objects):
        if obj.get('worldMaterial'):
            sector = obj['worldSector'].capitalize()
            x = sum(corner[0] for corner in obj.bound_box) / 8
            lane = 'West' if x < -10 else 'East' if x > 10 else 'Market'
            ctx.move(obj, f'Map | {sector} | {lane}')
        elif obj.type == 'MESH':
            ctx.move(obj, 'Map | Signs, awnings, palms and props')
        elif obj.type == 'EMPTY':
            ctx.move(obj, 'Map | Placement origins')
    for collection in list(bpy.data.collections):
        if not collection.objects and not collection.children:
            bpy.data.collections.remove(collection)


def dressing_batches(ctx):
    batches = {}
    for collection in ctx.scene.collection.children:
        if not collection.name.startswith(('Exterior | ', 'Interiors | ')):
            continue
        for obj in collection.all_objects:
            if obj.type != 'MESH':
                continue
            center = obj.matrix_world @ (sum((Vector(corner) for corner in obj.bound_box), Vector()) / 8)
            sector = 'north' if center.y > 18 else 'south' if center.y < -22 else 'central'
            family = collection.name.split(' | ')[0]
            cast = bool(obj.get('worldCastShadow', True))
            receive = bool(obj.get('worldReceiveShadow', True))
            # Keep source objects editable. Group evaluated objects only in the export.
            batches.setdefault((sector, family, int(center.x // 14), int(center.y // 14), cast, receive), []).append(obj)
    return batches


def export_district(ctx, batches, output):
    # Keep runtime materials on the game's existing texture and shader pipeline.
    originals = {obj: list(obj.data.materials) for obj in ctx.scene.objects if obj.get('worldMaterial')}
    placeholders = {}
    for obj, materials in originals.items():
        for index, material in enumerate(materials):
            if material.name not in placeholders:
                placeholders[material.name] = bpy.data.materials.new('Runtime_' + material.name)
            obj.data.materials[index] = placeholders[material.name]

    evaluated = bpy.context.evaluated_depsgraph_get()
    export_group = ctx.collection('Export | Evaluated dressing')
    temporary = []
    for index, ((sector, family, _, _, cast, receive), objects) in enumerate(batches.items()):
        copies = []
        for obj in objects:
            derived = obj.evaluated_get(evaluated)
            mesh = bpy.data.meshes.new_from_object(derived, preserve_all_data_layers=True, depsgraph=evaluated)
            copy = bpy.data.objects.new(obj.name, mesh)
            export_group.objects.link(copy)
            copy.matrix_world = obj.matrix_world
            copies.append(copy)
        bpy.ops.object.select_all(action='DESELECT')
        for obj in copies:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = copies[0]
        if len(copies) > 1:
            bpy.ops.object.join()
        merged = bpy.context.view_layer.objects.active
        merged.name = f'Art_{sector}_{family}_{index:02d}'
        merged['worldSector'] = sector
        merged['worldCastShadow'] = cast
        merged['worldReceiveShadow'] = receive
        temporary.append(merged)

    output.mkdir(parents=True, exist_ok=True)
    try:
        for sector in ('north', 'central', 'south'):
            bpy.ops.object.select_all(action='DESELECT')
            for obj in (*originals, *temporary):
                if obj['worldSector'] == sector:
                    obj.select_set(True)
            result = bpy.ops.export_scene.gltf(
                filepath=str(output / (sector + '.glb')), export_format='GLB',
                use_selection=True, export_extras=True, export_animations=False, export_apply=False,
                export_image_format='WEBP', export_image_quality=88,
                export_vertex_color='ACTIVE', export_all_vertex_colors=False,
                export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=5,
                export_draco_position_quantization=19, export_draco_normal_quantization=12,
                export_draco_texcoord_quantization=15, export_draco_color_quantization=10,
            )
            if result != {'FINISHED'}:
                raise RuntimeError(f'Could not export {sector}: {result}')
    finally:
        for obj, materials in originals.items():
            for index, material in enumerate(materials):
                obj.data.materials[index] = material
        for obj in temporary:
            bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.collections.remove(export_group)
        for material in placeholders.values():
            bpy.data.materials.remove(material)


def add_layout(ctx, layout):
    markers = ctx.collection('Reference | Collision and spawns')
    markers.hide_render = True
    markers.hide_viewport = True
    for index, collider in enumerate(layout['colliders']):
        low = from_game([collider['min'][axis] for axis in 'xyz'])
        high = from_game([collider['max'][axis] for axis in 'xyz'])
        obj = bpy.data.objects.new(f"Collision_{index:03d}_{collider['surface']}", None)
        markers.objects.link(obj)
        obj.empty_display_type = 'CUBE'
        obj.empty_display_size = .5
        obj.location = (low + high) / 2
        obj.scale = [abs(x) for x in high - low]
    for team, spawns in enumerate(layout['spawns']):
        for index, point in enumerate(spawns):
            obj = bpy.data.objects.new(f'Spawn_{team}_{index}', None)
            markers.objects.link(obj)
            obj.empty_display_type = 'ARROWS'
            obj.location = from_game([point[axis] for axis in 'xyz'])


def lookdev(ctx, layout):
    scene = ctx.scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.length_unit = 'METERS'
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    scene.view_settings.exposure = .48
    world = bpy.data.worlds.new('Al Marfa | Afternoon')
    world.use_nodes = True
    scene.world = world
    nodes = world.node_tree.nodes
    links = world.node_tree.links
    env = nodes.new('ShaderNodeTexEnvironment')
    env.image = bpy.data.images.load(str(ROOT / 'src/assets/al-marfa-sky.webp'), check_existing=True)
    links.new(env.outputs['Color'], nodes.get('Background').inputs['Color'])
    nodes.get('Background').inputs['Strength'].default_value = 1.28

    def add_light(name, kind, position):
        data = bpy.data.lights.new(name, kind)
        obj = bpy.data.objects.new(name, data)
        ctx.collection('Lighting | Sun and practicals').objects.link(obj)
        obj.location = from_game(position)
        return obj

    sun = add_light('Afternoon sun', 'SUN', (0, 0, 0))
    sun.rotation_euler = (-from_game(layout['sun'])).to_track_quat('-Z', 'Y').to_euler()
    sun.data.energy = 2.45
    sun.data.color = (1.0, .86, .69)
    sun.data.angle = .020
    for name, position, energy, radius, tint in (
        ('Tea counter', (-11.5, 2.38, 29.1), 165, .16, (1, .77, .54)),
        ('Tea lounge', (-18.4, 2.38, 27.8), 148, .15, (1, .74, .51)),
        ('Provisions counter', (10.2, 2.44, .2), 148, .13, (1, .79, .59)),
        ('Workshop bench', (-12.0375, 2.47, 11.795), 142, .16, (1, .87, .72)),
        ('East workshop practical', (13.2, 2.46, -17.10), 94, .15, (1, .88, .73)),
    ):
        lamp = add_light(name, 'POINT', position)
        lamp.data.energy = energy
        lamp.data.shadow_soft_size = radius
        lamp.data.color = tint

    for index, z in enumerate((29.2, 24.09, 18.92)):
        sconce = add_light(f'Tea sconce {index + 1}', 'POINT', (-21.27, 2.08, z))
        sconce.data.energy = 30
        sconce.data.shadow_soft_size = .09
        sconce.data.color = (1.0, .67, .42)

    for name, position, target, energy, size, tint in (
        ('Light bounced from tea entrance', (-9.08, 2.19, 29.30), (-14.9, 1.19, 28.63), 87, 1.75, (.73, .82, 1.0)),
        ('Light bounced from tea lounge wall', (-20.80, 2.49, 26.23), (-17.35, .76, 27.1), 51, 2.1, (1, .78, .58)),
        ('Light bounced from provisions entrance', (9.20, 2.25, .23), (13.25, 1.18, .36), 66, 1.70, (.81, .87, 1)),
    ):
        bounce = add_light(name, 'AREA', position)
        bounce.rotation_euler = (from_game(target) - bounce.location).to_track_quat('-Z', 'Y').to_euler()
        bounce.data.energy = energy
        bounce.data.shape = 'DISK'
        bounce.data.size = size
        bounce.data.color = tint

    for label, (eye, target, fov) in VIEWS.items():
        camera = bpy.data.cameras.new(label)
        obj = bpy.data.objects.new('Camera | ' + label, camera)
        ctx.collection('Cameras | Player height').objects.link(obj)
        obj.location = from_game(eye)
        obj.rotation_euler = (from_game(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()
        camera.lens_unit = 'FOV'
        camera.angle = fov * 3.14159265 / 180
        camera.clip_end = 350
        if label == 'market':
            scene.camera = obj

    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 64
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 7
    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1080
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == 'VIEW_3D':
                area.spaces.active.region_3d.view_perspective = 'CAMERA'
                area.spaces.active.overlay.show_overlays = False


def main():
    cli = argparse.ArgumentParser()
    cli.add_argument('--workspace', type=Path, default=ROOT / '.blender-work')
    cli.add_argument('--game', type=Path, default=ROOT / 'src/assets/al-marfa')
    cli.add_argument('--blend', type=Path, default=ROOT / 'art/Al-Marfa.blend')
    cli.add_argument('--base-only', action='store_true')
    cli.add_argument('--export-only', action='store_true', help='Re-export the currently open Al Marfa .blend')
    args = cli.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    if args.export_only:
        ctx = District(bpy.context.scene)
        if not any(obj.get('worldMaterial') for obj in ctx.scene.objects):
            cli.error('--export-only requires the Al Marfa .blend')
        export_district(ctx, dressing_batches(ctx), args.game)
        return
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0
    sys.path.insert(0, str(ROOT / 'scripts'))
    layout = json.loads((args.workspace / 'al-marfa-layout.json').read_text())
    ctx = District(bpy.context.scene, layout['facades'])
    ctx.scene.name = 'Al Marfa | Marketline'
    import_map(ctx, args.workspace)
    if not args.base_only:
        for module_name in ('al_marfa_street', 'al_marfa_interiors', 'al_marfa_materials',
                            'al_marfa_facade_roofs', 'al_marfa_facade_shops',
                            'al_marfa_facade_upper', 'al_marfa_facade_wear'):
            importlib.import_module(module_name).build(ctx)
    bpy.context.view_layer.update()
    export_district(ctx, dressing_batches(ctx), args.game)
    if not args.base_only:
        from al_marfa_materials import enhance_preview
        enhance_preview()
    add_layout(ctx, layout)
    lookdev(ctx, layout)
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.file.pack_all()
    args.blend.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(args.blend.resolve()), compress=True)
    meshes = [obj for obj in ctx.scene.objects if obj.type == 'MESH']
    triangles = sum(len(poly.vertices) - 2 for obj in meshes for poly in obj.data.polygons)
    print(f'Al Marfa: {len(meshes)} mesh objects, {triangles:,} source triangles')


if __name__ == '__main__':
    main()
