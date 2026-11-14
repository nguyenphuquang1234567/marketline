# Marketline environment textures

The textures are from [Poly Haven](https://polyhaven.com/textures) and distributed under [CC0 1.0](https://polyhaven.com/license).

| Local material | Poly Haven source |
| --- | --- |
| Plaster | [Painted Plaster Wall](https://polyhaven.com/a/painted_plaster_wall) and [Damaged Plaster](https://polyhaven.com/a/damaged_plaster) |
| Road | [Cobblestone Floor 07](https://polyhaven.com/a/cobblestone_floor_07) |
| Asphalt | [Worn Asphalt](https://polyhaven.com/a/worn_asphalt) |
| Limestone | [Concrete Floor Worn 02](https://polyhaven.com/a/concrete_floor_worn_02) |
| Brick | [Sandstone Blocks 04](https://polyhaven.com/a/sandstone_blocks_04) |
| Wood | [Weathered Planks](https://polyhaven.com/a/weathered_planks) |
| Metal | [Metal Plate 02](https://polyhaven.com/a/metal_plate_02) |
| Shutter | [Painted Metal Shutter](https://polyhaven.com/a/painted_metal_shutter) |
| Cloth | [Denim Fabric 03](https://polyhaven.com/a/denim_fabric_03) |

Plaster, damaged plaster, road, asphalt, limestone, brick and wood use the 2K downloads for albedo and normal. Albedos are rescaled per channel to keep the neutral tone the map's vertex colors expect. Normals are near-lossless WebP. Packed occlusion, roughness and metallic maps are 1K lossless WebP. `road-height` and `brick-height` are the scans' 1K displacement maps, normalized, and drive relief mapping. Metal, shutter and cloth stay at 1K. Vite embeds the texture files for offline play.

## Street dressing models

`../street-dressing.glb` packs these [Poly Haven models](https://polyhaven.com/models), also CC0. `scripts/build-street-dressing.mjs` simplifies them, resizes their textures to 512 px WebP and writes the file.

[Weed Plant 02](https://polyhaven.com/a/weed_plant_02), [Nettle Plant](https://polyhaven.com/a/nettle_plant), [Shrub 03](https://polyhaven.com/a/shrub_03), [Shrub Sorrel 01](https://polyhaven.com/a/shrub_sorrel_01), [Potted Plant 04](https://polyhaven.com/a/potted_plant_04), [Planter Box 01](https://polyhaven.com/a/planter_box_01), [Old Tyre](https://polyhaven.com/a/old_tyre), [Rusted Wheel Rim 01](https://polyhaven.com/a/rusted_wheel_rim_01), [Cardboard Box 01](https://polyhaven.com/a/cardboard_box_01), [Plastic Crate 02](https://polyhaven.com/a/plastic_crate_02), [Wooden Crate 02](https://polyhaven.com/a/wooden_crate_02), [Metal Trash Can](https://polyhaven.com/a/metal_trash_can), [Metal Jerrycan Green](https://polyhaven.com/a/metal_jerrycan_green), [Propane Tank](https://polyhaven.com/a/propane_tank), [Namaqualand Stones 01](https://polyhaven.com/a/namaqualand_stones_01), [Can Rusted](https://polyhaven.com/a/can_rusted), [Wooden Bucket 01](https://polyhaven.com/a/wooden_bucket_01).
