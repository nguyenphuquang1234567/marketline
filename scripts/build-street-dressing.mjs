// Packs the Poly Haven CC0 street-dressing models into src/assets/street-dressing.glb.
//
//   npm i --no-save @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer sharp
//   node scripts/build-street-dressing.mjs <folder with one Poly Haven 1k glTF folder per model>
//
// Every variant ends up as a root node centred on its footprint with its base at y = 0.
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import {
  dedup, flatten, getBounds, meshopt, mergeDocuments, prune, simplify, textureCompress, unpartition, weld,
} from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const source = process.argv[2];
if (!source) throw new Error('Pass the folder that holds the downloaded models.');
const output = new URL('../src/assets/street-dressing.glb', import.meta.url).pathname;

// name: [triangle ratio, allowed error, groups]. A group is [prop name, node-name prefix].
const models = {
  weed_plant_02: [.35, .01, [['weed-a', 'weed_plant_02_a_LOD0'], ['weed-b', 'weed_plant_02_b_LOD0'], ['weed-c', 'weed_plant_02_c_LOD0'], ['weed-d', 'weed_plant_02_d_LOD0'], ['weed-e', 'weed_plant_02_e_LOD0']]],
  nettle_plant: [.25, .01, [['nettle-a', 'nettle_plant_medium_a_LOD0'], ['nettle-b', 'nettle_plant_small_a_LOD0'], ['nettle-c', 'nettle_plant_tall_a_LOD0']]],
  shrub_03: [.5, .008, [['shrub-a', 'shrub_03_a'], ['shrub-b', 'shrub_03_b'], ['shrub-c', 'shrub_03_c'], ['shrub-d', 'shrub_03_d']]],
  shrub_sorrel_01: [1, 0, [['sorrel-a', 'shrub_sorrel_01_a'], ['sorrel-b', 'shrub_sorrel_01_b'], ['sorrel-c', 'shrub_sorrel_01_c'], ['sorrel-d', 'shrub_sorrel_01_k']]],
  potted_plant_04: [.3, .012, [['potted-succulent', 'potted_plant_04']]],
  planter_box_01: [.3, .003, [['planter-box', 'planter_box_01']]],
  old_tyre: [.5, .003, [['tyre', 'old_tyre']]],
  rusted_wheel_rim_01: [.15, .004, [['wheel-rim', 'rusted_wheel_rim_01']]],
  cardboard_box_01: [.1, .004, [['cardboard-box', 'cardboard_box_01']]],
  plastic_crate_02: [.4, .003, [['plastic-crate', 'plastic_crate_02']]],
  wooden_crate_02: [.35, .003, [['long-crate', 'wooden_crate_02']]],
  metal_trash_can: [.2, .003, [['trash-can', 'metal_trash_can', 'metal_trash_can_rust'], ['trash-can-rusted', 'metal_trash_can_rust']]],
  metal_jerrycan_green: [.22, .003, [['jerrycan', 'metal_jerrycan_green']]],
  propane_tank: [.3, .003, [['propane-tank', 'propane_tank']]],
  namaqualand_stones_01: [.012, .12, [['stone-a', 'namaqualand_stones_01_a'], ['stone-b', 'namaqualand_stones_01_b'], ['stone-c', 'namaqualand_stones_01_c'], ['stone-d', 'namaqualand_stones_01_d'], ['stone-e', 'namaqualand_stones_01_e']]],
  can_rusted: [.12, .03, [['rusted-can', 'can_rusted']]],
  wooden_bucket_01: [.3, .003, [['bucket', 'wooden_bucket_01']]],
};

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const library = new Document();
library.createBuffer();
const report = [];

for (const [model, [ratio, error, groups]] of Object.entries(models)) {
  const document = await io.read(`${source}/${model}/${model}.gltf`);
  const root = document.getRoot();
  const scene = root.listScenes()[0];
  for (const material of root.listMaterials()) {
    if (material.getAlphaMode() === 'BLEND') material.setAlphaMode('OPAQUE');
    if (material.getAlphaMode() === 'MASK') material.setAlphaCutoff(.42);
    else material.setDoubleSided(false);
  }
  // Keep one named group per variant and drop every other node (LODs, alternates).
  await document.transform(flatten());
  const groupOf = name => groups.find(([, prefix, exclude]) => name.startsWith(prefix) && !(exclude && name.startsWith(exclude))
    && !groups.some(([, longer]) => longer.length > prefix.length && name.startsWith(longer) && longer !== exclude));
  for (const node of root.listNodes()) if (!node.getMesh() || !groupOf(node.getName())) node.dispose();
  await document.transform(
    prune(), weld(),
    ...(ratio < 1 ? [simplify({ simplifier: MeshoptSimplifier, ratio, error })] : []),
    prune(), dedup(),
  );
  const keep = new Map();
  for (const node of scene.listChildren()) {
    const [name] = groupOf(node.getName());
    if (!keep.has(name)) keep.set(name, document.createNode(name));
    keep.get(name).addChild(node);
  }
  for (const parent of keep.values()) scene.addChild(parent);
  for (const [name, parent] of keep) {
    const { min, max } = getBounds(parent);
    const t = parent.getTranslation();
    parent.setTranslation([t[0] - (min[0] + max[0]) / 2, t[1] - min[1], t[2] - (min[2] + max[2]) / 2]);
    let triangles = 0;
    parent.traverse(node => {
      for (const primitive of node.getMesh()?.listPrimitives() ?? []) triangles += primitive.getIndices().getCount() / 3;
    });
    report.push(`${name}: ${triangles} triangles, ${(max[0] - min[0]).toFixed(2)} x ${(max[1] - min[1]).toFixed(2)} x ${(max[2] - min[2]).toFixed(2)} m`);
  }
  mergeDocuments(library, document);
}

const root = library.getRoot();
const scene = root.listScenes()[0];
for (const other of root.listScenes().slice(1)) {
  for (const child of other.listChildren()) scene.addChild(child);
  other.dispose();
}
root.setDefaultScene(scene);
await library.transform(
  unpartition(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: 86 }),
  prune(), dedup(),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
library.createExtension(EXTMeshoptCompression).setRequired(true);
await io.write(output, library);
console.log(report.join('\n'));
