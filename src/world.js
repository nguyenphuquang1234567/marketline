import * as THREE from 'three';
import { createScannedMaterial, WORLD_MATERIAL_METERS } from './world-materials.js';
import {
  addAccessibleShopInterior, addDetailedShopRecess, addDoorSurround, addFacadePier, addPlasterHood,
  addServiceEntrance, addShopRecess, addShopRecessInterior, addStoreCanopy, createFacadeMaterials,
} from './facade-details.js';
import { sandbagGeometry, sandbagSeamGeometry } from './sandbag-geometry.js';
import { addCastIronDrain, addMarketScale, addMeterDetails, addRolledShutter, addSteelDrum, addTimberCrate, streetLabel, succulentLeaf, terracottaPlanter } from './street-details.js';
import { addPickupDetails } from './pickup-details.js';
import { createStreetMaterials } from './street-finishes.js';
import { addServicePaving, addStoneRunner, addUtilityRepairs } from './market-paving.js';
import { addLoadingAwning, addShadePergola, dressStall, reinforceAwning } from './market-stall.js';
import { addMarketSkyline } from './market-skyline.js';

const UP = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;
const BOX = new THREE.BoxGeometry();
const PANEL = new THREE.PlaneGeometry();
const PIPE = new THREE.CylinderGeometry(1, 1, 1, 10);
const DRUM = new THREE.CylinderGeometry(1, 1, 1, 18);
const POT = new THREE.CylinderGeometry(1, 0.63, 1, 10);
const ROCK = new THREE.DodecahedronGeometry(1, 0);
const LEAF = new THREE.SphereGeometry(1, 8, 4);
const vector = (x, y, z) => new THREE.Vector3(x, y, z);

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function makeMaterials(seed) {
  const materials = Object.fromEntries(
    Object.keys(WORLD_MATERIAL_METERS).map(kind => [kind, createScannedMaterial(kind)]),
  );
  materials.flat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.04 });
  materials.glass = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.18, metalness: 0.46, emissive: 0x1b2933, emissiveIntensity: 0.28,
  });
  materials.enamel = new THREE.MeshPhysicalMaterial({
    vertexColors: true, roughness: 0.38, metalness: 0.12, clearcoat: 0.5, clearcoatRoughness: 0.28,
  });
  materials.rubber = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.84 });
  materials.autoGlass = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.16, metalness: 0.22, side: THREE.DoubleSide,
  });
  materials.lantern = new THREE.MeshStandardMaterial({
    vertexColors: true, color: 0xffe4a8, roughness: 0.25, metalness: 0.1, emissive: 0xffb85c, emissiveIntensity: 2.1,
  });
  materials.stallCloth = materials.cloth.clone();
  materials.stallCloth.side = THREE.DoubleSide;
  materials.skyline = materials.plaster.clone();
  materials.skyline.name = 'Marketline skyline';
  materials.gravel = materials.plaster;
  materials.stain = new THREE.MeshStandardMaterial({
    map: stainTexture(seed), vertexColors: true, roughness: 0.98, transparent: true,
    opacity: 0.72, alphaTest: 0.016, depthWrite: false,
  });
  return materials;
}

function stainTexture(seed) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 192;
  const ctx = canvas.getContext('2d');
  const random = seeded(seed);
  for (let i = 0; i < 72; i++) {
    const x = 3 + random() * 121;
    const length = 22 + random() * 165;
    const width = 0.55 + random() * 5.2;
    const edgeFade = Math.sin(x / 128 * Math.PI);
    const alpha = 0.21 * edgeFade * (0.4 + 0.6 * random());
    const color = `rgba(255,250,240,${alpha.toFixed(3)})`;
    const gradient = ctx.createLinearGradient(0, 2, 0, length);
    gradient.addColorStop(0, '#ffffff00');
    gradient.addColorStop(0.05, color);
    gradient.addColorStop(0.28, color);
    gradient.addColorStop(1, '#ffffff00');
    ctx.fillStyle = gradient;
    ctx.fillRect(x, 2, width, length);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

class StaticBatches {
  constructor(scene, materials, enabled) {
    this.scene = scene;
    this.materials = materials;
    this.enabled = enabled;
    this.batches = new Map();
    this.transform = new THREE.Matrix4();
    this.normal = new THREE.Matrix3();
    this.orientation = new THREE.Quaternion();
    this.scale = vector(1, 1, 1);
    this.position = vector(0, 0, 0);
    this.point = vector(0, 0, 0);
    this.normVec = vector(0, 0, 0);
    this.tint = new THREE.Color();
  }

  add(geometry, material, color, x, y, z, sx, sy, sz, angle = 0, uScale = 1, vScale = 1) {
    if (!this.enabled) return;
    const cell = Math.floor((x + 16) / 32) + ':' + Math.floor((z + 16) / 32);
    const key = material + ':' + cell;
    let batch = this.batches.get(key);
    if (!batch) {
      batch = { position: [], normal: [], uv: [], color: [], index: [], material };
      this.batches.set(key, batch);
    }
    if (typeof angle === 'number') this.orientation.setFromAxisAngle(UP, angle);
    else this.orientation.copy(angle);
    this.transform.compose(this.position.set(x, y, z), this.orientation, this.scale.set(sx, sy, sz));
    this.normal.getNormalMatrix(this.transform);
    this.tint.set(color);
    const p = geometry.getAttribute('position');
    const n = geometry.getAttribute('normal');
    const uv = geometry.getAttribute('uv');
    const colors = geometry.getAttribute('color');
    const offset = batch.position.length / 3;
    const fixedUV = material.startsWith('sign') || ['stain', 'mosaic', 'poster', 'streetLabel', 'cabinGlass', 'shopRug', 'shopMenu'].includes(material);
    const isGround = ['road', 'asphalt', 'gravel', 'lantern'].includes(material);
    const textureType = material === 'sandbag' || material === 'stallCloth' ? 'cloth'
      : material === 'skyline' ? 'plaster' : material;
    const meters = WORLD_MATERIAL_METERS[textureType];
    const worldUV = ['plaster', 'road', 'asphalt', 'limestone', 'brick', 'shutter'].includes(textureType);
    const uOffset = fixedUV ? 0 : (x * 0.19 + z * 0.13) % 1;
    const vOffset = fixedUV ? 0 : y * 0.2 % 1;
    for (let i = 0; i < p.count; i++) {
      const localY = p.getY(i);
      this.point.fromBufferAttribute(p, i).applyMatrix4(this.transform);
      const wx = this.point.x, wy = this.point.y, wz = this.point.z;
      batch.position.push(wx, wy, wz);
      this.normVec.fromBufferAttribute(n, i).applyNormalMatrix(this.normal).normalize();
      const nx = this.normVec.x, ny = this.normVec.y, nz = this.normVec.z;
      batch.normal.push(nx, ny, nz);
      if (worldUV) {
        // Match texture scale and phase across adjoining wall pieces and paving strips.
        if (Math.abs(ny) > 0.55) batch.uv.push(wx / meters[0], -Math.sign(ny) * wz / meters[1]);
        else if (Math.abs(nz) >= Math.abs(nx)) batch.uv.push(Math.sign(nz) * wx / meters[0], wy / meters[1]);
        else batch.uv.push(-Math.sign(nx) * wz / meters[0], wy / meters[1]);
      } else {
        const alongU = geometry === BOX ? (i >= 8 ? sx : sz) : uScale;
        const alongV = geometry === BOX ? (i >= 8 && i < 16 ? sz : sy) : vScale;
        if (material === 'wood' && geometry === BOX && alongU > alongV * 1.35) {
          batch.uv.push(uv.getY(i) * alongV / meters[0] + uOffset,
            (1 - uv.getX(i)) * alongU / meters[1] + vOffset);
        } else {
          batch.uv.push(uv.getX(i) * alongU / (meters?.[0] ?? 1) + uOffset,
            uv.getY(i) * alongV / (meters?.[1] ?? 1) + vOffset);
        }
      }

      // Procedural Vertex Ambient Occlusion & Directional Cavity Shading
      let ao = 1.0;
      if (!fixedUV && !isGround) {
        const groundContact = 0.80 + 0.20 * Math.min(1, Math.max(0, wy / 0.52));
        const hemiShade = ny > 0.45 ? 1.035 : ny < -0.45 ? 0.79 : 0.96 + 0.04 * (localY + 0.5);
        const hash = Math.sin(Math.round(wx * 23) * 12.9898 + Math.round(wy * 23) * 78.233 + Math.round(wz * 23) * 37.719) * 43758.5453;
        const micro = 0.97 + 0.06 * (hash - Math.floor(hash));
        ao = groundContact * hemiShade * micro;
      }
      if (colors) batch.color.push(this.tint.r * ao * colors.getX(i), this.tint.g * ao * colors.getY(i), this.tint.b * ao * colors.getZ(i));
      else batch.color.push(this.tint.r * ao, this.tint.g * ao, this.tint.b * ao);
    }
    const index = geometry.getIndex();
    if (index) for (let i = 0; i < index.count; i++) batch.index.push(offset + index.getX(i));
    else for (let i = 0; i < p.count; i++) batch.index.push(offset + i);
  }

  build() {
    for (const batch of this.batches.values()) {
      const meshGeometry = new THREE.BufferGeometry();
      meshGeometry.setAttribute('position', new THREE.Float32BufferAttribute(batch.position, 3));
      meshGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(batch.normal, 3));
      meshGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(batch.uv, 2));
      meshGeometry.setAttribute('color', new THREE.Float32BufferAttribute(batch.color, 3));
      meshGeometry.setIndex(batch.index);
      meshGeometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(meshGeometry, this.materials[batch.material]);
      mesh.name = 'Static_' + batch.material;
      mesh.userData.worldMaterial = batch.material;
      mesh.castShadow = !['road', 'asphalt', 'glass', 'autoGlass', 'cabinGlass', 'gravel', 'stain', 'lantern', 'mosaic', 'poster', 'streetLabel', 'shopTile', 'shopRug', 'shopMenu', 'skyline'].includes(batch.material)
        && !batch.material.startsWith('sign');
      mesh.receiveShadow = batch.material !== 'lantern' && batch.material !== 'skyline';
      this.scene.add(mesh);
    }
    this.batches.clear();
  }
}

function signTexture(title, subtitle, background, ink, motif = false) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 176;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, 512, 176);

  // Subtle sun-bleached vignette & weathered border
  const grad = ctx.createRadialGradient(256, 88, 30, 256, 88, 280);
  grad.addColorStop(0, 'rgba(255,248,230,0.08)');
  grad.addColorStop(1, 'rgba(18,14,10,0.28)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 176);

  ctx.strokeStyle = ink;
  ctx.lineWidth = 3.5;
  ctx.strokeRect(8, 8, 496, 160);
  ctx.lineWidth = 1.2;
  ctx.strokeRect(14, 14, 484, 148);

  // Corner mounting bolts
  for (const [bx, by] of [[22, 22], [490, 22], [22, 154], [490, 154]]) {
    ctx.fillStyle = 'rgba(28,22,18,0.65)';
    ctx.beginPath();
    ctx.arc(bx, by, 4.5, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = title === 'THÉ & MENTHE' ? 'bold 49px Georgia, serif' : '800 53px sans-serif';
  ctx.fillText(title, 256, 64, 448);
  ctx.font = title === 'THÉ & MENTHE' ? 'bold 29px serif' : 'bold 23px sans-serif';
  ctx.fillText(subtitle, 256, 125, 412);
  if (motif) {
    for (const x of [39, 473]) {
      ctx.beginPath();
      ctx.moveTo(x, 101);
      ctx.lineTo(x + 10, 114);
      ctx.lineTo(x, 127);
      ctx.lineTo(x - 10, 114);
      ctx.closePath();
      ctx.fill();
    }
  }
  const random = seeded(7185 + title.length);
  for (let i = 0; i < 4200; i++) {
    ctx.fillStyle = i % 3 ? 'rgba(227,196,141,.14)' : 'rgba(31,26,19,.21)';
    ctx.fillRect(random() * 512, random() * 176, random() * 3.2, random() * 2.2);
  }
  // Edge paint chipping & rust streaks from bolts
  for (const [bx, by] of [[22, 22], [490, 22]]) {
    const rust = ctx.createLinearGradient(0, by, 0, by + 55);
    rust.addColorStop(0, 'rgba(68,32,14,0.38)');
    rust.addColorStop(1, 'rgba(68,32,14,0)');
    ctx.fillStyle = rust;
    ctx.fillRect(bx - 2.5, by + 3, 5, 52);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.78, metalness: 0.08 });
}

function clothTexture(primary, secondary) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = primary;
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = secondary;
  for (let i = 0; i < 8; i++) {
    ctx.fillRect(i * 32 + 4, 0, 13, 128);
    ctx.fillRect(i * 32 + 22, 0, 2.5, 128);
  }
  // Dark folded hem and two fine stitch lines.
  ctx.fillStyle = 'rgba(49,38,27,0.20)';
  ctx.fillRect(0, 120, 256, 8);
  ctx.fillStyle = 'rgba(221,207,174,0.46)';
  for (let x = 2; x < 256; x += 5) {
    ctx.fillRect(x, 120, 2, 1);
    ctx.fillRect(x, 125, 2, 1);
  }
  const random = seeded(651);
  for (let i = 0; i < 4800; i++) {
    ctx.fillStyle = i % 2 ? '#2a211232' : '#fdf5d436';
    ctx.fillRect(random() * 256, random() * 128, 0.7 + random() * 2.0, 0.9);
  }
  for (const x of [1, 253]) {
    ctx.fillStyle = '#30282482';
    ctx.fillRect(x, 0, 2, 128);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return new THREE.MeshStandardMaterial({
    map: tex, roughness: 0.91, side: THREE.DoubleSide, color: 0xffffff,
  });
}

export function buildWorld(scene, seed = 56103, { baked = false, facadeLayout = null, buildingLayout = null } = {}) {
  const sceneOffset = scene.children.length;
  const rand = seeded(seed);
  const range = (lo, hi) => lo + (hi - lo) * rand();
  const pick = list => list[Math.floor(rand() * list.length)];
  const materials = makeMaterials(seed);
  const bounds = { minX: -65, maxX: 65, minZ: -64, maxZ: 64 };
  const colliders = [];
  const assetPlacements = [];
  const windMeshes = [];
  const cables = [];
  const flutter = [];
  const palms = [];
  const batches = new StaticBatches(scene, materials, !baked);
  Object.assign(materials, createFacadeMaterials(seed));
  createStreetMaterials(materials);
  const palette = [0xd9c39a, 0xe3cbb0, 0xd2a482, 0xaebfc0, 0xcdbaa4, 0xd9b59f, 0xd5cec0];
  const accents = [0x476667, 0x627e83, 0x9e5b42, 0x58746d, 0x79765f, 0x88817a];
  const wallTint = new THREE.Color();
  const shade = (color, amount) => wallTint.set(color).multiplyScalar(amount).getHex();
  const box = (mat, tint, x, y, z, w, h, d, angle = 0) => batches.add(BOX, mat, tint, x, y, z, w, h, d, angle);
  const plate = (mat, tint, x, y, z, w, h, angle = 0) => batches.add(PANEL, mat, tint, x, y, z, w, h, 1, angle);
  const body = (x, y, z, w, h, d, surface = 'concrete') => colliders.push({
    min: vector(x - w / 2, y - h / 2, z - d / 2),
    max: vector(x + w / 2, y + h / 2, z + d / 2),
    surface,
  });
  const pipe = (from, to, radius, tint, mat = 'metal', geometry = PIPE) => {
    const diff = to.clone().sub(from);
    const midpoint = from.clone().addScaledVector(diff, 0.5);
    const length = diff.length();
    const rotation = new THREE.Quaternion().setFromUnitVectors(UP, diff.normalize());
    batches.add(geometry, mat, tint, midpoint.x, midpoint.y, midpoint.z, radius, length, radius, rotation);
  };
  const round = (geometry, mat, tint, x, y, z, sx, sy, sz, angle = 0, uScale = 1, vScale = 1) =>
    batches.add(geometry, mat, tint, x, y, z, sx, sy, sz, angle, uScale, vScale);
  const local = (cx, cz, angle) => {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const point = (x, y, z) => vector(cx + x * c + z * s, y, cz - x * s + z * c);
    return {
      angle,
      p: point,
      box(mat, tint, x, y, z, w, h, d, a = 0) {
        const p = point(x, y, z);
        box(mat, tint, p.x, y, p.z, w, h, d, angle + a);
      },
      plate(mat, tint, x, y, z, w, h) {
        const p = point(x, y, z);
        plate(mat, tint, p.x, y, p.z, w, h, angle);
      },
      mesh(geometry, mat, tint, x, y, z, sx = 1, sy = 1, sz = 1, a = 0, uScale, vScale) {
        const p = point(x, y, z);
        const stretch = mat === 'stallCloth';
        batches.add(geometry, mat, tint, p.x, y, p.z, sx, sy, sz, angle + a, uScale ?? (stretch ? sx : 1), vScale ?? (stretch ? sy : 1));
      },
      body(x, y, z, w, h, d, surface) {
        const p = point(x, y, z);
        body(p.x, y, p.z, Math.abs(c) * w + Math.abs(s) * d, h, Math.abs(c) * d + Math.abs(s) * w, surface);
      },
      pipe(x, y, z, a, b, d, radius, tint, mat, geometry) {
        pipe(point(x, y, z), point(a, b, d), radius, tint, mat, geometry);
      },
    };
  };
  const placeAsset = (name, point, yaw) => {
    assetPlacements.push({ name, x: point.x, y: point.y, z: point.z, yaw });
  };

  const signs = [
    ['AL MARFA', 'MARCHÉ DES TISSUS', '#286262', '#f1e0b9'],
    ['ÉPICERIE', 'سوق  ·  PRODUITS SECS', '#803f37', '#f9dbac'],
    ['ATELIER 17', 'RÉPARATION  ·  SERVICE', '#425a6b', '#e4d7b2'],
    ['THÉ & MENTHE', 'دار الشاي', '#624632', '#e4c981'],
    ['PASSAGE SUD', 'AL MARFA   ·   MARCHÉ', '#385e60', '#e9d9b4'],
    ['FRUITS SECS', 'ÉPICES  ·  OLIVES', '#997e48', '#251c17'],
  ];
  signs.forEach(([a, b, c, d], i) => { materials['sign' + i] = signTexture(a, b, c, d, i < 4); });
  const tents = [
    clothTexture('#795a4d', '#aa9476'), clothTexture('#4b6862', '#8f927d'),
    clothTexture('#897754', '#b6a682'), clothTexture('#526671', '#999b90'),
  ];

  const awningHardware = new THREE.MeshStandardMaterial({ color: 0x4b4135, roughness: .79, metalness: .28 });

  function awning(anchor, angle, width, depth, style, drape = false, frontSupport = null) {
    const group = new THREE.Group();
    group.position.copy(anchor);
    group.rotation.y = angle;
    const support = frontSupport ?? depth - .13;
    const drop = frontSupport === null ? .46 : .52;
    const hem = .065;
    const addBar = (from, to, thickness) => {
      const direction = to.clone().sub(from);
      const bar = new THREE.Mesh(BOX, awningHardware);
      bar.position.copy(from).lerp(to, .5);
      bar.scale.set(thickness, direction.length(), thickness);
      bar.quaternion.setFromUnitVectors(vector(0, 1, 0), direction.normalize());
      bar.castShadow = bar.receiveShadow = true;
      group.add(bar);
    };
    const meshGeometry = new THREE.PlaneGeometry(width, depth, 24, 9);
    const position = meshGeometry.getAttribute('position');
    const base = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      const u = meshGeometry.getAttribute('uv').getX(i);
      const v = 1 - meshGeometry.getAttribute('uv').getY(i);
      base[i * 3] = (u - 0.5) * width;
      const span = Math.min(1, v * depth / support);
      const overhang = Math.max(0, (v * depth - support) / (depth - support));
      const sag = Math.sin(Math.PI * span) * (.055 + .065 * Math.sin(Math.PI * u));
      const fold = Math.sin(u * Math.PI * 4.7 + style) * .014 * Math.sin(Math.PI * span);
      base[i * 3 + 1] = drape ? -v * (depth + .028 * Math.sin(u * Math.PI * 3)) :
        -drop * span - sag + fold - overhang * (hem + .012 * Math.sin(u * Math.PI * 5.3 + style));
      base[i * 3 + 2] = drape ? v * 0.029 * Math.sin(u * Math.PI * 9) : v * depth;
    }
    position.array.set(base);
    position.needsUpdate = true;
    meshGeometry.computeVertexNormals();
    meshGeometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(meshGeometry, tents[style % tents.length]);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    if (!drape) {
      const half = width * .5;
      if (frontSupport === null) {
        addBar(vector(-half, -.026, .015), vector(half, -.026, .015), .055);
        addBar(vector(-half, -drop - .027, support), vector(half, -drop - .027, support), .06);
      }
      for (const x of [-half + .15, half - .15]) {
        addBar(vector(x, -.045, .025), vector(x, -drop - .044, support), .041);
        if (frontSupport === null) {
          addBar(vector(x, -.84, -.02), vector(x, -drop - .053, support - .14), .045);
          addBar(vector(x, -.94, -.025), vector(x, .08, -.025), .073);
        }
      }
    }
    scene.add(group);
    windMeshes.push({ mesh, base, phase: rand() * TAU, drape, support });
  }

  function suspendedLine(from, to, sag, radius, tint) {
    const points = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const p = from.clone().lerp(to, t);
      p.y -= 4 * sag * t * (1 - t);
      points.push(p);
    }
    const geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 16, radius, 5, false);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: tint, roughness: 0.85 }));
    mesh.castShadow = true;
    scene.add(mesh);
    cables.push({ mesh, phase: rand() * TAU });
  }

  function facade(frame, width, depth, levels, tint, trim, doors, access, front, sign, style, detail = false, replacement = null, measuredOpenings = null) {
    const floorHeight = 3.1;
    const signWidth = 3.81;
    const bandOffset = 0.07;
    const wall = (u, y, w, h, c = tint) => {
      frame.box('plaster', c, u, y, depth / 2 - 0.11, w, h, 0.22);
      if (access) frame.body(u, y, depth / 2 - 0.11, w, h, 0.22);
    };
    const face = depth / 2 + 0.012;
    const omit = () => {};
    const finish = replacement ? { ...frame, box: omit, plate: omit, mesh: omit, pipe: omit } : frame;
    const baseTint = shade(tint, 0.72);
    if (access && doors) {
      // The doorway begins at street grade.
      const doorWidth = width / (Math.floor(width / 3.2)) * 0.68;
      const doorX = -width / 2 + width / (Math.floor(width / 3.2)) * 0.5;
      const firstWidth = doorX - doorWidth / 2 + width / 2;
      const secondWidth = width / 2 - doorX - doorWidth / 2;
      wall(-width / 2 + firstWidth / 2, 0.2, firstWidth, 0.4, baseTint);
      wall(width / 2 - secondWidth / 2, 0.2, secondWidth, 0.4, baseTint);
      frame.box('limestone', 0x968874, doorX, 0.013, face - 0.10, doorWidth, 0.025, 0.28);
    } else wall(0, 0.2, width, 0.4, baseTint);
    for (let floor = 0; floor < levels; floor++) {
      const y = floor * floorHeight;
      const bays = Math.max(2, Math.floor(width / (floor === 0 && doors ? 3.2 : 3.4)));
      const spacing = width / bays;
      const openingBottom = floor === 0 && doors ? 0.4 : 1.05;
      const openingTop = floor === 0 && doors ? 2.55 : 2.51;
      const openingHeight = openingTop - openingBottom;
      const lower = floor === 0 ? 0.4 : 0;
      if (openingBottom > lower) wall(0, y + (openingBottom + lower) / 2, width, openingBottom - lower);
      wall(0, y + (openingTop + floorHeight) / 2, width, floorHeight - openingTop);
      let edge = -width / 2;
      for (let bay = 0; bay < bays; bay++) {
        const u = -width / 2 + spacing * (bay + 0.5);
        const isDoor = doors && floor === 0;
        const balcony = !isDoor && floor > 0 && front && bay % 2 === 1 && rand() < 0.43;
        const w = isDoor ? spacing * 0.68 : balcony ? 1.57 : range(0.92, 1.38);
        const h = openingHeight;
        const center = y + (openingTop + openingBottom) / 2;
        const left = u - w / 2;
        if (left > edge) {
          wall((edge + left) / 2, center, left - edge, h);
          if (front && floor === 0) addFacadePier(frame, edge, left, face, style, bay);
        }
        edge = u + w / 2;
        const open = isDoor && Boolean(access) && bay === 0;
        const detailedDoor = detail && isDoor;
        const variant = open ? 0 : isDoor ? (bay % 3 === 0 ? 1 : 2) : Math.floor(rand() * 5);
        const opening = { floor, bay, u, w, h, center, bottom: y + (open ? 0.027 : openingBottom),
          top: y + openingTop, open, balcony, variant };
        if (replacement) replacement.openings.push(opening);
        measuredOpenings?.push(opening);
        if (!open) {
          if (access) {
            const surface = variant === 4 ? 'glass' : variant === 2 ? 'metal' : 'wood';
            if (isDoor) {
              frame.body(u, center, face - 0.29, w, h, 0.42, surface);
              addShopRecessInterior(frame, u, center, face, w, h, variant, trim);
            } else frame.body(u, center, face - 0.18, w, h, 0.2, surface);
          }
        }
        if (!open && !replacement) {
          if (detailedDoor) {
            if (variant === 2) {
              frame.box('flat', 0x201d19, u, center, face - 0.34, w + 0.03, h + 0.025, 0.08);
              addRolledShutter(frame, u, center, face, w, h, trim);
            }
            addDetailedShopRecess(frame, u, center, face, w, h, variant, trim, style);
          } else {
            frame.box('flat', 0x201d19, u, center, face - 0.34, w + 0.03, h + 0.025, 0.08);
            if (front && isDoor && variant === 2) addRolledShutter(frame, u, center, face, w, h, trim);
            else frame.box(variant === 4 ? 'glass' : variant === 2 ? 'shutter' : 'wood',
              variant === 4 ? 0x435b67 : variant === 2 ? trim : variant === 1 ? shade(trim, 0.54) : 0x292a26,
              u, center, face - 0.275, w - 0.08, h - 0.06, 0.045);
            if (variant === 1 || variant === 3) {
              for (let k = 0; k < 4; k++) {
                const v = u - w * 0.39 + k * w * 0.26;
                frame.box('metal', 0x373a35, v, center, face - 0.04, 0.027, h - 0.08, 0.036);
              }
              for (const k of [-0.32, 0.32]) frame.box('metal', 0x393b35, u, center + h * k, face - 0.041, w, 0.029, 0.042);
              if (isDoor) frame.box('metal', 0x9f9479, u + w * 0.31, center - 0.19, face - 0.005, 0.1, 0.048, 0.052);
            } else if (variant === 4) {
              frame.box('wood', 0x716756, u, center, face - 0.21, 0.045, h, 0.045);
              frame.box('wood', 0x716756, u, center + 0.21, face - 0.21, w, 0.045, 0.045);
              frame.box('flat', 0xb2a288, u + w * 0.29, center - h * 0.08, face - 0.237, w * 0.3, h * 0.81, 0.012);
            } else if (variant === 0) {
              frame.box('wood', trim, u - w * 0.37, center, face + 0.012, w * 0.21, h * 0.91, 0.043, -0.2);
              frame.box('wood', shade(trim, 0.78), u + w * 0.51, center, face + 0.034, w * 0.32, h * 0.92, 0.043, 0.6);
            }
            if (front && isDoor) addShopRecess(frame, u, center, face, w, h, variant, trim);
          }
        }
        const casing = shade(tint, rand() > 0.3 ? 0.88 : 1.17);
        if (detailedDoor) {
          if (!replacement) addDoorSurround(frame, u, face, w, openingBottom, openingTop, casing, style, open);
        } else {
          finish.box('plaster', casing, u, center + h / 2, face + 0.02, w + 0.22, 0.13, 0.18);
          finish.box('plaster', casing, u - w / 2, center, face + 0.027, 0.12, h, 0.19);
          finish.box('plaster', casing, u + w / 2, center, face + 0.027, 0.12, h, 0.19);
          if (!open) finish.box('plaster', shade(tint, 1.1), u, center - h / 2, face + 0.083, w + 0.24, 0.125, 0.34);
        }
        if (!replacement && front && floor > 0 && !balcony && style === 'carved') {
          addPlasterHood(frame, u, center + h / 2, face, w, casing);
        }
        const streakH = range(0.33, 0.61);
        frame.plate('stain', shade(tint, 0.24), u, center - h / 2 - streakH * 0.5,
          face - 0.001, w * 1.15, streakH);
        if (balcony) {
          const balconyW = w + range(0.9, 1.35);
          opening.balconyWidth = balconyW;
          const platformY = y + 0.96;
          frame.box('plaster', casing, u, platformY, face + 0.59, balconyW, 0.22, 1.24);
          frame.box('plaster', shade(tint, 0.64), u, platformY - 0.145, face + 0.48, balconyW * 0.91, 0.09, 1.03);
          const steel = rand() < 0.5 ? 0x414e49 : 0x595b52;
          for (let k = 0; k <= 11; k++) {
            finish.box('metal', steel, u + balconyW * (k / 11 - 0.5), platformY + 0.47, face + 1.15, 0.028, 0.85, 0.04);
          }
          for (const level of [platformY + 0.24, platformY + 0.89]) {
            finish.box('metal', steel, u, level, face + 1.15, balconyW, 0.037, 0.06);
            for (const offset of [-balconyW / 2, balconyW / 2]) finish.box('metal', steel, u + offset, level, face + 0.63, 0.04, 0.038, 1.1);
          }
          if (rand() < 0.45 && windMeshes.length < 28) awning(frame.p(u, platformY + 0.91, face + 1.18), frame.angle, 0.87, 0.72, Math.floor(rand() * 4), true);
          if (rand() < 0.5) {
            const p = frame.p(u + balconyW * 0.35, platformY + 0.14, face + 0.74);
            planter(p.x, p.y, p.z, 0.28);
          }
        } else if (floor > 0 && rand() < (front ? 0.38 : 0.15)) {
          const acX = u + (rand() < 0.5 ? -0.46 : 0.48);
          const acY = y + 0.69;
          frame.box('metal', 0xa9a599, acX, acY, face + 0.16, 0.71, 0.41, 0.33);
          frame.box('metal', 0x5d625c, acX, acY, face + 0.333, 0.53, 0.29, 0.012);
          for (let k = 0; k < 6; k++) frame.box('metal', 0x929385, acX, acY - 0.122 + k * 0.046, face + 0.348, 0.53, 0.017, 0.026);
          frame.pipe(acX - 0.43, acY - 0.23, face + 0.31, acX - 0.43, acY + 0.78, face + 0.055, 0.022, 0x5b5c50);
        }
      }
      if (edge < width / 2) {
        wall((edge + width / 2) / 2, centerHeight(y, openingBottom, openingTop), width / 2 - edge, openingHeight);
        if (front && floor === 0) addFacadePier(frame, edge, width / 2, face, style, bays);
      }
      const band = floor === levels - 1 ? shade(tint, 1.13) : shade(tint, 0.91);
      const bandY = y + floorHeight - bandOffset;
      if (floor === 0 && sign) {
        // Leave a gap in the ground-floor trim for the wall-mounted board.
        const bandEdge = (width + 0.07) / 2;
        const halfGap = signWidth / 2 + 0.07;
        const left = sign.u - halfGap;
        const right = sign.u + halfGap;
        frame.box('plaster', band, (left - bandEdge) / 2, bandY, face + 0.046, left + bandEdge, 0.15, 0.23);
        frame.box('plaster', band, (right + bandEdge) / 2, bandY, face + 0.046, bandEdge - right, 0.15, 0.23);
      } else {
        frame.box('plaster', band, 0, bandY, face + 0.046, width + 0.07, 0.15, 0.23);
      }
    }

    if (sign) {
      const signY = 3.13;
      const boardFront = face + 0.24;
      for (const offset of [-0.34, 0.34]) {
        frame.box('metal', 0x574d43, sign.u + signWidth * offset, signY, face + 0.075, 0.078, 0.43, 0.17);
      }
      frame.box('wood', 0x65523d, sign.u, signY, boardFront - 0.054, signWidth, 0.72, 0.108);
      frame.plate('sign' + sign.style, 0xffffff, sign.u, signY, boardFront + 0.003, signWidth - 0.08, 0.66);
      for (const offset of [-1, 1]) {
        frame.box('metal', 0x7a6b52, sign.u, signY + offset * 0.347, boardFront - 0.008, signWidth - 0.04, 0.028, 0.026);
        frame.box('metal', 0x6d5b45, sign.u + offset * (signWidth / 2 - 0.012), signY, boardFront - 0.008, 0.024, 0.66, 0.026);
      }
    }
    if (front || rand() < 0.4) {
      const u = width / 2 - 0.24;
      frame.pipe(u, 0.2, face + 0.06, u, levels * 3.1 + 0.49, face + 0.06, 0.044, 0x898577);
      for (let y = 0.77; y < levels * 3.1; y += 1.59) {
        frame.box('metal', 0x766e60, u, y, face + 0.058, 0.138, 0.065, 0.126);
      }
      frame.pipe(u, 0.21, face + 0.06, u, 0.11, face + 0.33, 0.045, 0x898577);
      frame.box('metal', 0x7d7d65, u - 0.55, 1.35, face + 0.05, 0.37, 0.5, 0.16);
      frame.pipe(u - 0.55, 1.58, face + 0.05, u - 0.55, 3.05, face + 0.05, 0.019, 0x4b4c43);
      if (front) addMeterDetails(frame, u - 0.55, 1.35, face);
    }
    for (let i = 0; i < width * 1.4; i++) {
      const u = range(-width * 0.49, width * 0.49);
      const y = pick([range(0.07, 0.35), levels * 3.1 - range(0.16, 0.43), pick([2.72, 5.88, 8.99])]);
      if (y > levels * 3.1) continue;
      const patch = range(0.055, 0.18);
      const tintFactor = rand() < 0.18 ? 0.79 : 0.91;
      const weathering = range(0.57, 0.81);
      const patchWidth = range(0.11, 0.48);
      const stainWidth = range(0.09, 0.21);
      frame.plate('stain', shade(tint, weathering * tintFactor), u, y, face - 0.001, patchWidth, patch);
      if (y < 0.36) frame.plate('stain', shade(tint, 0.46), u, y + patch / 2, face - 0.0004, stainWidth, 0.075);
    }
  }

  const centerHeight = (base, bottom, top) => base + (bottom + top) * 0.5;

  function building(x, z, width, depth, angle, levels, tint, options = {}) {
    const f = local(x, z, angle);
    const rear = local(x, z, angle + Math.PI);
    const access = Boolean(options.access);
    const trim = options.trim ?? pick(accents);
    const top = levels * 3.1;
    const roof = shade(tint, 0.81);
    const measured = buildingLayout ? { x, z, width, depth, angle, levels, streetFront: Boolean(options.streetFront),
      front: [], rear: [] } : null;
    if (measured) buildingLayout.push(measured);
    const replaceFront = facadeLayout && options.streetFront;
    if (!access) f.body(0, top * 0.5, 0, width, top, depth);
    for (const side of [-1, 1]) {
      // Bring the return just past the ends of the front wall segments.
      // Their coincident side faces otherwise flicker in the Blender export.
      const returnWidth = replaceFront ? .262 : .25;
      f.box('plaster', shade(tint, side < 0 ? 0.91 : 0.96),
        side * (width * 0.5 - 0.125), top / 2, 0, returnWidth, top, depth - (replaceFront ? .018 : 0));
      if (access) f.body(side * (width * 0.5 - 0.125), top / 2, 0, 0.25, top, depth);
      for (let y = 3.1; y < top + 0.01; y += 3.1) {
        f.box('plaster', roof, side * width * 0.5, y - 0.075, 0, 0.14, 0.15, depth + 0.23);
      }
      const sidePoint = f.p(side * (width * 0.5 + 0.022), 0, 0);
      const end = local(sidePoint.x, sidePoint.z, angle + side * Math.PI / 2);
      if (options.service) addServiceEntrance(end, depth, shade(trim, 0.86), shade(tint, 0.8), side > 0);
      for (const windowX of [-0.29 * depth, 0.18 * depth]) {
        for (let level = 0; level < levels; level++) {
          const y = 1.89 + level * 3.1;
          const w = level === 0 ? 0.85 : 0.96;
          const h = level === 0 ? 0.96 : 1.12;
          const surround = shade(tint, 0.93 + (windowX < 0 ? 0.16 : 0));
          end.box('plaster', surround, windowX, y, -0.007, w + 0.14, h + 0.14, 0.089);
          end.box('wood', shade(trim, 0.49), windowX, y, 0.046, w, h, 0.023);
          if (level === 0) {
            for (let bar = -2; bar <= 2; bar++) {
              end.box('metal', 0x57564e, windowX + bar * 0.14, y, 0.083, 0.022, h, 0.035);
            }
            end.box('metal', 0x57564e, windowX, y, 0.091, w, 0.029, 0.036);
          } else {
            for (const mirror of [-1, 1]) {
              end.box('wood', trim, windowX + mirror * 0.43, y, 0.081, 0.28, h, 0.038, mirror * 0.28);
            }
            end.box('wood', 0x675e4f, windowX, y, 0.081, 0.032, h, 0.027);
          }
          end.box('plaster', surround, windowX, y - h * 0.52, 0.08, w + 0.21, 0.12, 0.29);
          end.plate('stain', shade(tint, 0.32), windowX, y - h * 0.5 - 0.23, 0.003, w * 1.18, 0.43);
        }
      }
      if (depth > 12.7) {
        end.plate('brick', shade(tint, 0.73), depth * 0.34, 0.34, 0.004, 1.15, 0.51);
        end.plate('plaster', shade(tint, 0.87), depth * 0.31, 0.51, 0.006, 0.78, 0.11);
        end.plate('plaster', shade(tint, 1.04), depth * 0.385, 0.19, 0.006, 0.22, 0.14);
      }
      if (options.lamp && side === 1) {
        const edge = side * width / 2;
        f.pipe(edge, 3.24, depth * 0.37, edge + 0.43, 3.45, depth * 0.37, 0.043, 0x5d6259);
        f.box('metal', 0x505953, edge + 0.45, 3.46, depth * 0.37, 0.33, 0.13, 0.37);
        f.box('flat', 0xdbca9f, edge + 0.45, 3.38, depth * 0.37, 0.24, 0.025, 0.25);
      }
    }
    const signage = options.sign ?? -1;
    const sign = signage >= 0 ? { style: signage, u: options.signOffset ?? width * 0.13 } : null;
    const style = options.style ?? (Math.round(Math.abs(x * 0.27 + z * 0.42)) % 3 === 0 ? 'carved' : 'render');
    const replacement = replaceFront ? {
      id: facadeLayout.length, side: x < 0 ? 'west' : 'east', centerZ: z,
      faceX: f.p(0, 0, depth / 2 + 0.012).x, angle, width, depth, levels, style, tint, trim, sign, openings: [],
    } : null;
    if (replacement) facadeLayout.push(replacement);
    facade(f, width, depth, levels, tint, trim, true, access, true, sign, style, options.streetFront, replacement, measured?.front);
    facade(rear, width, depth, levels, shade(tint, 0.94), trim, true, access && options.through, false, null, 'service', false, null, measured?.rear);
    if (options.canopy) {
      const { center, span, projection, finish } = options.canopy;
      addStoreCanopy(f, width * center, depth / 2 + 0.012, Math.min(span, width - 1.2), projection, finish);
    }
    if (options.loadingAwning) addLoadingAwning(f, width, depth / 2 + .018, x > 0);
    if (options.streetFront) {
      placeAsset('ShopLantern', f.p(-width / 2 + 0.48, 3.71, depth / 2 + 0.006), angle);
    }
    if (options.sign === 0 || options.sign === 1 || options.sign === 2) {
      const u = options.hangingSignOffset ?? -width * 0.31;
      const anchor = f.p(u, 3.65, depth / 2 + 0.64);
      const signAngle = angle + Math.PI / 2;
      box('metal', 0x6b6250, anchor.x, anchor.y, anchor.z, 0.99, 0.382, 0.075, signAngle);
      const signFrame = local(anchor.x, anchor.z, signAngle);
      signFrame.plate('sign' + options.sign, 0xffffff, 0, anchor.y, 0.042, 0.9, 0.323);
      const back = local(anchor.x, anchor.z, signAngle + Math.PI);
      back.plate('sign' + options.sign, 0xffffff, 0, anchor.y, 0.042, 0.9, 0.323);
      for (const y of [anchor.y - 0.13, anchor.y + 0.13]) {
        f.pipe(u, y, depth * 0.5, u, y, depth * 0.5 + 0.29, 0.023, 0x5c5548);
      }
    }
    if (access) {
      if (!options.through) {
        const wallDepth = options.streetFront ? 0.39 : 0.26;
        f.body(0, top / 2, -depth / 2 + wallDepth / 2, width, top, wallDepth);
      }
      f.box('plaster', 0x777465, 0, 0.018, 0, width, 0.036, depth);
      f.body(0, 0.018, 0, width - 0.16, 0.036, depth - 0.16, 'tile');
      for (let y = 3.1; y < top; y += 3.1) {
        f.box('plaster', 0x8a7862, 0, y, 0, width - 0.36, 0.24, depth - 0.37);
        f.body(0, y, 0, width, 0.24, depth);
      }
      for (let t = -depth / 2 + 0.7; t < depth / 2 - 0.3; t += 0.78) {
        f.box('brick', 0xb1a386, width / 2 - 0.257, 0.56, t, 0.036, 0.98, 0.75);
      }
      f.box('wood', 0x8e7452, -width / 2 + 0.82, 0.84, -depth * 0.23, 1.21, 0.13, 2.2);
      f.box('wood', 0x765f43, -width / 2 + 0.82, 0.39, -depth * 0.23, 1.18, 0.77, 2.18);
      f.body(-width / 2 + 0.82, 0.42, -depth * 0.23, 1.18, 0.84, 2.18, 'wood');
      if (options.streetFront) addAccessibleShopInterior(f, width, depth, style, options.through);
    }
    f.box('plaster', roof, 0, top, 0, width + 0.25, 0.21, depth + 0.25);
    if (access) f.body(0, top, 0, width, 0.21, depth);
    for (const side of [-1, 1]) {
      f.box('plaster', tint, side * width / 2, top + 0.38, 0, 0.23, 0.75, depth + 0.23);
      f.box('plaster', roof, side * width / 2, top + 0.79, 0, 0.34, 0.13, depth + 0.31);
      f.box('plaster', tint, 0, top + 0.38, side * depth / 2, width + 0.23, 0.75, 0.23);
      f.box('plaster', roof, 0, top + 0.79, side * depth / 2, width + 0.33, 0.13, 0.32);
    }
    f.box('plaster', shade(tint, 0.89), width * 0.28, top + 0.92, -depth * 0.23, 2.3, 1.9, 2.8);
    f.box('plaster', roof, width * 0.28, top + 1.91, -depth * 0.23, 2.52, 0.16, 3.03);
    const tank = f.p(-width * 0.29, top + 1.12, -depth * 0.23);
    round(DRUM, 'metal', pick([0x3d4e4f, 0x857d62, 0x4d5557]), tank.x, tank.y, tank.z, 0.73, 1.5, 0.73);
    for (const offset of [-0.72, -0.39, 0, 0.39, 0.72]) {
      round(DRUM, 'metal', 0x666a5d, tank.x, tank.y + offset, tank.z, 0.75, 0.043, 0.75);
    }
    round(DRUM, 'metal', 0x6e6f61, tank.x, tank.y + 0.82, tank.z, 0.3, 0.13, 0.3);
    const dish = f.p(width * 0.19, top + 1.09, depth * 0.31);
    pipe(dish.clone().add(vector(0, -1.05, 0)), dish, 0.044, 0x797c73);
    const dishOrientation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.83, angle * 0.5, -0.27));
    round(LEAF, 'metal', 0xb4b2a2, dish.x, dish.y + 0.14, dish.z, 0.49, 0.105, 0.48, dishOrientation);
    pipe(dish, dish.clone().add(vector(0.24, 0.38, 0.27)), 0.018, 0x585a50);
    round(LEAF, 'metal', 0x575c54, dish.x + 0.24, dish.y + 0.38, dish.z + 0.27, 0.065, 0.06, 0.065);
    if (rand() < 0.75) {
      const mastX = width * 0.37;
      f.pipe(mastX, top + 0.47, depth * 0.12, mastX, top + 3.26, depth * 0.12, 0.022, 0x6a6960);
      f.pipe(mastX - 0.72, top + 2.6, depth * 0.12, mastX + 0.8, top + 2.6, depth * 0.12, 0.017, 0x56574d);
      for (let i = -3; i <= 3; i++) f.pipe(mastX + i * 0.19, top + 2.6, depth * 0.12 - 0.31, mastX + i * 0.19, top + 2.6, depth * 0.12 + 0.31, 0.012, 0x56574d);
    }
  }

  function planter(x, y, z, size = 0.32) {
    round(terracottaPlanter, 'limestone', 0xb97652, x, y, z, size, size, size);
    round(DRUM, 'asphalt', 0x725f47, x, y + size * 1.105, z, size * .905, .027, size * .905);
    for (let stone = 0; stone < 5; stone++) {
      const a = stone * 2.4 + x - z;
      const r = size * (.25 + .11 * stone);
      const rock = size * (.058 + .009 * stone);
      round(ROCK, 'gravel', 0x9c846a, x + Math.cos(a) * r, y + size * 1.135, z + Math.sin(a) * r, rock, rock * .6, rock * .81, a);
    }
    shrub(x, y + size * 1.11, z, size * 1.22);
  }

  function shrub(x, y, z, size) {
    for (let i = 0; i < 11; i++) {
      const a = rand() * TAU;
      const r = range(0.1, 0.65) * size;
      const curl = range(-1, 1);
      const tilt = range(-1, 1);
      const orient = new THREE.Quaternion().setFromEuler(new THREE.Euler(.28 + curl * .58, a, tilt * .62, 'YXZ'));
      const tint = pick([0x738052, 0x819456, 0x51683e, 0x757f4c]);
      const reach = range(0.12, 0.78);
      const length = size * (.71 + reach * .75);
      round(succulentLeaf, 'flat', tint, x + Math.cos(a) * r * .24, y, z + Math.sin(a) * r * .24,
        size * .17, length, length, orient);
    }
  }

  function palm(x, z, height, lean) {
    const start = vector(x, 0, z);
    let tip = start.clone();
    for (let k = 1; k <= 12; k++) {
      const t = k / 12;
      const p = vector(x + lean * t * t, height * t, z + 0.37 * t * t);
      pipe(tip, p, 0.23 - t * 0.086, pick([0x826c54, 0x9a8265, 0x9c896a]), 'wood');
      round(PIPE, 'wood', 0x8c765c, p.x, p.y - 0.08, p.z, 0.25 - t * 0.087, 0.075, 0.24 - t * 0.087);
      tip = p;
    }
    const group = new THREE.Group();
    group.position.copy(tip);
    const vertices = [];
    const colors = [];
    const tint = new THREE.Color();
    const append = (a, b, c, shadeA, shadeB, shadeC) => {
      vertices.push(...a.toArray(), ...b.toArray(), ...c.toArray());
      colors.push(tint.r * shadeA, tint.g * shadeA, tint.b * shadeA,
        tint.r * shadeB, tint.g * shadeB, tint.b * shadeB, tint.r * shadeC, tint.g * shadeC, tint.b * shadeC);
    };
    for (let j = 0; j < 10; j++) {
      const azimuth = j / 10 * TAU + range(-.18, .18);
      const length = range(2, 3.4);
      const angle = vector(Math.cos(azimuth), 0, Math.sin(azimuth));
      const side = vector(-angle.z, 0, angle.x);
      const upper = j % 3 === 0;
      const rise = upper ? 1.57 : .84;
      const hang = upper ? .51 : 1.21;
      const profile = t => angle.clone().multiplyScalar(t * length)
        .add(vector(0, Math.sin(t * Math.PI * .83) * rise - t * t * hang, 0));
      tint.set(0x7e8350);
      for (let i = 0; i < 16; i++) {
        const a = i / 16, b = (i + 1) / 16;
        const start = profile(a), end = profile(b);
        const startWidth = .032 * (1 - a * .93), endWidth = .032 * (1 - b * .93);
        const startA = start.clone().addScaledVector(side, startWidth);
        const startB = start.clone().addScaledVector(side, -startWidth);
        const endA = end.clone().addScaledVector(side, endWidth);
        const endB = end.clone().addScaledVector(side, -endWidth);
        append(startA, startB, endA, .72, .77, 1);
        append(endA, startB, endB, 1, .77, .89);
      }
      for (let i = 0; i < 17; i++) {
        const t = (i + 1) / 18;
        const leafLength = (.12 + Math.sin(Math.PI * t) * .62) * (1 - t * .38);
        for (const sign of [-1, 1]) {
          tint.set(pick(j % 5 === 4 ? [0x78804e, 0x847e4e, 0x869054, 0x9b995f, 0x798750]
            : [0x4f663b, 0x667849, 0x809052, 0x566c42, 0x788b50]));
          const root = profile(t + sign * .006);
          const tip = root.clone().addScaledVector(side, sign * leafLength * .84).addScaledVector(angle, leafLength * .71);
          tip.y -= leafLength * (.68 + .18 * Math.sin(i * 4.15));
          const ridge = root.clone().lerp(tip, .46).addScaledVector(UP, leafLength * .12);
          const left = ridge.clone().addScaledVector(angle, -.031 * (1 - t * .55)).addScaledVector(UP, -.027);
          const right = ridge.clone().addScaledVector(angle, .043 * (1 - t * .55)).addScaledVector(UP, -.021);
          append(root, left, ridge, .64, .87, 1.1);
          append(root, ridge, right, .64, 1.1, .77);
          append(ridge, left, tip, 1.1, .87, .74);
          append(ridge, tip, right, 1.1, .74, .77);
        }
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geom.computeVertexNormals();
    const leaves = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, vertexColors: true, roughness: 0.8 }));
    leaves.castShadow = true;
    leaves.receiveShadow = true;
    group.add(leaves);
    scene.add(group);
    palms.push({ group, phase: rand() * TAU });
    body(x, 0.85, z, 0.41, 1.7, 0.41, 'wood');
  }

  function crate(x, y, z, width = 0.8, height = 0.65, depth = 0.75, angle = 0, tint = 0x8b704d, collision = true) {
    const f = local(x, z, angle);
    if (height >= 0.28) {
      addTimberCrate(f, y, width, height, depth, tint, shade);
      if (collision) f.body(0, y + height / 2, 0, width, height, depth, 'wood');
      return;
    }
    f.box('wood', tint, 0, y + height / 2, 0, width, height, depth);
    for (const side of [-1, 1]) {
      for (const yOffset of [0.087, height - 0.081]) {
        f.box('wood', shade(tint, 1.17), 0, y + yOffset, side * (depth / 2 + 0.013), width + 0.05, 0.093, 0.044);
        f.box('wood', shade(tint, 1.17), side * (width / 2 + 0.012), y + yOffset, 0, 0.046, 0.093, depth + 0.04);
      }
      for (const corner of [-1, 1]) {
        f.box('wood', shade(tint, 0.81), corner * (width / 2 - 0.052), y + height * 0.5, side * (depth / 2 + 0.014), 0.105, height, 0.047);
        f.box('metal', 0x50524b, corner * (width / 2 - 0.053), y + height - 0.082, side * (depth / 2 + 0.04), 0.026, 0.032, 0.009);
      }
    }
    if (collision) f.body(0, y + height / 2, 0, width, height, depth, 'wood');
  }

  function drum(x, z, tint, y = 0, size = 1, solid = true) {
    addSteelDrum(local(x, z, Math.sin(x * 0.41 + z * 0.22) * 1.7), y, size, tint);
    if (solid) body(x, y + 0.475 * size, z, 0.66 * size, 0.95 * size, 0.66 * size, 'metal');
  }

  function sandbags(x, z, angle, length, tiers, tint = 0xa79874) {
    const f = local(x, z, angle);
    for (let row = 0; row < tiers; row++) {
      for (let n = 0; n < length; n++) {
        const p = f.p((n - (length - 1) / 2) * 0.61 + (row % 2 - 0.5) * 0.27, 0.12 + row * 0.22, range(-0.035, 0.035));
        const c = shade(tint, range(0.78, 1.1));
        const width = range(0.344, 0.376);
        const depth = range(0.248, 0.284);
        const rotation = angle + range(-0.14, 0.14);
        const height = range(0.135, 0.157);
        round(sandbagGeometry, 'sandbag', c, p.x, p.y, p.z, width, height, depth, rotation, .76, .62);
        round(sandbagSeamGeometry, 'sandbag', shade(c, .57), p.x, p.y, p.z, width, height, depth, rotation);
      }
    }
    f.body(0, tiers * 0.111, 0, length * 0.61 + 0.15, tiers * 0.222, 0.54, 'fabric');
  }

  function barrier(x, z, angle, length, painted = true) {
    const f = local(x, z, angle);
    const profile = new THREE.Shape([
      new THREE.Vector2(-0.43, 0), new THREE.Vector2(0.43, 0), new THREE.Vector2(0.43, 0.14),
      new THREE.Vector2(0.26, 0.34), new THREE.Vector2(0.18, 0.85), new THREE.Vector2(-0.18, 0.85),
      new THREE.Vector2(-0.26, 0.34), new THREE.Vector2(-0.43, 0.14),
    ]);
    const mesh = new THREE.ExtrudeGeometry(profile, {
      depth: length, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.032, bevelSegments: 1,
    }).translate(0, 0.036, -length / 2).rotateY(Math.PI / 2);
    batches.add(mesh, 'plaster', 0xaba18d, x, 0, z, 1, 1, 1, angle, 0.9, 0.68);
    mesh.dispose();
    for (const s of [-1, 1]) {
      if (painted) {
        for (let i = -length / 2 + 0.3; i < length / 2 - 0.08; i += 0.63) {
          const p = f.p(i, 0.646, s * 0.223);
          round(BOX, 'plaster', Math.round(i * 10) % 3 ? 0xa37a4b : 0x655a4e, p.x, p.y, p.z, 0.29, 0.24, 0.027, angle);
        }
      }
      f.box('metal', 0x646152, s * (length / 2 - 0.25), 0.91, 0, 0.098, 0.063, 0.038);
    }
    f.body(0, 0.449, 0, length, 0.898, 0.75);
  }

  function stall(x, z, angle, style, width = 3.8, depth = 2.3, detailed = false) {
    const f = local(x, z, angle);
    const wood = pick([0x8b7456, 0x775e45, 0x9e805b]);
    for (const u of [-width / 2, width / 2]) {
      for (const v of [-depth / 2, depth / 2]) {
        f.box('wood', wood, u, 1.29 + (v < 0 ? 0.13 : 0), v, 0.113, v < 0 ? 2.84 : 2.52, 0.112);
        f.box('metal', 0x626150, u, 0.12, v, 0.134, 0.2, 0.131);
      }
    }
    f.box('wood', wood, 0, 2.83, -depth / 2, width + 0.34, 0.115, 0.118);
    f.box('wood', shade(wood, 0.77), 0, 2.306, depth / 2, width + 0.2, 0.08, 0.08);
    awning(f.p(0, 2.87, -depth / 2 - 0.06), angle, width + 0.46, depth + 0.22, style, false, depth + .06);
    const tableZ = 0.06;
    f.box('wood', shade(wood, 1.23), 0, 0.9, tableZ, width * 0.91, 0.103, 1.1);
    const cloth = [0x956742, 0x5a7974, 0x77654a, 0x8a5b4a][style];
    dressStall(f, width, tableZ, cloth, shade(wood, .89));
    reinforceAwning(f, width, depth);
    f.box('wood', shade(wood, 0.68), 0, 0.2, tableZ, width * 0.9, 0.089, 0.87);
    for (const u of [-width * 0.4, width * 0.4]) {
      for (const v of [-0.46, 0.44]) f.box('wood', wood, u, 0.42, tableZ + v, 0.095, 0.84, 0.099);
    }
    for (let j = 0; j < 4; j++) {
      const u = width * (j / 4 - 0.385);
      const p = f.p(u, 0.956, tableZ + range(-0.22, 0.23));
      if (j === 0 || j === 2) {
        const crateAngle = angle + range(-0.15, 0.15);
        if (detailed) placeAsset('ProduceCrate', p, crateAngle);
        else crate(p.x, p.y, p.z, width * 0.185, 0.144, 0.51, crateAngle, 0x9b8159, false);
        for (let i = 0; i < 11; i++) {
          const item = f.p(u + range(-width * 0.07, width * 0.07), 1.118, tableZ + range(-0.2, 0.2));
          const color = pick(j === 0 ? [0x876b3e, 0xba864c, 0xa46b45] : [0x7a7b50, 0x8f8a58, 0x6a754b]);
          const size = vector(range(0.041, 0.069), range(0.034, 0.057), range(0.039, 0.062));
          if (!detailed) round(LEAF, 'flat', color, item.x, item.y, item.z, size.x, size.y, size.z);
        }
      } else if (detailed) {
        if (j === 3 && style === 0) addMarketScale(f, u, p.y, tableZ + .11);
        else placeAsset('DateBasket', p, angle + j * 0.071);
      } else {
        round(POT, 'plaster', 0x946341, p.x, p.y + 0.09, p.z, 0.21, 0.18, 0.21);
        round(PIPE, 'wood', 0x624b34, p.x, p.y + 0.191, p.z, 0.18, 0.019, 0.18);
      }
    }
    f.body(0, 0.475, tableZ, width * 0.91, 0.95, 1.04, 'wood');
  }

  function pickup(x, z, angle, color, index) {
    const f = local(x, z, angle);
    addPickupDetails(f, shade, color, index);
    f.body(0, 0.63, 0, 1.86, 1.26, 4.39, 'metal');
    f.body(0, 1.55, 0.34, 1.73, 0.64, 1.39, 'metal');
  }

  function arch(z) {
    const radius = 4.18;
    const ring = 0.98;
    const spring = 4.43;
    const depth = 2.71;
    const mouldingDepth = 0.15;
    const outerMoulding = depth / 2 + 0.057;
    const outer = radius + ring;
    const top = 10.39;
    const colors = [0xc5ad89, 0xc9b290, 0xd3bc99, 0xbb9f7b, 0xcdb696];
    const pierOuter = 7.31;
    function voussoir(a, b, inner, outside, thickness, zz, tint) {
      const points = [];
      const steps = Math.max(3, Math.ceil((b - a) / 0.075));
      for (let k = 0; k <= steps; k++) {
        const t = a + (b - a) * k / steps;
        points.push(new THREE.Vector2(Math.cos(t) * inner, Math.sin(t) * inner + spring));
      }
      for (let k = steps; k >= 0; k--) {
        const t = a + (b - a) * k / steps;
        points.push(new THREE.Vector2(Math.cos(t) * outside, Math.sin(t) * outside + spring));
      }
      const shape = new THREE.Shape(points);
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
      batches.add(geometry, 'limestone', tint, 0, 0, zz - thickness / 2, 1, 1, 1);
      geometry.dispose();
    }
    voussoir(0, Math.PI, radius + 0.016, outer - 0.009, depth - 0.045, z, 0x8f7b63);
    for (let i = 0; i < 19; i++) {
      const a = i * Math.PI / 19;
      const b = (i + 1) * Math.PI / 19;
      voussoir(a + 0.002, b - 0.002, radius, outer, depth, z, pick(colors));
      for (const s of [-1, 1]) {
        voussoir(a, b, radius - 0.085, radius + 0.095, mouldingDepth, z + s * 1.41, 0xe0caaa);
        voussoir(a + 0.001, b - 0.001, outer - 0.13, outer + 0.09, mouldingDepth, z + s * outerMoulding, 0xac9679);
      }
    }
    const fillShape = new THREE.Shape();
    fillShape.moveTo(outer, spring);
    fillShape.absarc(0, spring, outer, 0, Math.PI, false);
    fillShape.lineTo(-pierOuter, spring);
    fillShape.lineTo(-pierOuter, top);
    fillShape.lineTo(pierOuter, top);
    fillShape.lineTo(pierOuter, spring);
    fillShape.lineTo(outer, spring);
    const fill = new THREE.ExtrudeGeometry(fillShape, { depth: depth - 0.13, bevelEnabled: false, curveSegments: 14 });
    batches.add(fill, 'limestone', 0xc1ac90, 0, 0, z - (depth - 0.13) / 2, 1, 1, 1);
    fill.dispose();
    // The flat wall behind the cut stone is mortar. Each staggered face
    // course stops at the curved moulding and can weather independently.
    const faceRadius = outer + .062;
    const edgeAt = y => Math.sqrt(Math.max(0, faceRadius ** 2 - (y - spring) ** 2));
    const courseHeight = .685;
    for (let row = 0; row < 8; row++) {
      const bottom = spring + row * courseHeight + .011;
      const high = Math.min(9.88, bottom + courseHeight - .022);
      for (let column = 0; column < 6; column++) {
        const left = Math.max(0, column * 1.47 - (row % 2) * .735) + .011;
        const right = Math.min(pierOuter, (column + 1) * 1.47 - (row % 2) * .735) - .011;
        if (right <= left || right <= edgeAt(high)) continue;
        const low = Math.max(bottom, spring + Math.sqrt(Math.max(0, faceRadius ** 2 - right ** 2)));
        if (low >= high) continue;
        for (const side of [-1, 1]) {
          const outline = new THREE.Shape();
          outline.moveTo(side * right, low);
          outline.lineTo(side * right, high);
          for (let step = 0; step <= 6; step++) {
            const y = high - (high - low) * step / 6;
            outline.lineTo(side * Math.max(left, edgeAt(y)), y);
          }
          const stone = new THREE.ExtrudeGeometry(outline, { depth: .034, bevelEnabled: false });
          for (const face of [-1, 1]) {
            const tint = colors[(row * 3 + column * 2 + (side + 1) + (face + 1)) % colors.length];
            batches.add(stone, 'limestone', tint, 0, 0, z + face * 1.30 - .017, 1, 1, 1);
          }
          stone.dispose();
        }
      }
    }
    for (const s of [-1, 1]) {
      const x = s * (radius + pierOuter) / 2;
      const width = pierOuter - radius;
      for (let course = 0; course < 7; course++) {
        const y = (course + 0.5) * spring / 7;
        const stone = pick(colors);
        const courseWidth = width + (course < 1 ? .26 : 0);
        const courseDepth = depth + (course === 0 ? .26 : 0);
        const height = spring / 7;
        box('limestone', shade(stone, .64), x, y, z, courseWidth - .014, height, courseDepth - .045);
        for (const face of [-1, 1]) {
          const seam = courseWidth * (course % 2 ? .42 : .57);
          const tint = pick(colors);
          box('limestone', stone, x + s * (seam - courseWidth) / 2, y, z + face * (courseDepth / 2 - .012),
            seam - .016, height - .014, .06);
          box('limestone', tint, x + s * seam / 2, y, z + face * (courseDepth / 2 - .009),
            courseWidth - seam - .016, height - .014, .06);
        }
        for (const side of [-1, 1]) {
          box('limestone', shade(stone, side < 0 ? .94 : .91), x + side * (courseWidth / 2 - .018), y, z,
            .048, height - .016, courseDepth - .04);
        }
      }
      box('plaster', 0xcab393, x, 4.39, z, width + 0.27, 0.145, depth + 0.33);
      box('plaster', 0x9c896d, x, 4.275, z, width + 0.16, 0.087, depth + 0.19);
      body(x, spring / 2, z, width, spring, depth);
      for (const face of [-1, 1]) {
        box('metal', 0x57554b, s * 6.51, 3.72, z + face * 1.57, 0.246, 0.162, 0.478);
        box('flat', 0xb5a179, s * 6.51, 3.62, z + face * 1.61, 0.177, 0.064, 0.241);
      }
    }
    for (let slice = 0; slice < 15; slice++) {
      const width = 2 * pierOuter / 15;
      const x = -pierOuter + width * (slice + 0.5);
      const maxX = Math.abs(x) + width / 2;
      const bottom = spring + Math.sqrt(Math.max(0, radius * radius - maxX * maxX));
      body(x, (bottom + top) * 0.5, z, width, top - bottom, depth);
    }
    for (const [yy, w, d, h, tint] of [
      [9.86, 14.9, 2.92, 0.13, 0xa69278], [10.01, 15.04, 3.07, 0.17, 0xcdb99a],
      [10.33, 15.26, 3.2, 0.41, 0xdbbf99], [10.58, 15.45, 3.29, 0.12, 0xbaa384],
      [10.72, 15.61, 3.37, 0.14, 0xd1b99a],
    ]) box('limestone', tint, 0, yy, z, w, h, d);
    for (let i = -6; i <= 6; i++) {
      box('plaster', i % 2 ? 0xb9a07e : 0xc9b28f, i * 1.137, 10.98, z, 0.67, 0.51, 2.74);
      box('plaster', 0xcebc9b, i * 1.137, 11.26, z, 0.75, 0.1, 2.83);
    }
    for (let i = -6; i <= 6; i++) {
      for (const face of [-1, 1]) {
        const x = i * 1.105;
        box('limestone', 0xb39a7a, x, 9.99, z + face * 1.49, .24, .19, .31);
        box('limestone', 0xc6af8f, x, 10.11, z + face * 1.56, .33, .085, .24);
      }
    }
    const signBack = outerMoulding + mouldingDepth / 2 + 0.012;
    const boardDepth = 0.125;
    const mountBack = depth / 2 - 0.015;
    for (const x of [-1.02, 1.02]) {
      box('metal', 0x6b6250, x, 9.16, z + (mountBack + signBack) / 2, 0.16, 0.16, signBack - mountBack);
    }
    box('wood', 0x776d57, 0, 9.25, z + signBack + boardDepth / 2, 3.02, 0.67, boardDepth);
    plate('sign4', 0xffffff, 0, 9.25, z + signBack + boardDepth + 0.003, 2.87, 0.56);
  }

  // The side streets remain navigable as three loops around the central road.
  box('asphalt', 0xaba088, 0, -0.076, 0, 172, 0.12, 175);
  box('road', 0x8a8374, 0, -0.024, 0, 12.9, 0.035, 136);
  for (const x of [-30.4, 29.2]) box('asphalt', 0x9a8f7b, x, -0.022, 0, 7.8, 0.032, 128);
  for (const z of [-57, -42, -21, -3.8, 15.5, 33.8, 55]) {
    box('road', 0x9b927e, 0, -0.017, z, 121, 0.023, z === -57 || z === 55 ? 7.1 : 4.2);
  }
  for (const z of [-41, -31]) {
    box('brick', 0xc1ad8d, 0, -0.014, z, 16.3, 0.023, 8);
  }
  addUtilityRepairs(round);
  addServicePaving(box, round);
  const horizontal = new THREE.Quaternion().setFromAxisAngle(vector(1, 0, 0), -Math.PI / 2);
  for (let i = -11; i <= 11; i++) {
    const z = i * 5.17 + 1.5;
    if (z < -30 && z > -43) continue;
    for (let strip = 0; strip < 3; strip++) {
      const x = 0.08 + strip * 0.031 + range(-0.006, 0.006);
      round(PANEL, 'road', pick([0xaea085, 0xa79a81, 0x9f967f]), x, 0.0055, z + range(-0.2, 0.2),
        0.028, range(0.54, 1.66), 1, horizontal);
    }
  }
  for (const [x, z] of [[-0.89, 42.21], [2.16, 30.04], [-1.4, 7.45], [0.61, -24.86], [2.78, -44.07], [-28.5, 30.1]]) {
    addCastIronDrain(local(x, z, x * .24 + z * .17));
  }
  for (const side of [-1, 1]) {
    for (const [lo, hi] of [[-59, -57.3], [-52.7, -44.3], [-39.7, -23.3], [-18.7, -6.1], [-1.5, 13.2], [17.8, 31.5], [36.1, 52.7], [57.3, 59]]) {
      body(side * 7.02, 0.03, (lo + hi) / 2, 1.93, 0.06, hi - lo, 'concrete');
    }
    for (let i = 0; i < 112; i++) {
      const z = -58.5 + i * 1.05;
      const x = side * 6.73;
      const crossing = [-42, -21, -3.8, 15.5, 33.8, 55].some(center => Math.abs(z - center) < 2.25);
      if (crossing) continue;
      const tone = pick([0xa59a82, 0xb3a68d, 0xa99c84, 0xa69881, 0xb4a78f]);
      box('limestone', tone, x + side * 0.43, 0.021, z, 1.72, 0.083, 1.043);
      box('limestone', shade(tone, 0.85), x - side * 0.483, 0.04, z, 0.142, 0.115, 1.037);
      if (i % 12 === 4) {
        box('metal', 0x514e43, x - side * 0.55, 0.006, z, 0.4, 0.023, 0.71);
        for (let j = 0; j < 10; j++) box('metal', 0x787465, x - side * 0.55, 0.021, z - 0.3 + j * 0.066, 0.35, 0.012, 0.025);
      }
    }
  }

  const frontages = [
    // Offsets place the signs over bays with a clear view from the street.
    { z: 44.4, width: 17.8, left: 0xd1b78e, right: 0xb5c5c2, deep: 13.0,
      west: { sign: 0, signOffset: -1.42, hangingSignOffset: -1.42, lamp: true, style: 'tiled',
        canopy: { center: 0.3, span: 5.7, projection: 1.39, finish: 'wood' } },
      east: { sign: 1, signOffset: 2.65, hangingSignOffset: 2.25, lamp: true, style: 'tiled' } },
    { z: 24.2, width: 13.9, left: 0xe4c3a5, right: 0xc7b38b, deep: 14.0,
      west: { sign: 3, signOffset: -3.4, access: true, style: 'carved' },
      east: { sign: 2, signOffset: -0.28, hangingSignOffset: -2.70, style: 'workshop' } },
    { z: 5.75, width: 14.8, left: 0xcbb6a2, right: 0xe1c8a9, deep: 12.5,
      west: { access: true, through: true, lamp: true, style: 'workshop',
        canopy: { center: -0.24, span: 5.45, projection: 1.42, finish: 'stone' } },
      east: { sign: 5, signOffset: -0.35, access: true, style: 'tiled' } },
    { z: -12.2, width: 13.5, left: 0xb0c0c1, right: 0xcd9c83, deep: 13.3, west: {}, east: { access: true, through: true, lamp: true } },
    { z: -28.2, width: 10.25, left: 0xd2ba97, right: 0xe0c3a3, deep: 13.0, west: { lamp: true },
      east: { canopy: { center: 0.07, span: 5.3, projection: 1.28, finish: 'wood' } } },
    { z: -49.2, width: 10.5, left: 0xcebda5, right: 0xa7b6af, deep: 11.5, west: {}, east: { sign: 3, signOffset: -1.0 } },
  ];
  for (let i = 0; i < frontages.length; i++) {
    const f = frontages[i];
    building(-8.1 - f.deep / 2, f.z, f.width, f.deep, Math.PI / 2,
      i === 0 || i === 3 ? 3 : 2, f.left, { streetFront: true, trim: i === 0 ? 0x577e7e : undefined, ...f.west });
    const depth = f.deep + (i % 2 ? 0.8 : -0.8);
    building(8.15 + depth / 2, f.z + (i % 2 ? 0.56 : -0.55), f.width - 0.55, depth, -Math.PI / 2,
      i === 0 || i === 2 || i === 4 ? 3 : 2, f.right, { streetFront: true, trim: i === 0 ? 0x668385 : undefined, ...f.east });
  }
  for (const side of [-1, 1]) {
    for (const [i, z, width] of [[0, 46, 16], [1, 23.5, 15], [2, 5.3, 12.9], [3, -13.3, 13], [4, -29.5, 12.1], [5, -49, 12]]) {
      const d = range(13.2, 16.7);
      building(side * (34.6 + d / 2), z + side * range(-0.8, 0.8), width + range(-1.1, 1), d,
        -side * Math.PI / 2, i % 3 === 1 ? 3 : 2, pick(palette), {
          lamp: i % 2 === 0, service: true, style: 'workshop',
          loadingAwning: side < 0 ? [0, 1, 4].includes(i) : [2, 5].includes(i),
        });
      if (i % 2 === 1) building(side * 56.7, z + 1.9, width * 0.87, 7.7,
        -side * Math.PI / 2, 2, pick(palette));
    }
    for (const z of [-57.7, 57.3]) {
      barrier(side * 17.6, z, range(-0.11, 0.11), 3.4, false);
      drum(side * 20.4, z + 0.7, 0x677268);
      planter(side * 23.9, 0, z + 0.54, 0.42);
    }
  }
  for (const [x, z, w, d, angle, floors, tint] of [
    [-51, -58, 17.3, 8.2, 0, 2, 0xbba887], [-21.6, -64, 16.4, 7.1, 0, 2, 0xcbb599],
    [12.8, -64, 15.9, 7.2, 0, 3, 0xaeb4a6], [43, -64, 19.6, 8.1, 0, 2, 0xceaa86],
    [-45, 63.8, 17.5, 7.2, Math.PI, 2, 0xc8b391], [18.6, 63.1, 17.4, 6.2, Math.PI, 2, 0xcdb39a],
  ]) building(x, z, w, d, angle, floors, tint);
  building(0.03, -67.35, 9.91, 7.8, 0, 2, 0xc3a88a, { sign: 2, hangingSignOffset: -1.22, trim: 0x71786b });

  arch(-34.8);
  const towerX = -13.8;
  const towerZ = -49.9;
  box('plaster', 0xd1bb99, towerX, 9.1, towerZ, 3.1, 4.7, 2.72);
  for (const y of [7.1, 9.15, 11.29, 12.78]) {
    box('plaster', 0xe2cdaa, towerX, y, towerZ, 3.23, 0.15, 2.94);
  }
  for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const wall = local(towerX, towerZ, angle);
    const d = angle % Math.PI ? 1.56 : 1.38;
    wall.box('plaster', 0xa48e70, 0, 11.89, d - 0.17, 2.49, 1.12, 0.36);
    for (const x of [-1.02, -0.34, 0.34, 1.02]) {
      wall.box('plaster', 0xd3b998, x, 11.87, d + 0.035, 0.17, 1.13, 0.18);
    }
    wall.box('glass', 0x676c64, 0, 9.9, d, 0.47, 0.95, 0.05);
    wall.box('plaster', 0xe0c6a2, 0, 10.44, d, 0.67, 0.15, 0.18);
  }
  box('plaster', 0xbea587, towerX, 12.5, towerZ, 3.16, 0.44, 2.8);
  round(POT, 'plaster', 0xb9a287, towerX, 13.16, towerZ, 0.97, 0.78, 0.97, new THREE.Quaternion().setFromAxisAngle(vector(1, 0, 0), Math.PI));
  pipe(vector(towerX, 13.48, towerZ), vector(towerX, 14.29, towerZ), 0.032, 0x726d59);
  round(LEAF, 'metal', 0x726d59, towerX, 14.21, towerZ, 0.09, 0.1, 0.09);
  for (const [x, z, h, lean] of [
    [-6.4, 38.4, 8.5, 0.86], [7.55, 31.94, 9.2, -0.45], [-6.0, -24.2, 8.6, 0.65],
    [7.45, -40.3, 9.9, -0.72], [-9.9, -42.7, 7.3, 0.26], [8.8, -57.6, 10.7, 0.43],
    [27.2, 24.1, 7.9, 0.63], [-28.8, -11.3, 8.1, -0.63],
  ]) palm(x, z, h, lean);

  for (const [x, z, angle, style, w, d] of [
    [-5.34, 41.23, Math.PI / 2, 0, 4.4, 2.7],
    [5.86, 38.72, -Math.PI / 2, 1, 4.6, 2.4],
    [-5.44, 32.3, Math.PI / 2, 1, 4.1, 2.65],
    [5.83, 29.6, -Math.PI / 2, 2, 4.02, 2.44],
    [-5.57, 22.8, Math.PI / 2, 0, 4.3, 2.27],
    [5.61, 10.1, -Math.PI / 2, 3, 4.51, 2.75],
    [-5.44, 8.5, Math.PI / 2, 1, 4.1, 2.53],
    [5.7, -7.2, -Math.PI / 2, 0, 3.7, 2.3],
    [-5.62, -18.62, Math.PI / 2, 2, 3.6, 2.2],
    [-26.9, 8.7, -Math.PI / 2, 0, 4.1, 2.54],
    [26.57, -17.14, Math.PI / 2, 2, 3.7, 2.72],
  ]) stall(x, z, angle, style, w, d, Math.abs(x) < 8);

  awning(vector(-8.01, 3.08, 50), Math.PI / 2, 4.04, 1.93, 3);
  awning(vector(8.07, 2.65, 42.1), -Math.PI / 2, 4.39, 2.02, 0);
  awning(vector(8.0, 2.65, -44.83), -Math.PI / 2, 3.15, 1.87, 1);
  awning(vector(-8.1, 3.12, -46.7), Math.PI / 2, 3.4, 1.82, 2);

  for (const [x, z, a, n, tiers] of [
    [-2.8, 43.25, 0.32, 3, 4], [3.8, 21.5, 0.74, 3, 4], [-3.53, 1.77, -0.42, 4, 5],
    [3.71, -26.34, 0.51, 4, 4], [-3.14, -45.1, -0.12, 4, 4], [6.2, -54.1, 0.82, 3, 4],
    [-28.55, 31.2, -0.53, 4, 3], [28.55, -32.4, 0.32, 4, 3],
  ]) sandbags(x, z, a, n, tiers);
  for (const [x, z, a, w] of [
    [3.55, 44.7, 0.23, 2.32], [1.93, 28.1, 0.23, 2.61], [-2.84, 17.02, -0.23, 2.21],
    [3.17, -2.2, 0.29, 2.68], [-2.75, -18.4, 0.18, 2.5], [1.92, -49.4, 0.43, 2.4],
    [-28.4, 14.5, 0.71, 2.51], [30.9, 16.2, 0.59, 2.8], [27.8, -5.1, -0.46, 3.03],
    [31, -42.1, 0.13, 2.52], [-30.6, -40.2, -0.2, 2.91],
  ]) barrier(x, z, a, w);
  const trucks = [
    [4.64, 18.28, -0.1, 0x929991], [-4.31, -9.73, 3.02, 0xb69d74],
    [24.2, 37.3, 0.08, 0x687579], [-32, -29.1, -0.13, 0xb2aba1],
  ];
  for (const [index, [x, z, angle, tint]] of trucks.entries()) pickup(x, z, angle, tint, index);

  for (const [x, z, amount] of [
    [-5.58, 46.6, 5], [5.43, 43.3, 3], [-4.45, 35.4, 4], [5.57, 34.1, 3],
    [6.1, 26.7, 5], [-6.16, 17.9, 3], [-6.4, 5.61, 5], [5.13, 5.7, 4],
    [-6.38, -7.63, 4], [6.36, -17.6, 3], [6.9, -32.6, 2], [-6.35, -37.6, 3],
    [5.34, -45.6, 4], [-5.53, -50.38, 2], [-27.2, 34.6, 3], [31.4, 32.6, 4],
    [-29, -6.1, 3], [26.6, -10.34, 3], [-28.87, -50.5, 3], [30.57, -50.45, 4],
  ]) {
    for (let i = 0; i < amount; i++) {
      const xx = x + range(-0.58, 0.67);
      const zz = z + (i - amount / 2) * range(0.55, 0.81);
      if (i === 1) {
        drum(xx, zz, pick([0x6c7770, 0x9b6549, 0x6b8283, 0xa38b62]), 0, range(0.8, 1.06));
      } else if (i === 2 && amount > 3) {
        planter(xx, 0, zz, range(0.24, 0.36));
      } else {
        const w = range(0.52, 0.89);
        const h = range(0.42, 0.76);
        crate(xx, 0, zz, w, h, range(0.6, 0.84), range(-0.23, 0.22));
        if (i === 0 && amount > 2) crate(xx + 0.07, h, zz + 0.025, w * 0.81, h * 0.71, w * 0.78, range(-0.24, 0.24), 0x9f865e);
      }
    }
  }

  for (const [z, sag] of [[45.6, 1.11], [36.4, 0.91], [26.5, 1.3], [11.4, 0.74], [-5.7, 1.3], [-17.74, 1.08], [-43.3, 0.68]]) {
    for (let i = 0; i < 3; i++) {
      suspendedLine(vector(-8.01, 6.2 + i * 0.2, z + i * 0.16),
        vector(8.08, 6.89 + i * 0.095, z - 1.52 + i * 0.12), sag + i * 0.096, i === 1 ? 0.024 : 0.015, 0x4b4940);
    }
  }
  for (const [z, y, width, style, side] of [[36, 5.37, 1.32, 0, -1], [25.9, 5.7, 1.21, 3, 1], [-16.6, 5.12, 0.92, 1, -1]]) {
    suspendedLine(vector(-8.05, y + 0.6, z), vector(8.06, y + 0.61, z + 1), 0.61, 0.013, 0x544d3d);
    const hangingPoint = x => {
      const t = (x + 8.05) / 16.11;
      return vector(x, y + .60 + .01 * t - 4 * .61 * t * (1 - t), z + t);
    };
    const lineAngle = -Math.atan2(1, 16.11);
    awning(hangingPoint(side * 3.12), lineAngle, width, .92, style, true);
    awning(hangingPoint(side * 1.48), lineAngle, width * .72, .66, (style + 1) % 4, true);
  }

  // Hand-placed detail clusters around edges, with a quieter driving line.
  for (let i = 0; i < 1150; i++) {
    const z = range(-57, 58);
    const side = rand() < 0.5 ? -1 : 1;
    const lane = i % 7 < 5 ? 0 : pick([-30, 29]);
    const x = lane + side * (i % 6 ? range(4.95, lane ? 6.8 : 7.81) : range(1.0, 5.8));
    const size = range(0.016, 0.119) * (i % 5 === 0 ? 1.37 : 1);
    const color = pick([0x9b8b6f, 0xaa9a7f, 0xc6ae8d, 0x827664, 0xb1a488, 0xb98e6b, 0x86674f]);
    round(ROCK, 'gravel', color, x, size * 0.35 + (Math.abs(x) > 6.3 && Math.abs(x) < 7.95 ? 0.052 : 0),
      z, size, size * range(0.25, 0.72), size * range(0.68, 1.33), rand() * TAU);
    if (i % 28 === 0 && Math.abs(x - lane) > 5) shrub(x + 0.22, 0.01, z, range(0.15, 0.34));
    if (i % 22 === 0) {
      box('wood', pick([0xa78c62, 0x927b58, 0x846e51]), x + 0.36, 0.017, z - 0.16, range(0.26, 0.72), 0.019, range(0.053, 0.11), rand() * TAU);
    }
    if (i % 48 === 0) {
      const paper = new THREE.Mesh(new THREE.PlaneGeometry(range(0.12, 0.2), range(0.08, 0.15)), new THREE.MeshStandardMaterial({
        color: pick([0xd8c4a2, 0xc9b897, 0xb7ae9c]), roughness: 0.95, side: THREE.DoubleSide,
      }));
      paper.rotation.set(-Math.PI / 2 + 0.03, 0, rand() * TAU);
      paper.position.set(x - side * 0.9, 0.012, z);
      paper.receiveShadow = true;
      scene.add(paper);
      flutter.push({ paper, x: paper.position.x, z, phase: rand() * TAU });
    }
  }
  for (const [x, z, color] of [[-7.08, 49.4, 0x956d4e], [6.92, 46.67, 0x65736b], [6.21, 44.27, 0x8a7254], [6.37, 36.5, 0x707d79]]) {
    planter(x, 0.06, z, 0.35);
    drum(x + (x > 0 ? -0.69 : 0.68), z + 0.45, color, 0, 0.81);
  }

  // Thin boundary walls close off the surrounding roofs and service yards.
  for (const side of [-1, 1]) {
    box('plaster', 0xb6a58e, side * 64.8, 1.55, 0, 0.45, 3.1, 132);
    box('plaster', 0xc9b695, side * 64.8, 3.08, 0, 0.58, 0.16, 132);
    box('plaster', 0xc2ae92, side * 35.23, 1.55, -63.8, 60.55, 3.1, 0.45);
    box('plaster', 0xcfbd9f, side * 35.23, 3.08, -63.8, 60.55, 0.16, 0.57);
    body(side * 64.8, 1.55, 0, 0.45, 3.1, 132);
    body(0, 1.55, side * 63.8, 131, 3.1, 0.45);
  }
  box('plaster', 0xc2ae92, 0, 1.55, 63.8, 131, 3.1, 0.45);
  box('plaster', 0xcfbd9f, 0, 3.08, 63.8, 131, 0.16, 0.57);
  // Stepped roof access to one low crossing platform.
  const stairs = local(11.4, -37.7, 0);
  for (let i = 0; i < 9; i++) {
    const h = (i + 1) * 0.218;
    stairs.box('plaster', 0xb8a68c, 0, h / 2, -i * 0.34, 1.9, h, 0.345);
    stairs.body(0, h / 2, -i * 0.34, 1.9, h, 0.345);
  }
  stairs.box('plaster', 0xb8a68c, 0, 0.981, -3.63, 2.17, 1.962, 1.8);
  stairs.body(0, 0.981, -3.63, 2.17, 1.962, 1.8);
  stairs.box('plaster', 0xb29d80, 0, 2.51, -4.47, 2.14, 1.1, 0.16);
  stairs.body(0, 2.51, -4.47, 2.14, 1.1, 0.16);

  // Street ornament uses its own random state so placement cannot move the colliders.
  const detailRand = seeded(seed ^ 0x9e3779b9);
  const dRange = (lo, hi) => lo + (hi - lo) * detailRand();
  const dPick = list => list[Math.floor(detailRand() * list.length)];

  for (const [z, span, awnings] of [
    [39.8, 3.8, [[-3.44, 3.38, 0xad9473], [3.46, 2.21, 0x83795e]]],
    [20.4, 3.4, [[1.45, 4.68, 0xa58c68]]],
    [1.8, 3.6, [[-3.64, 3.46, 0x92815e], [1.35, 2.47, 0x827d63]]],
    [-14.6, 3.2, [[3.48, 2.88, 0x9c896d]]],
  ]) {
    addShadePergola(local(0, z, 0), span, awnings);
  }

  const addArchLantern = (lx, ly, lz) => {
    round(PIPE, 'metal', 0x3a3b35, lx, ly + 0.16, lz, 0.018, 0.16, 0.018);
    round(POT, 'metal', 0x383a33, lx, ly + 0.05, lz, 0.14, 0.08, 0.14);
    round(DRUM, 'lantern', 0xffe4a8, lx, ly - 0.07, lz, 0.105, 0.20, 0.105);
    round(POT, 'metal', 0x383a33, lx, ly - 0.19, lz, 0.09, 0.06, 0.09);
  };
  for (const s of [-1, 1]) {
    addArchLantern(s * 3.85, 5.15, -33.35);
    addArchLantern(s * 3.85, 5.15, -36.25);
  }

  // 3. Stone flagstone runners & archway threshold bands along the bazaar spine
  for (let z = -52; z <= 52; z += 2.6) {
    if (z > -45 && z < -27) continue;
    for (const s of [-1, 1]) {
      const stoneTint = dPick([0x9e927c, 0x948873, 0xa89b84, 0x8d826e]);
      const stoneZ = z + dRange(-0.08, 0.08);
      box('road', shade(stoneTint, .69), s * 4.85, -.007, stoneZ, .922, .003, 2.35);
      addStoneRunner(round, s * 4.85, stoneZ, Math.abs(Math.round(z + s * 7)) % 4, shade(stoneTint, 1.68));
    }
  }
  for (const zBand of [-26.8, -34.8]) {
    box('brick', 0xb6a184, 0, -0.006, zBand, 8.2, 0.022, 1.35);
    box('plaster', 0x9c8b72, 0, -0.005, zBand - 0.72, 8.3, 0.023, 0.14);
    box('plaster', 0x9c8b72, 0, -0.005, zBand + 0.72, 8.3, 0.023, 0.14);
  }

  // Terracotta jars beside the market stalls.
  for (const [ax, az] of [
    [-6.25, 42.8], [6.35, 39.9], [-6.18, 30.8], [6.28, 28.1],
    [-6.22, 21.2], [6.15, 11.6], [-6.12, 6.9], [6.22, -5.8],
    [-6.15, -17.1], [-4.85, -33.1], [4.85, -36.4],
  ]) {
    placeAsset('TerracottaPair', vector(ax, Math.abs(ax) > 6.3 ? 0.065 : 0.007, az), dRange(-0.62, 0.62));
  }

  addMarketSkyline(local, shade);
  batches.build();
  const dustPositions = [];
  const dustPhase = [];
  for (let i = 0; i < 260; i++) {
    dustPositions.push(range(-7.5, 7.5), range(0.1, 4.4), range(-49, 58));
    dustPhase.push(rand() * TAU);
  }
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute('position', new THREE.Float32BufferAttribute(dustPositions, 3));
  dustGeometry.setAttribute('phase', new THREE.Float32BufferAttribute(dustPhase, 1));
  const dust = new THREE.Points(dustGeometry, new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    depthWrite: false,
    transparent: true,
    vertexShader: `
      uniform float time;
      attribute float phase;
      varying float alpha;
      void main() {
        vec3 p = position;
        p.x += sin(time * .36 + phase) * .7;
        p.y += sin(time * .46 + phase * 3.) * .33;
        p.z += cos(time * .26 + phase) * 1.4;
        vec4 view = modelViewMatrix * vec4(p, 1.);
        float d = length(view.xyz);
        alpha = smoothstep(1., 3., d) * (1. - smoothstep(12., 26., d))
          * (.64 + sin(time * 1.2 + phase) * .32);
        gl_Position = projectionMatrix * view;
        gl_PointSize = clamp(13. / max(1., d), 1., 3.);
      }`,
    fragmentShader: `
      varying float alpha;
      void main() {
        float center = max(0., 1. - length(gl_PointCoord - .5) * 2.);
        gl_FragColor = vec4(.74, .64, .48, center * center * alpha * .22);
      }`,
  }));
  scene.add(dust);
  const owned = scene.children.slice(sceneOffset);

  const spawns = [
    [vector(0, 0, 47), vector(-29.4, 0, 51.5), vector(28.7, 0, 49.8), vector(-2.4, 0, 53.4), vector(4.2, 0, 53.7)],
    [vector(0.5, 0, -56.3), vector(-29.4, 0, -53), vector(29.4, 0, -54.3), vector(-4.9, 0, -59.3), vector(4, 0, -59)],
  ];
  const landmarks = {
    spawn: { position: vector(0, 1.66, 47), yaw: 0, pitch: 0.016 },
    market: { position: vector(-1.97, 1.66, 34.2), yaw: 0.15, pitch: 0.019 },
    arch: { position: vector(1.95, 1.66, -18.7), yaw: -0.098, pitch: 0.039 },
    plaza: { position: vector(-1.3, 1.66, -25.7), yaw: 0.125, pitch: 0.091 },
    alley: { position: vector(-30.6, 1.66, 41.3), yaw: 0.058, pitch: 0.014 },
  };

  function update(time) {
    dust.material.uniforms.time.value = time;
    for (const item of windMeshes) {
      const { mesh, base, phase, drape, support } = item;
      const attr = mesh.geometry.getAttribute('position');
      const axis = drape ? 2 : 1;
      for (let i = 0; i < attr.count; i++) {
        const offset = i * 3;
        const x = base[offset];
        const stretch = drape ? -base[offset + 1] : base[offset + 2];
        const flex = drape ? .034 * stretch : .022 * Math.sin(Math.PI * Math.min(1, stretch / support));
        const ripple = (Math.sin(time * 1.57 + phase + x * 1.77 - stretch * 2.14) +
          Math.sin(time * 0.87 + phase * 1.9 + x * 2.42) * 0.36) * flex;
        attr.array[offset + axis] = base[offset + axis] + ripple;
      }
      attr.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
    }
    for (const { mesh, phase } of cables) mesh.position.z = Math.sin(time * 0.91 + phase) * 0.019;
    for (const { group, phase } of palms) {
      group.rotation.x = Math.sin(time * 0.74 + phase) * 0.048 + Math.sin(time * 1.47 + phase) * 0.012;
      group.rotation.z = Math.sin(time * 0.91 + phase * 2.47) * 0.041;
    }
    for (const { paper, x, z, phase } of flutter) {
      const t = Math.max(0, Math.sin(time * 0.31 + phase) - 0.86) * 5;
      paper.position.set(x + t * 0.41, 0.012 + Math.abs(Math.sin(time * 8 + phase)) * t * 0.14, z + t * 0.84);
      paper.rotation.x = -Math.PI / 2 + t * Math.sin(time * 7.3 + phase) * 0.9;
    }
  }

  function dispose() {
    const geometries = new Set();
    const uniqueMaterials = new Set(Object.values(materials));
    const textures = new Set();
    for (const root of owned) {
      root.traverse(object => {
        if (object.geometry) geometries.add(object.geometry);
        if (object.material) uniqueMaterials.add(object.material);
      });
      root.removeFromParent();
    }
    for (const geometry of geometries) geometry.dispose();
    for (const material of uniqueMaterials) {
      if (material.map) textures.add(material.map);
      if (material.bumpMap) textures.add(material.bumpMap);
      if (material.normalMap) textures.add(material.normalMap);
      if (material.roughnessMap) textures.add(material.roughnessMap);
      material.dispose();
    }
    for (const texture of textures) texture.dispose();
    owned.length = 0;
  }

  function attachBakedWorld(meshes) {
    for (const mesh of meshes) {
      const key = mesh.userData.worldMaterial;
      if (key) {
        if (!materials[key]) throw new Error('Unknown Al Marfa material ' + key);
        mesh.material.dispose();
        mesh.material = materials[key];
      }
      mesh.castShadow = mesh.userData.worldCastShadow ?? true;
      mesh.receiveShadow = mesh.userData.worldReceiveShadow ?? true;
      mesh.userData.nearShadowOnly = !key;
      scene.add(mesh);
      owned.push(mesh);
    }
  }

  return { colliders, spawns, landmarks, bounds, assetPlacements, update, dispose, attachBakedWorld };
}
