import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import propsURL from './assets/market-props.glb?url&inline';

export async function loadMarketProps(scene, placements) {
  const { scene: library } = await new GLTFLoader().loadAsync(propsURL);
  library.updateMatrixWorld(true);
  const groups = new Map();
  for (const placement of placements) {
    const { name, x, z } = placement;
    // Local bounds let the scene and the shadow cameras cull distant batches.
    const key = [name, Math.floor(x / 24), Math.floor(z / 24)].join(':');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(placement);
  }

  const dressing = new THREE.Group();
  dressing.name = 'Market shop goods';
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const scale = new THREE.Vector3(1, 1, 1);
  const transform = new THREE.Matrix4();
  const localTransform = new THREE.Matrix4();

  for (const entries of groups.values()) {
    const template = library.getObjectByName(entries[0].name);
    if (!template) throw new Error(`Missing market prop: ${entries[0].name}`);
    const anchorInverse = template.matrixWorld.clone().invert();
    template.traverse(part => {
      if (!part.isMesh) return;
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, entries.length);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData.nearShadowOnly = true;
      localTransform.multiplyMatrices(anchorInverse, part.matrixWorld);
      entries.forEach(({ x, y, z, yaw }, index) => {
        rotation.setFromAxisAngle(up, yaw);
        transform.compose(position.set(x, y, z), rotation, scale).multiply(localTransform);
        mesh.setMatrixAt(index, transform);
      });
      mesh.computeBoundingSphere();
      dressing.add(mesh);
    });
  }
  scene.add(dressing);
}
