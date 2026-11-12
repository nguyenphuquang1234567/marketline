import * as THREE from 'three';

function beveledSetts(seed) {
  // Replace the paved strip with a shallow recessed bed and individual dressed
  // limestone setts. Side faces taper to visibly separate adjoining stones.
  const positions = [], colors = [], uvs = [], indices = [];
  const stone = new THREE.Color();
  let state = seed;
  const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
  const finish = [0xaaa28e, 0x938c78, 0xa19580, 0x9c937d, 0xb3a58e, 0x877d6c];
  const count = 6;
  const rowSize = 1 / count;
  for (let row = 0; row < count; row++) {
    const boundary = [-.10, .08, -.18, .03, .17, -.065][row];
    const left = -.5 + .02 * random(), right = .5 - .02 * random();
    const bottom = -.5 + row * rowSize + .002 + random() * .006;
    const top = -.5 + (row + 1) * rowSize - .006 - random() * .006;
    const middle = boundary + .10 * random();
    for (const [lo, hi] of [[left, middle - .006], [middle + .006, right]]) {
      const x0 = lo + .004, x1 = hi - .004;
      const cut = .019 + random() * .018;
      const crown = .011 + random() * .009;
      const corners = [
        [x0 + cut, bottom], [x0, bottom + cut * .45], [x0, top - cut * .45], [x0 + cut, top],
        [x1 - cut, top], [x1, top - cut * .45], [x1, bottom + cut * .45], [x1 - cut, bottom],
      ];
      const offset = positions.length / 3;
      const cx = (x0 + x1) * .5, cz = (bottom + top) * .5;
      stone.set(finish[Math.floor(random() * finish.length)]);
      for (const [y, inset, shade] of [[-.011, .96, .59], [crown - .008, 1, .86], [crown, .89, 1]]) {
        for (const [x, z] of corners) {
          positions.push(cx + (x - cx) * inset, y, cz + (z - cz) * inset);
          colors.push(stone.r * shade, stone.g * shade, stone.b * shade);
          uvs.push(x + .5, z + .5);
        }
      }
      for (let ring = 0; ring < 2; ring++) {
        for (let i = 0; i < 8; i++) {
          const a = offset + ring * 8 + i, b = offset + ring * 8 + (i + 1) % 8;
          indices.push(a, b, a + 8, b, b + 8, a + 8);
        }
      }
      for (let i = 1; i < 7; i++) indices.push(offset + 16, offset + 16 + i, offset + 17 + i);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

const stoneRows = [17, 99, 317, 1517].map(beveledSetts);

export function addStoneRunner(round, x, z, variant, tint) {
  round(stoneRows[variant], 'limestone', tint, x, -.002, z, .92, 1, 2.35);
}

const repairShape = new THREE.Shape([
  [-.5, -.38], [-.43, -.5], [.26, -.47], [.46, -.32], [.5, .24],
  [.34, .48], [-.18, .5], [-.41, .35],
].map(p => new THREE.Vector2(...p)));
const repairGeometry = new THREE.ShapeGeometry(repairShape).rotateX(-Math.PI / 2);

export function addUtilityRepairs(round) {
  for (const [x, z, width, depth, angle] of [
    [-.89, 42.21, 1.65, 2.37, .18], [2.16, 30.04, 1.32, 1.92, -.34],
    [-1.4, 7.45, 1.33, 1.72, -.17], [.61, -24.86, 1.92, 2.31, .32],
    [2.78, -44.07, 1.65, 2.24, -.32], [-28.5, 30.1, 1.87, 2.55, .25],
  ]) {
    round(repairGeometry, 'asphalt', 0x6a6558, x, -.0019, z, width + .09, 1, depth + .09, angle);
    round(repairGeometry, 'asphalt', 0x898476, x, .0005, z, width, 1, depth, angle);
  }
}

export function addServicePaving(box, round) {
  // A narrow pavement and runoff channel give the service lanes the same
  // kerb-to-road hierarchy as the market, without adding movement obstacles.
  const crossings = [-57, -42, -21, -3.8, 15.5, 33.8, 55];
  for (const x of [-30.4, 29.2]) {
    for (const side of [-1, 1]) {
      for (let i = 0; i < 60; i++) {
        const z = -59 + i * 2;
        if (crossings.some(crossing => Math.abs(z - crossing) < (Math.abs(crossing) > 50 ? 4.48 : 3.08))) continue;
        const tone = (i + side) % 4 ? 0xa49b89 : 0xb2a38c;
        box('limestone', tone, x + side * 3.98, .003, z, 1.32, .035, 1.987);
        box('limestone', 0x969080, x + side * 3.29, .004, z, .18, .042, 1.979);
        box('asphalt', 0x7d7868, x + side * 3.13, -.004, z, .18, .002, 1.98);
      }
    }
  }
  for (const [x, z, width, depth, angle] of [
    [-29.6, 37.05, 1.76, 2.13, -.27], [-31.6, 28.7, 1.2, 3.24, .15],
    [28.35, 28.4, 1.9, 2.68, .11], [-28.9, -12.5, 1.14, 3.4, .05],
    [30.25, -32.9, 1.8, 2.18, -.28],
  ]) round(repairGeometry, 'asphalt', 0x777166, x, -.0012, z, width, 1, depth, angle);
}
