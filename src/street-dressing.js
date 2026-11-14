import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import dressingURL from './assets/street-dressing.glb?url&inline';

// Scanned street clutter from Poly Haven. Everything here is set dressing: it
// hugs walls and kerbs, has no collision, and stays out of doorways and lanes.
const PLANTS = [
  ['weed-a', 2.2, 4], ['weed-b', 2.2, 4], ['weed-c', 2.6, 4.6], ['weed-d', 2.6, 4.6], ['weed-e', 3, 5],
  ['nettle-a', 2, 3.4], ['nettle-b', 2.6, 4.2], ['nettle-c', 1.6, 2.8],
  ['shrub-a', 1.1, 1.9], ['shrub-b', 1.1, 1.9], ['shrub-c', 1.2, 2.1], ['shrub-d', 1.2, 2.1],
  ['sorrel-a', 2.4, 4], ['sorrel-b', 2.4, 4], ['sorrel-c', 2.6, 4.4], ['sorrel-d', 2.6, 4.4],
];
const STONES = ['stone-a', 'stone-b', 'stone-c', 'stone-d', 'stone-e'];
// name, depth against the wall, chance weight, pitch, lift
const PROPS = [
  ['cardboard-box', .52, 5, 0, 0], ['plastic-crate', .41, 4, 0, 0], ['long-crate', .53, 2, 0, 0],
  ['trash-can', .55, 2, 0, 0], ['trash-can-rusted', .55, 2, 0, 0], ['jerrycan', .17, 3, 0, 0],
  ['propane-tank', .34, 2, 0, 0], ['bucket', .37, 3, 0, 0], ['planter-box', .41, 3, 0, 0],
  ['potted-succulent', .18, 3, 0, 0], ['tyre', .6, 3, Math.PI / 2, .08], ['wheel-rim', .4, 1, Math.PI / 2, .075],
];
const PROP_WEIGHT = PROPS.reduce((sum, prop) => sum + prop[2], 0);
const AXES = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// heightAt reports the visible top surface, so the scatter follows the art
// (kerbs, plinths) instead of the simplified collision boxes.
export function scatterStreetDressing({ heightAt, physics, bounds, spawns, seed, density = 1 }) {
  const random = seeded(seed ^ 0x51ed270b);
  const range = (lo, hi) => lo + (hi - lo) * random();
  const placements = [];
  const origin = new THREE.Vector3(), toward = new THREE.Vector3(), half = new THREE.Vector3();
  const spawnPoints = spawns.flat();
  const add = (name, x, y, z, yaw, scale = 1, pitch = 0, lift = 0) => placements.push({ name, x, y, z, yaw, scale, pitch, lift });
  const CELL = 1.15;
  for (let gx = bounds.minX + 1; gx < bounds.maxX - 1; gx += CELL) {
    for (let gz = bounds.minZ + 1; gz < bounds.maxZ - 1; gz += CELL) {
      const x = gx + random() * CELL, z = gz + random() * CELL;
      const roll = random(), choice = random(), spin = random() * Math.PI * 2;
      if (spawnPoints.some(spawn => Math.hypot(spawn.x - x, spawn.z - z) < 2.2)) continue;
      // Find a solid wall beside the point. Cornices and balconies overhang
      // the wall base, so walls come from collision and not from the height field.
      let face = null;
      origin.set(x, .9, z);
      for (const [dx, dz] of AXES) {
        const hit = physics.raycast(origin, toward.set(dx, 0, dz), face ? face.distance : .62);
        if (hit && hit.distance > .02 && Math.abs(hit.normal.y) < .5 && hit.collider.max.y - hit.collider.min.y > 1.8) face = hit;
      }
      if (!face) {
        // Kerb joints in the open catch grit and the occasional seedling.
        const ground = heightAt(x, z);
        if (ground > .42 || roll > .25 * density) continue;
        let kerb = false;
        for (const [dx, dz] of AXES) {
          const step = heightAt(x + dx * .3, z + dz * .3) - ground;
          if (step > .05 && step < .32) kerb = true;
        }
        if (!kerb) continue;
        if (roll < .16 * density) add(STONES[Math.floor(choice * STONES.length)], x, ground, z, spin, range(.7, 1.6));
        else {
          const [name, lo, hi] = PLANTS[12 + Math.floor(choice * 4)];
          add(name, x, ground, z, spin, range(lo, hi));
        }
        continue;
      }
      const nx = face.normal.x, nz = face.normal.z;
      const wx = face.point.x, wz = face.point.z;
      // Read the pavement level just beyond the overhang; a covered strip is an
      // arcade, awning or interior, which the authored map already dresses.
      let ground = Infinity;
      for (const out of [.75, 1.05, 1.4]) ground = Math.min(ground, heightAt(wx + nx * out, wz + nz * out));
      if (ground > .42) continue;
      const level = (px, pz) => {
        const h = heightAt(px, pz);
        return h > 1.5 || Math.abs(h - ground) < .05;
      };
      const yawToWall = Math.atan2(nx, nz);
      if (roll < .30 * density) {
        // Weeds seed along the joint between wall and pavement in small colonies.
        const colony = 1 + Math.floor(random() * 3.4);
        for (let i = 0; i < colony; i++) {
          const [name, lo, hi] = PLANTS[Math.floor((i ? random() : choice) * PLANTS.length)];
          const out = range(.08, .2), along = i ? range(-.55, .55) : 0;
          add(name, wx + nx * out - nz * along, ground, wz + nz * out + nx * along, random() * 6.28, range(lo, hi));
        }
      } else if (roll < .47 * density) {
        const count = 1 + Math.floor(random() * 3);
        for (let i = 0; i < count; i++) {
          const out = range(.06, .55), along = range(-.4, .4);
          const px = wx + nx * out - nz * along, pz = wz + nz * out + nx * along;
          if (level(px, pz)) {
            add(STONES[Math.floor(random() * STONES.length)], px, ground, pz, random() * 6.28, range(.8, 2.4));
          }
        }
      } else if (roll < .50 * density) {
        const px = wx + nx * range(.14, .4), pz = wz + nz * range(.14, .4);
        if (level(px, pz)) add('rusted-can', px, ground, pz, spin, 1, random() < .6 ? Math.PI / 2 : 0, .06);
      } else if (roll < .565 * density) {
        let pickAt = choice * PROP_WEIGHT, prop = PROPS[0];
        for (const candidate of PROPS) {
          prop = candidate;
          if ((pickAt -= candidate[2]) <= 0) break;
        }
        const [name, depth, , pitch, lift] = prop;
        const out = depth / 2 + .07;
        const px = wx + nx * out, pz = wz + nz * out;
        // Whole footprint on level ground and clear of collision.
        if (!level(px + nx * depth / 2, pz + nz * depth / 2) || !level(px - nz * depth / 2, pz + nx * depth / 2)
          || !level(px + nz * depth / 2, pz - nx * depth / 2)) continue;
        if (physics.overlapBox(origin.set(px, .62, pz), half.set(depth / 2 + .02, .5, depth / 2 + .02))) continue;
        add(name, px, ground + lift, pz, yawToWall + range(-.22, .22) + (pitch ? spin : 0), 1, pitch, 0);
      }
    }
  }
  return placements;
}

// The baked map's loose rubble is faceted placeholder geometry merged into a
// few meshes. Find each stone in them and stand a scanned stone in its place.
export function replaceRubble(meshes, seed) {
  const random = seeded(seed ^ 0x7ab1e);
  const placements = [];
  const point = new THREE.Vector3();
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.getIndex();
    if (!position || !index) continue;
    mesh.updateMatrixWorld();
    // Weld by position, then join vertices that share a triangle.
    const parent = new Int32Array(position.count);
    const welded = new Map();
    const world = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      world.set([point.x, point.y, point.z], i * 3);
      const key = `${Math.round(point.x * 500)},${Math.round(point.y * 500)},${Math.round(point.z * 500)}`;
      if (!welded.has(key)) welded.set(key, i);
      parent[i] = welded.get(key);
    }
    const find = i => {
      while (parent[i] !== i) i = parent[i] = parent[parent[i]];
      return i;
    };
    for (let i = 0; i < index.count; i += 3) {
      const a = find(index.getX(i)), b = find(index.getX(i + 1)), c = find(index.getX(i + 2));
      parent[b] = a;
      parent[find(c)] = a;
    }
    const stones = new Map();
    for (let i = 0; i < position.count; i++) {
      const root = find(i);
      let box = stones.get(root);
      if (!box) stones.set(root, box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
      for (let axis = 0; axis < 3; axis++) {
        box[axis] = Math.min(box[axis], world[i * 3 + axis]);
        box[axis + 3] = Math.max(box[axis + 3], world[i * 3 + axis]);
      }
    }
    for (const [x0, y0, z0, x1, y1, z1] of stones.values()) {
      const width = Math.max(x1 - x0, z1 - z0);
      if (width > .6) return [];
      placements.push({
        name: STONES[Math.floor(random() * STONES.length)], x: (x0 + x1) / 2, y: y0, z: (z0 + z1) / 2,
        yaw: random() * Math.PI * 2, scale: Math.max(.35, width / .12), pitch: 0, lift: 0,
      });
    }
    mesh.visible = false;
  }
  return placements;
}

export async function loadStreetDressing(scene, placements) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const { scene: library } = await loader.loadAsync(dressingURL);
  library.updateMatrixWorld(true);
  const groups = new Map();
  for (const placement of placements) {
    // Local bounds let the scene and the shadow cameras cull distant batches.
    const key = [placement.name, Math.floor(placement.x / 22), Math.floor(placement.z / 22)].join(':');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(placement);
  }
  const dressing = new THREE.Group();
  dressing.name = 'Street dressing';
  const position = new THREE.Vector3(), scale = new THREE.Vector3();
  const rotation = new THREE.Quaternion(), euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const transform = new THREE.Matrix4();
  for (const entries of groups.values()) {
    const name = entries[0].name;
    const template = library.getObjectByName(name);
    if (!template) throw new Error(`Missing street prop: ${name}`);
    const small = /^(weed|nettle|sorrel|stone|rusted)/.test(name);
    template.traverse(part => {
      if (!part.isMesh) return;
      const foliage = part.material.alphaTest > 0;
      if (foliage) {
        part.material.side = THREE.DoubleSide;
        part.material.alphaToCoverage = false;
      }
      part.material.envMapIntensity = .7;
      part.geometry.morphAttributes = {};
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, entries.length);
      // Leaf cards would cast solid quads through the depth-only shadow pass.
      mesh.castShadow = !small && !foliage;
      mesh.receiveShadow = true;
      mesh.userData.nearShadowOnly = true;
      entries.forEach(({ x, y, z, yaw, scale: size, pitch, lift }, index) => {
        rotation.setFromEuler(euler.set(pitch, yaw, 0));
        transform.compose(position.set(x, y + lift, z), rotation, scale.setScalar(size)).multiply(part.matrixWorld);
        mesh.setMatrixAt(index, transform);
      });
      mesh.computeBoundingSphere();
      mesh.userData.drawDistance = small ? 34 : foliage ? 48 : 95;
      dressing.add(mesh);
    });
  }
  scene.add(dressing);
  // Grit and seedlings cover a pixel or two beyond a few dozen metres; dropping
  // those batches keeps the draw-call and triangle cost local to the player.
  const update = eye => {
    for (const mesh of dressing.children) {
      const { center, radius } = mesh.boundingSphere;
      mesh.visible = center.distanceTo(eye) < mesh.userData.drawDistance + radius;
    }
  };
  return { group: dressing, update };
}
