import { LoadingManager } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import decoderURL from 'three/addons/libs/draco/gltf/draco_decoder.js?url&inline';
import wasmURL from 'three/addons/libs/draco/gltf/draco_decoder.wasm?url&inline';
import wrapperURL from 'three/addons/libs/draco/gltf/draco_wasm_wrapper.js?url&inline';
import north from './assets/al-marfa/north.glb?url&inline';
import central from './assets/al-marfa/central.glb?url&inline';
import south from './assets/al-marfa/south.glb?url&inline';

export const AL_MARFA_SEED = 2324;

export async function loadAlMarfa(world) {
  // The normal browser build and the file:// edition share the same bundled
  // decoder. URLs are embedded by Vite, including the worker's WASM payload.
  const decoderFiles = {
    'draco_decoder.js': decoderURL,
    'draco_wasm_wrapper.js': wrapperURL,
    'draco_decoder.wasm': wasmURL,
  };
  // Use a dedicated manager so unrelated glTF assets don't inherit these URLs.
  const manager = new LoadingManager().setURLModifier(url => decoderFiles[url] ?? url);
  const decoder = new DRACOLoader(manager).setWorkerLimit(2);
  const loader = new GLTFLoader().setDRACOLoader(decoder);
  try {
    const sectors = await Promise.allSettled([north, central, south].map(url => loader.loadAsync(url)));
    const meshes = [];
    const failed = sectors.find(result => result.status === 'rejected');
    for (const result of sectors) {
      if (result.status !== 'fulfilled') continue;
      const scene = result.value.scene;
      scene.updateMatrixWorld(true);
      scene.traverse(object => {
        if (!object.isMesh) return;
        if (!object.userData.worldSector && object.parent?.userData.worldSector) {
          Object.assign(object.userData, object.parent.userData);
        }
        meshes.push(object);
      });
    }
    if (failed) {
      for (const mesh of meshes) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      throw failed.reason;
    }
    for (const mesh of meshes) {
      mesh.matrix.copy(mesh.matrixWorld);
      mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
    }
    world.attachBakedWorld(meshes);
  } finally {
    decoder.dispose();
  }
}
