"""Render the saved district from its named player-height cameras."""
import argparse
from pathlib import Path
import sys

import bpy

cli = argparse.ArgumentParser()
cli.add_argument('views', nargs='+')
cli.add_argument('--out', type=Path, required=True)
cli.add_argument('--width', type=int, default=1440)
cli.add_argument('--samples', type=int, default=48)
cli.add_argument('--metal', action='store_true')
args = cli.parse_args(sys.argv[sys.argv.index('--') + 1:])
args.out.mkdir(parents=True, exist_ok=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = args.samples
scene.cycles.use_denoising = True
scene.cycles.adaptive_threshold = .025
scene.render.resolution_x = args.width
scene.render.resolution_y = round(args.width * 9 / 16)

cycles = bpy.context.preferences.addons.get('cycles')
scene.cycles.device = 'CPU'
if cycles is not None and args.metal:
    try:
        cycles.preferences.compute_device_type = 'METAL'
        cycles.preferences.refresh_devices()
        devices = [d for d in cycles.preferences.devices if d.type == 'METAL']
        for device in cycles.preferences.devices:
            device.use = device in devices
        if devices:
            scene.cycles.device = 'GPU'
    except (RuntimeError, TypeError):
        scene.cycles.device = 'CPU'

for view in args.views:
    scene.camera = bpy.data.objects['Camera | ' + view]
    scene.render.filepath = str((args.out / (view + '.png')).resolve())
    bpy.ops.render.render(write_still=True)
