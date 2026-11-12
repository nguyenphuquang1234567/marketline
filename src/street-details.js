import * as THREE from 'three';
import { streetLabelUV } from './street-finishes.js';

const TAU = Math.PI * 2;
const metal = 'coatedSteel';
const labels = new Map();
for (const name of ['plate0', 'plate1', 'plate2', 'plate3', 'delivery', 'cargo', 'meter', 'label']) {
  labels.set(name, streetLabelUV(new THREE.PlaneGeometry(), name));
}

export function streetLabel(frame, name, x, y, z, w, h, angle = 0) {
  frame.mesh(labels.get(name), 'streetLabel', 0xffffff, x, y, z, w, h, 1, angle);
}

// The rolled hoops and the recessed lid are part of the same steel shell.
const drum = new THREE.LatheGeometry([
  [0, .006], [.304, .006], [.331, .004], [.351, .010], [.359, .023],
  [.356, .040], [.336, .054], [.333, .208], [.339, .219], [.355, .232],
  [.355, .253], [.336, .270], [.332, .293], [.332, .626], [.338, .645],
  [.354, .659], [.355, .678], [.337, .696], [.333, .717], [.333, .913],
  [.353, .927], [.357, .945], [.350, .960], [.327, .963], [.315, .949],
  [.311, .924], [.286, .913], [.262, .910], [0, .910],
].map(([r, y]) => new THREE.Vector2(r, y)), 24);
const drumLabel = streetLabelUV(new THREE.CylinderGeometry(.3345, .3345, .235, 16, 1, true, -.79, 1.58), 'fuel');
const hex = new THREE.CylinderGeometry(1, 1, 1, 6);
const ring = new THREE.CylinderGeometry(1, 1, 1, 16);

export function addSteelDrum(frame, y, size, tint) {
  frame.mesh(drum, metal, tint, 0, y, 0, size, size, size);
  frame.mesh(drumLabel, 'streetLabel', 0xffffff, 0, y + .456 * size, 0, size, size, size);
  for (const [x, z, radius] of [[-.176, .097, .047], [.174, -.107, .035]]) {
    frame.mesh(ring, metal, 0x6d6556, x * size, y + .923 * size, z * size, radius * 1.24 * size, .029 * size, radius * 1.24 * size);
    frame.mesh(hex, 'metal', 0x857b62, x * size, y + .946 * size, z * size, radius * size, .025 * size, radius * size);
  }
}

export function addTimberCrate(frame, y, width, height, depth, tint, shade) {
  const trim = shade(tint, 1.19);
  const base = .074;
  const thickness = .026;
  const rows = Math.max(3, Math.round((height - base) / .16));
  const board = (height - base) / rows;
  const xWall = width / 2 - thickness / 2;
  const zWall = depth / 2 - thickness / 2;
  for (const side of [-1, 1]) {
    for (let i = 0; i < rows; i++) {
      const row = y + base + board * (i + .5);
      const face = shade(tint, 1.03 - .14 * ((i + side + 1) % 3) / 2);
      frame.box('wood', face, 0, row, side * zWall, width, board - .004, thickness);
      frame.box('wood', shade(face, .89), side * xWall, row, 0, thickness, board - .004, depth - 2 * thickness);
    }
    for (const corner of [-1, 1]) {
      const x = corner * (width / 2 - .05);
      frame.box('wood', trim, x, y + (height + base) / 2, side * (depth / 2 + .009), .077, height - base, .033);
      frame.box('wood', trim, side * (width / 2 + .009), y + (height + base) / 2, corner * (depth / 2 - .05), .033, height - base, .077);
      for (const boltY of [y + base + .061, y + height - .052]) {
        frame.box('metal', 0x686052, x, boltY, side * (depth / 2 + .027), .014, .014, .004);
      }
    }
    frame.box('wood', shade(tint, .85), side * (width / 2 - .075), y + base / 2, 0, .11, base, depth);
    frame.box('wood', trim, 0, y + height - .062, side * (depth / 2 + .004), width - .19, .074, .023);
  }
  const lidWidth = width / 5;
  for (let i = 0; i < 5; i++) {
    frame.box('wood', shade(tint, i % 2 ? 1.18 : 1.02), lidWidth * (i - 2), y + height - .019, 0,
      lidWidth - .004, .038, depth - 2 * thickness);
  }
  const labelW = Math.min(width * .47, .26);
  streetLabel(frame, 'cargo', 0, y + height * .54, depth / 2 + .002, labelW, labelW * .59);
  streetLabel(frame, 'label', 0, y + height * .58, -depth / 2 - .002, labelW, labelW * .54, Math.PI);
}

const shutter = (() => {
  const positions = [];
  const uvs = [];
  const indices = [];
  const count = 22;
  const profile = [[0, .001], [.10, .007], [.26, .024], [.51, .027], [.70, .017], [.89, .007], [1, .001]];
  for (let i = 0; i < count; i++) {
    const offset = positions.length / 3;
    for (const [row, z] of profile) {
      const y = (i + row) / count - .5;
      positions.push(-.5, y, z, .5, y, z);
      uvs.push(0, y + .5, 1, y + .5);
    }
    for (let p = 0; p < profile.length - 1; p++) {
      const j = offset + p * 2;
      indices.push(j, j + 1, j + 2, j + 1, j + 3, j + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
})();

export function addRolledShutter(frame, x, y, face, w, h, tint) {
  frame.mesh(shutter, metal, tint, x, y - .016, face - .247, w - .134, h - .10, 1);
  const bottom = y - h / 2 + .076;
  frame.box(metal, 0x575e55, x, bottom, face - .203, w - .13, .067, .07);
  for (const offset of [-1, 1]) {
    const rail = x + offset * (w / 2 - .082);
    for (const level of [bottom + .25, y, y + h / 2 - .31]) {
      frame.box('metal', 0x8b8673, rail, level, face - .121, .015, .015, .008);
    }
  }
  frame.pipe(x - .061, bottom + .095, face - .144, x + .061, bottom + .095, face - .144, .014, 0x68685e);
  frame.box(metal, 0x796c4f, x, bottom + .02, face - .136, .068, .075, .037);
}

export function addMeterDetails(frame, x, y, face) {
  frame.box(metal, 0x82816b, x, y, face + .136, .337, .467, .038);
  frame.box('rubber', 0x444742, x, y + .12, face + .16, .225, .103, .016);
  frame.box('glass', 0x777971, x, y + .12, face + .172, .189, .072, .016);
  streetLabel(frame, 'meter', x, y - .035, face + .159, .174, .083);
  for (const side of [-1, 1]) {
    frame.box('metal', 0x6e6654, x + side * .139, y - .154, face + .159, .02, .041, .015);
  }
  frame.pipe(x, y - .236, face + .066, x, .47, face + .066, .022, 0x565850);
  frame.pipe(x, .47, face + .066, x + .16, .32, face + .04, .022, 0x565850);
}

const tireTreads = (() => {
  const lug = new THREE.BoxGeometry(.078, .020, .070);
  const p = lug.attributes.position, n = lug.attributes.normal, uv = lug.attributes.uv;
  const positions = [], normals = [], uvs = [], indices = [];
  const point = new THREE.Vector3(), normal = new THREE.Vector3();
  const axis = new THREE.Vector3(1, 0, 0);
  const count = 32;
  for (let step = 0; step < count; step++) {
    for (const side of [-1, 1]) {
      const angle = TAU * (step + side * .14) / count;
      const offset = positions.length / 3;
      for (let i = 0; i < p.count; i++) {
        point.fromBufferAttribute(p, i);
        point.z += point.x * side * .43;
        point.x += side * .042;
        point.y += .390;
        point.applyAxisAngle(axis, angle);
        normal.fromBufferAttribute(n, i);
        if (Math.abs(normal.z) > .5) normal.x -= side * normal.z * .43;
        normal.applyAxisAngle(axis, angle).normalize();
        positions.push(point.x, point.y, point.z);
        normals.push(normal.x, normal.y, normal.z);
        uvs.push(uv.getX(i), uv.getY(i));
      }
      for (const index of lug.index.array) indices.push(index + offset);
    }
  }
  lug.dispose();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
})();

export function addTireTreads(frame, x, y, z) {
  frame.mesh(tireTreads, 'rubber', 0x353430, x, y, z);
}

const drainRim = new THREE.LatheGeometry([
  [.345, -.007], [.349, .008], [.342, .021], [.303, .021], [.291, .010], [.291, -.007],
].map(([r, y]) => new THREE.Vector2(r, y)), 32);

export function addCastIronDrain(frame) {
  frame.mesh(ring, 'rubber', 0x2a2d28, 0, .001, 0, .318, .014, .318);
  frame.mesh(drainRim, metal, 0x62594b, 0, 0, 0);
  for (let i = -5; i <= 5; i++) {
    const x = i * .05;
    const half = Math.sqrt(.297 ** 2 - x ** 2);
    frame.box(metal, 0x5c5546, x, .016, 0, .028, .013, half * 2);
  }
  for (const z of [-.154, .153]) {
    frame.box(metal, 0x6b6454, 0, .014, z, .49, .011, .023);
  }
}

const dial = streetLabelUV(new THREE.CircleGeometry(1, 24), 'scale');
const scalePan = new THREE.LatheGeometry([
  [0, -.021], [.115, -.021], [.154, -.014], [.184, .012], [.191, .025],
  [.185, .029], [.175, .022], [.147, -.006], [.113, -.014], [0, -.014],
].map(([r, y]) => new THREE.Vector2(r, y)), 24);

export function addMarketScale(frame, x, y, z) {
  frame.box('rubber', 0x47473d, x, y + .017, z, .31, .034, .284);
  frame.box(metal, 0x536c64, x, y + .044, z, .302, .045, .274);
  frame.box(metal, 0x657b6e, x, y + .161, z - .021, .228, .216, .199);
  frame.pipe(x, y + .155, z + .071, x, y + .155, z + .102, .106, 0x727469, metal, ring);
  frame.mesh(dial, 'streetLabel', 0xffffff, x, y + .155, z + .103, .093, .093);
  frame.pipe(x, y + .259, z - .021, x, y + .319, z - .021, .032, 0x6e7166, 'metal');
  frame.mesh(scalePan, 'metal', 0x8d8c7d, x, y + .337, z - .021);
}

export const terracottaPlanter = new THREE.LatheGeometry([
  [0, .012], [.58, .012], [.64, .034], [.66, .106], [.72, .151],
  [.75, .207], [.81, .432], [.872, .691], [.92, .975], [.933, 1.071],
  [1.035, 1.092], [1.058, 1.125], [1.068, 1.241], [1.047, 1.271],
  [.944, 1.273], [.918, 1.242], [.908, 1.127], [.849, .998], [.68, .386],
  [.61, .15], [0, .15],
].map(([r, y]) => new THREE.Vector2(r, y)), 20);

export const succulentLeaf = (() => {
  const geometry = new THREE.SphereGeometry(1, 8, 8);
  const p = geometry.attributes.position;
  const colors = [];
  for (let i = 0; i < p.count; i++) {
    const t = (p.getY(i) + 1) / 2;
    const x = p.getX(i) * (1 - .52 * t);
    const crest = .088 * p.getZ(i) + .044 * (1 - Math.abs(x)) * Math.sin(Math.PI * t);
    p.setXYZ(i, x, t * (1 - .17 * t), t * t * .32 + crest);
    const dry = t ** 8;
    const shade = .67 + .39 * Math.sin(Math.PI * t * .74);
    colors.push(shade * (1 + dry * .27), shade * (1 - dry * .25), shade * (1 - dry * .30));
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
})();
