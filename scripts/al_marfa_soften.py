"""Chamfer the hard outside corners of Al Marfa's masonry.

Real plaster and stone never meet at a perfect edge. A narrow chamfer with
area-weighted normals gives every corner a highlight and a soft terminator
without changing the silhouette the collision proxies were built for.

Run on the saved scene, then re-export:

    blender -b art/Al-Marfa.blend --python-exit-code 1 -P scripts/al_marfa_soften.py
"""
import math

import bmesh
import bpy

# worldMaterial: chamfer width in metres
WIDTHS = {'plaster': .022, 'brick': .02, 'limestone': .012}
MIN_ANGLE = math.radians(35)
MIN_LENGTH = .3


def soften(obj, width):
    mesh = obj.data
    if 'custom_normal' in mesh.attributes:
        mesh.attributes.remove(mesh.attributes['custom_normal'])
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=.0002)
    before = len(bm.faces)
    chosen = []
    for edge in bm.edges:
        # Pieces that only touch must not share shading.
        edge.smooth = len(edge.link_faces) == 2 and edge.calc_face_angle(0) < math.radians(2)
        if len(edge.link_faces) != 2 or edge.calc_face_angle(0) < MIN_ANGLE:
            continue
        low = min(vert.co.z for vert in edge.verts)
        # Blender is Z-up here. Skip edges buried in the paving and tiny trim.
        if edge.is_convex and edge.calc_length() >= MIN_LENGTH and low > .04 \
                and min(face.calc_area() for face in edge.link_faces) > .02:
            chosen.append(edge)
    result = bmesh.ops.bevel(
        bm, geom=chosen, offset=width, offset_type='OFFSET', segments=1, profile=.5,
        affect='EDGES', clamp_overlap=True, loop_slide=True, harden_normals=False,
    )
    for face in bm.faces:
        face.smooth = True
    # Only the two long edges of each chamfer blend into their neighbours.
    for face in result['faces']:
        for edge in face.edges:
            if len(edge.link_faces) == 2 and edge.calc_face_angle(0) < math.radians(60):
                edge.smooth = True
    bm.to_mesh(mesh)
    after = len(bm.faces)
    bm.free()
    mesh.update()
    modifier = obj.modifiers.new('Weighted corner normals', 'WEIGHTED_NORMAL')
    modifier.mode = 'FACE_AREA'
    modifier.weight = 100
    modifier.keep_sharp = True
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj['worldSoftened'] = True
    return len(chosen), before, after


def build(ctx=None):
    scene = ctx.scene if ctx else bpy.context.scene
    totals = [0, 0, 0]
    for obj in scene.objects:
        width = WIDTHS.get(obj.get('worldMaterial'))
        if obj.type != 'MESH' or not width or obj.get('worldSoftened'):
            continue
        for index, value in enumerate(soften(obj, width)):
            totals[index] += value
    print(f'Softened {totals[0]:,} corners: {totals[1]:,} -> {totals[2]:,} faces')


if __name__ == '__main__':
    build()
    bpy.ops.wm.save_mainfile(compress=True)
