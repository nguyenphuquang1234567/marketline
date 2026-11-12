import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const output = resolve(process.argv[2] ?? '.blender-work');
await mkdir(output, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: true } });
try {
  await server.listen();
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  try {
    const page = await browser.newPage();
    await page.route('**/al-marfa-extract', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
    await page.goto(new URL('al-marfa-extract', server.resolvedUrls.local[0]).href);
    await page.exposeFunction('writeAlMarfa', (name, base64) =>
      writeFile(resolve(output, name), Buffer.from(base64, 'base64')));
    const count = await page.evaluate(async () => {
      const [
        { Scene, Mesh, Matrix4 },
        { GLTFExporter },
        { buildWorld },
        { waitForWorldMaterials },
        { loadMarketProps },
        { MARKET_SUN },
      ] = await Promise.all([
        import('/node_modules/three/build/three.module.js'),
        import('/node_modules/three/examples/jsm/exporters/GLTFExporter.js'),
        import('/src/world.js'),
        import('/src/world-materials.js'),
        import('/src/market-props.js'),
        import('/src/market-sky.js'),
      ]);
      const scene = new Scene();
      const facades = [];
      const world = buildWorld(scene, 2324, { facadeLayout: facades });
      await waitForWorldMaterials();
      await loadMarketProps(scene, world.assetPlacements);
      scene.updateMatrixWorld(true);
      const staticMeshes = [];
      const exportMaterials = new Map();
      for (const object of scene.children) {
        if (!object.userData.worldMaterial) continue;
        const key = object.userData.worldMaterial;
        if (!exportMaterials.has(key)) {
          const material = object.material.clone();
          material.name = 'ml_' + key;
          exportMaterials.set(key, material);
        }
        object.material = exportMaterials.get(key);
        const center = object.geometry.boundingSphere.center;
        const sector = center.z < -18 ? 'north' : center.z > 22 ? 'south' : 'central';
        object.name = 'ML_' + sector + '_' + key;
        Object.assign(object.userData, {
          worldSector: sector, worldCastShadow: object.castShadow, worldReceiveShadow: object.receiveShadow,
        });
        staticMeshes.push(object);
      }
      // Three's instancing exporter writes an extension Blender may not import.
      // Preview-only props reuse their original geometry and are placed individually.
      const props = scene.getObjectByName('Market shop goods');
      const transform = new Matrix4();
      for (const instance of [...props.children]) {
        for (let index = 0; index < instance.count; index++) {
          const mesh = new Mesh(instance.geometry, instance.material);
          instance.getMatrixAt(index, transform);
          transform.decompose(mesh.position, mesh.quaternion, mesh.scale);
          mesh.name = 'Market prop';
          props.add(mesh);
        }
        instance.removeFromParent();
      }
      scene.children.filter(object => object.isPoints).forEach(object => object.removeFromParent());
      const result = await new GLTFExporter().parseAsync(scene, { binary: true, maxTextureSize: 1024 });
      const blob = new Blob([result]);
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      await window.writeAlMarfa('al-marfa-base.glb', base64);
      await window.writeAlMarfa('al-marfa-layout.json', btoa(JSON.stringify({
        colliders: world.colliders, bounds: world.bounds, spawns: world.spawns, sun: MARKET_SUN.toArray(), facades,
      })));
      return staticMeshes.length;
    });
    console.log(`Extracted ${count} static map meshes to ${output}`);
  } finally {
    await browser.close();
  }
} finally {
  await server.close();
}
