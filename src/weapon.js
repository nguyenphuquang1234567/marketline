import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const V3 = THREE.Vector3;
const PI = Math.PI;
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const smooth = THREE.MathUtils.smoothstep;

function randomGenerator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function grainTexture(random) {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const pixel = (y * size + x) * 4;
      const grain = random();
      data[pixel] = 215 + grain * 40;
      data[pixel + 1] = 165 + grain * 90;
      data[pixel + 2] = 220 + grain * 35;
      data[pixel + 3] = 255;
    }
  }
  for (let i = 0; i < 90; i++) {
    const y = Math.floor(random() * size);
    const x = Math.floor(random() * size);
    for (let j = 0, length = 1 + random() * 20; j < length; j++) {
      const pixel = (y * size + ((x + j) % size)) * 4;
      data[pixel + 1] = 75 + random() * 95;
    }
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function materials(texture) {
  const make = (color, roughness, metalness, bumpScale = 0.0022, detail = texture) =>
    new THREE.MeshStandardMaterial({
      color,
      roughness,
      metalness,
      roughnessMap: detail,
      bumpMap: detail,
      bumpScale,
    });
  return {
    body: make(0x56605f, 0.58, 0.36, 0.0020),
    trim: make(0x323a3c, 0.70, 0.34, 0.0022),
    edge: make(0x727c7a, 0.44, 0.58, 0.0016),
    steel: make(0x919c9d, 0.36, 0.68, 0.0014),
    dark: make(0x141c20, 0.72, 0.16, 0.0018),
    polymer: make(0x333c3a, 0.88, 0.06, 0.0032),
    pad: make(0x1f2629, 0.92, 0.02, 0.0035),
    brass: make(0xc49752, 0.34, 0.64, 0.0012),
    copper: make(0x985d42, 0.42, 0.54, 0.0012),
    accent: make(0xb89d68, 0.68, 0.22, 0.0020),
    railCover: make(0x78735b, 0.82, 0.16, 0.0030),
    linen: make(0x6e765c, 0.94, 0, 0.0055),
    linenLight: make(0x82866b, 0.93, 0, 0.0048),
    linenDark: make(0x464b3b, 0.95, 0, 0.0050),
    glove: make(0x4f5246, 0.92, 0.02, 0.0042),
    leather: make(0x2c2f2c, 0.80, 0.04, 0.0038),
    stitch: make(0x96957e, 0.96, 0, 0.0020),
  };
}

function bevel(width, height, depth, radius) {
  const w = width / 2 - radius;
  const h = height / 2 - radius;
  const outline = new THREE.Shape();
  outline.moveTo(-w, -h);
  outline.lineTo(w, -h);
  outline.lineTo(w, h);
  outline.lineTo(-w, h);
  outline.closePath();
  const geometry = new THREE.ExtrudeGeometry(outline, {
    depth: depth - radius * 2,
    steps: 1,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: radius,
    bevelThickness: radius,
  });
  geometry.translate(0, 0, -depth / 2 + radius);
  return geometry;
}

function ellipseTube(points, dimensions, sides = 12, wave = 0) {
  const path = new THREE.CatmullRomCurve3(points.map(point => new V3(...point)));
  const vertices = [];
  const normals = [];
  const uv = [];
  const indices = [];
  const radial = new V3();
  const offset = new V3();
  const reference = new V3(1, 0, 0);
  const center = new V3();
  const across = new V3();
  const above = new V3();
  const direction = new V3();

  for (let ring = 0; ring < dimensions.length; ring++) {
    const amount = ring / (dimensions.length - 1);
    path.getPoint(amount, center);
    path.getTangent(amount, direction);
    across.copy(reference).addScaledVector(direction, -reference.dot(direction)).normalize();
    above.crossVectors(direction, across).normalize();
    for (let side = 0; side <= sides; side++) {
      const angle = (side / sides) * PI * 2;
      const x = Math.cos(angle);
      const y = Math.sin(angle);
      const [baseWidth, baseHeight] = dimensions[ring];
      const fold = wave * (
        Math.sin(amount * PI * 6.5 + angle * 2) * 0.65
        + Math.cos(amount * PI * 11 - angle * 3) * 0.35
      ) * Math.sin(amount * PI);
      const width = baseWidth + fold;
      const height = baseHeight + fold * 0.85;
      offset.copy(center).addScaledVector(across, x * width).addScaledVector(above, y * height);
      radial.copy(across).multiplyScalar(x / width).addScaledVector(above, y / height).normalize();
      vertices.push(offset.x, offset.y, offset.z);
      normals.push(radial.x, radial.y, radial.z);
      uv.push(side / sides, amount * 2);
      if (side < sides && ring < dimensions.length - 1) {
        const a = ring * (sides + 1) + side;
        const b = a + sides + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  if (wave > 0) geometry.computeVertexNormals();
  return geometry;
}

class ModelBatch {
  constructor(group) {
    this.group = group;
    this.parts = new Map();
  }

  add(geometry, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    if (geometry.index) {
      const nonIndexed = geometry.toNonIndexed();
      geometry.dispose();
      geometry = nonIndexed;
    }
    const transform = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz));
    transform.setPosition(x, y, z);
    geometry.applyMatrix4(transform);
    if (!this.parts.has(material)) this.parts.set(material, []);
    this.parts.get(material).push(geometry);
  }

  box(material, x, y, z, w, h, d, radius = 0.0025, rx = 0, ry = 0, rz = 0) {
    const round = Math.min(radius, w * 0.45, h * 0.45, d * 0.45);
    this.add(bevel(w, h, d, round), material, x, y, z, rx, ry, rz);
  }

  tube(material, x, y, z, radius, length, sides = 20, open = false, axis = 'z', radiusEnd = radius) {
    this.add(new THREE.CylinderGeometry(radius, radiusEnd, length, sides, 1, open),
      material, x, y, z, axis === 'z' ? -PI / 2 : 0, 0, axis === 'x' ? -PI / 2 : 0);
  }

  ring(material, x, y, z, radius, inner, depth) {
    const rim = new THREE.Shape();
    const hole = new THREE.Path();
    rim.absarc(0, 0, radius, 0, PI * 2, false);
    hole.absarc(0, 0, inner, 0, PI * 2, true);
    rim.holes.push(hole);
    const geometry = new THREE.ExtrudeGeometry(rim, { depth, curveSegments: 20, bevelEnabled: false });
    this.add(geometry, material, x, y, z - depth * 0.5);
  }

  line(material, points, radius, sides = 6) {
    const curve = new THREE.CatmullRomCurve3(points.map(point => new V3(...point)));
    this.add(new THREE.TubeGeometry(curve, points.length * 2, radius, sides, false), material);
  }

  finish() {
    for (const [material, parts] of this.parts) {
      const mesh = new THREE.Mesh(mergeGeometries(parts), material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      for (const part of parts) part.dispose();
    }
    this.parts.clear();
  }
}

const SIGHT_HEIGHT = 0.123;
const MUZZLE_Z = -0.578;
const MAG_HOME = new V3(0, -0.05, -0.117);

function makeCarbine(group, m) {
  const a = new ModelBatch(group);
  a.box(m.body, 0, 0.002, 0.032, 0.077, 0.067, 0.263, 0.007);
  a.box(m.trim, 0, -0.043, 0.04, 0.071, 0.047, 0.234, 0.006);
  a.box(m.edge, 0, -0.021, 0.025, 0.079, 0.005, 0.235, 0.001);
  a.box(m.body, 0, -0.054, -0.087, 0.078, 0.063, 0.101, 0.005, -0.08);
  a.box(m.edge, 0, -0.08, -0.093, 0.081, 0.011, 0.096, 0.002);
  a.box(m.trim, 0, 0.047, -0.111, 0.052, 0.018, 0.52, 0.003);
  for (let i = 0; i < 33; i++) {
    a.box(i % 7 === 0 ? m.edge : m.body, 0, 0.057, 0.149 - i * 0.016, 0.061, 0.009, 0.010, 0.0012);
  }

  for (const side of [-1, 1]) {
    const x = side * 0.039;
    a.box(m.edge, x, 0.017, 0.048, 0.002, 0.009, 0.196, 0.0005);
    a.box(m.body, x, -0.047, -0.087, 0.004, 0.019, 0.095);
    a.tube(m.steel, x, -0.026, 0.136, 0.005, 0.008, 12, false, 'x');
    a.tube(m.edge, x, -0.025, -0.114, 0.006, 0.009, 12, false, 'x');
    a.tube(m.trim, x, -0.039, 0.066, 0.008, 0.011, 12, false, 'x');
    a.box(m.body, x + side * 0.006, -0.039, 0.072, 0.008, 0.006, 0.024, 0.002, -0.32);
    a.box(m.accent, x + side * 0.005, -0.052, 0.045, 0.001, 0.003, 0.007, 0.0003);
    a.box(m.edge, x + side * 0.001, -0.058, 0.074, 0.001, 0.002, 0.006, 0.0003);
    a.box(m.dark, x, -0.039, -0.015, 0.004, 0.013, 0.021, 0.001);
    a.tube(m.body, x + side * 0.004, -0.039, -0.015, 0.005, 0.008, 8, false, 'x');
    a.box(m.trim, x, 0.027, 0.141, 0.01, 0.009, 0.021);
    a.box(m.steel, x, -0.007, 0.103, 0.003, 0.005, 0.023, 0.001);
  }
  a.box(m.dark, 0.0395, 0.004, 0.001, 0.003, 0.025, 0.096, 0.001);
  a.box(m.edge, 0.048, -0.014, 0.005, 0.022, 0.005, 0.104, 0.0015, 0, 0, -0.26);
  a.box(m.trim, 0.044, 0.001, 0.06, 0.018, 0.019, 0.022, 0.003);
  a.box(m.body, 0.043, 0.011, 0.108, 0.014, 0.016, 0.034, 0.003, 0, 0.18, 0);
  a.tube(m.steel, 0.047, 0.011, 0.128, 0.0055, 0.014, 12);
  a.box(m.edge, -0.042, 0.003, -0.004, 0.006, 0.022, 0.014, 0.0015);
  a.box(m.dark, -0.04, -0.001, 0.051, 0.002, 0.021, 0.079, 0.001);
  for (let i = 0; i < 5; i++) {
    a.box(m.edge, -0.0414, -0.004, 0.031 + i * 0.009, 0.0008, 0.0015, 0.005, 0.0003);
  }
  a.tube(m.trim, 0, 0.005, 0.238, 0.024, 0.162, 16);
  a.tube(m.steel, 0, 0.005, 0.164, 0.031, 0.018, 14);
  a.box(m.polymer, 0, 0.004, 0.301, 0.061, 0.047, 0.119, 0.008);
  a.box(m.polymer, 0, -0.052, 0.351, 0.063, 0.145, 0.034, 0.008, -0.13);
  a.box(m.pad, 0, -0.055, 0.373, 0.071, 0.149, 0.016, 0.007, -0.13);
  for (let i = 0; i < 7; i++) {
    a.box(m.trim, 0, -0.105 + i * 0.016, 0.381 + i * 0.002, 0.063, 0.006, 0.004, 0.001);
  }
  for (const side of [-1, 1]) {
    a.box(m.polymer, side * 0.025, -0.063, 0.283, 0.017, 0.018, 0.13, 0.004, 0.48);
    a.box(m.edge, side * 0.029, -0.081, 0.325, 0.005, 0.015, 0.028, 0.002);
  }
  a.box(m.dark, 0, -0.052, 0.254, 0.028, 0.021, 0.051, 0.005);
  a.box(m.polymer, 0, -0.126, 0.09, 0.044, 0.116, 0.051, 0.006, -0.27);
  a.box(m.pad, 0, -0.177, 0.105, 0.047, 0.019, 0.057, 0.003, -0.27);
  for (let i = 0; i < 6; i++) {
    a.box(m.pad, 0, -0.103 - i * 0.012, 0.061 + i * 0.003, 0.04, 0.004, 0.009, 0.001, -0.25);
  }
  a.line(m.trim, [[0, -0.068, 0.063], [0, -0.111, 0.039], [0, -0.121, 0.008],
    [0, -0.105, -0.034], [0, -0.074, -0.041]], 0.005, 10);
  a.line(m.steel, [[0, -0.063, 0.015], [0, -0.088, 0.005], [0, -0.1, 0.018]], 0.0035, 8);

  a.tube(m.body, 0, -0.004, -0.244, 0.042, 0.288, 8);
  a.box(m.trim, 0, -0.043, -0.242, 0.047, 0.018, 0.281, 0.003);
  a.tube(m.trim, 0, -0.003, -0.39, 0.037, 0.022, 12);
  a.ring(m.edge, 0, -0.003, -0.403, 0.035, 0.022, 0.004);
  a.tube(m.dark, 0, 0.001, -0.453, 0.013, 0.136, 20);
  a.tube(m.edge, 0, 0.001, -0.453, 0.015, 0.014, 16);
  a.tube(m.body, 0, 0.001, -0.494, 0.014, 0.018, 16);
  a.tube(m.steel, 0, 0.001, -0.526, 0.019, 0.02, 12);
  a.ring(m.trim, 0, 0.001, -0.567, 0.019, 0.012, 0.007);
  a.ring(m.edge, 0, 0.001, -0.571, 0.018, 0.0125, 0.003);
  for (let i = 0; i < 5; i++) {
    const angle = i * PI * 0.4;
    a.box(m.trim, 0.0146 * Math.sin(angle), 0.001 + 0.0146 * Math.cos(angle),
      -0.547, 0.01, 0.006, 0.039, 0.001, 0, 0, -angle);
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const z = -0.146 - i * 0.035;
      a.box(m.dark, side * 0.040, 0.003, z, 0.004, 0.012, 0.025, 0.001);
      a.box(m.edge, side * 0.041, -0.0045, z, 0.002, 0.002, 0.025, 0.0004);
      a.box(m.dark, side * 0.026, -0.032, z + 0.004, 0.005, 0.005, 0.019, 0.001, 0, 0, side * -0.45);
    }
  }
  // Right-side tactical laser/illuminator box (PEQ-15 style) & top pressure switch pad
  a.box(m.railCover, 0.052, 0.008, -0.292, 0.024, 0.036, 0.082, 0.004);
  a.box(m.dark, 0.064, 0.008, -0.292, 0.004, 0.022, 0.054, 0.0015);
  a.tube(m.trim, 0.054, 0.016, -0.336, 0.0065, 0.012, 12);
  a.tube(m.edge, 0.054, -0.002, -0.336, 0.0055, 0.010, 12);
  a.box(m.accent, 0.056, 0.018, -0.282, 0.018, 0.012, 0.024, 0.001);
  a.box(m.pad, 0, 0.060, -0.236, 0.034, 0.008, 0.058, 0.002);
  a.line(m.dark, [[0.016, 0.058, -0.258], [0.038, 0.042, -0.272], [0.048, 0.022, -0.278]], 0.0024, 6);

  a.box(m.railCover, 0, -0.062, -0.275, 0.043, 0.037, 0.088, 0.004, -0.17);
  a.box(m.pad, 0, -0.079, -0.284, 0.044, 0.011, 0.075, 0.003, -0.17);
  for (let i = 0; i < 5; i++) {
    a.box(m.body, 0, -0.086 + i * 0.002, -0.258 - i * 0.011, 0.04, 0.003, 0.004, 0.001);
  }

  const z = -0.062;
  a.box(m.trim, 0, 0.072, z, 0.057, 0.024, 0.078, 0.005);
  a.box(m.edge, 0, 0.088, z, 0.036, 0.026, 0.062, 0.003);
  a.box(m.dark, 0, 0.074, z + 0.045, 0.039, 0.009, 0.018, 0.0015);
  a.tube(m.steel, -0.031, 0.073, z - 0.019, 0.008, 0.01, 10, false, 'x');
  a.tube(m.body, 0.033, 0.074, z + 0.018, 0.008, 0.011, 10, false, 'x');
  a.tube(m.trim, 0, SIGHT_HEIGHT, z, 0.0275, 0.069, 24, true);
  a.tube(m.trim, 0, SIGHT_HEIGHT, z, 0.0242, 0.066, 24, true);
  a.ring(m.trim, 0, SIGHT_HEIGHT, z + 0.04, 0.030, 0.0230, 0.014);
  a.ring(m.edge, 0, SIGHT_HEIGHT, z + 0.046, 0.0308, 0.0255, 0.003);
  a.ring(m.dark, 0, SIGHT_HEIGHT, z + 0.036, 0.025, 0.0220, 0.004);
  a.ring(m.trim, 0, SIGHT_HEIGHT, z - 0.039, 0.032, 0.0225, 0.014);
  a.ring(m.body, 0, SIGHT_HEIGHT, z - 0.045, 0.0315, 0.0260, 0.003);
  for (let i = 0; i < 14; i++) {
    const angle = i / 14 * 2 * PI;
    a.box(m.body, 0.0305 * Math.sin(angle), SIGHT_HEIGHT + 0.0305 * Math.cos(angle),
      z + 0.041, 0.005, 0.002, 0.010, 0.001, 0, 0, -angle);
  }
  a.tube(m.trim, 0, 0.153, z - 0.008, 0.013, 0.012, 16, false, 'y');
  a.tube(m.edge, 0, 0.159, z - 0.008, 0.012, 0.004, 12, false, 'y');
  a.box(m.dark, 0, 0.1615, z - 0.008, 0.012, 0.002, 0.002, 0.0004, 0, 0.3);
  a.tube(m.trim, -0.034, SIGHT_HEIGHT, z - 0.006, 0.015, 0.018, 16, false, 'x');
  a.tube(m.edge, -0.044, SIGHT_HEIGHT, z - 0.006, 0.014, 0.003, 14, false, 'x');
  a.box(m.accent, -0.046, SIGHT_HEIGHT + 0.006, z - 0.006, 0.001, 0.002, 0.01, 0.0004);
  a.box(m.trim, 0, 0.064, -0.344, 0.034, 0.012, 0.033, 0.002);
  a.box(m.edge, -0.012, 0.075, -0.35, 0.007, 0.02, 0.017, 0.002, -0.16);
  a.box(m.edge, 0.012, 0.075, -0.35, 0.007, 0.02, 0.017, 0.002, -0.16);
  a.finish();

  const bolt = new THREE.Group();
  const boltMesh = new ModelBatch(bolt);
  boltMesh.box(m.steel, 0.0405, 0.003, -0.015, 0.004, 0.019, 0.061, 0.001);
  boltMesh.box(m.dark, 0.043, 0.004, -0.004, 0.002, 0.011, 0.015, 0.001);
  boltMesh.box(m.trim, 0, 0.031, 0.168, 0.069, 0.012, 0.02, 0.002);
  boltMesh.finish();
  group.add(bolt);

  return bolt;
}

function makeLens() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    uniforms: {
      brightness: { value: 1 },
    },
    vertexShader: `
      varying vec3 eyeRay;
      varying vec2 lens;
      void main() {
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        vec3 xAxis = normalize(modelViewMatrix[0].xyz);
        vec3 yAxis = normalize(modelViewMatrix[1].xyz);
        vec3 zAxis = normalize(modelViewMatrix[2].xyz);
        eyeRay = vec3(dot(view.xyz, xAxis), dot(view.xyz, yAxis), dot(view.xyz, zAxis));
        lens = uv * 2.0 - 1.0;
        gl_Position = projectionMatrix * view;
      }`,
    fragmentShader: `
      uniform float brightness;
      varying vec3 eyeRay;
      varying vec2 lens;
      void main() {
        float radius = length(lens);
        vec2 direction = normalize(eyeRay).xy;
        float d = length(direction);
        float pixelWidth = max(0.00075, fwidth(d) * 0.5);
        float dotCore = 1.0 - smoothstep(0.0014, 0.0014 + pixelWidth, d);
        float halo = 0.20 * exp(-d*d*75000.0);
        float reflection = exp(-abs(lens.x + lens.y * 0.61 - 0.32) * 7.0);
        float fog = 0.07 + 0.35 * pow(radius, 4.0) + reflection * 0.07;
        vec3 tint = mix(vec3(0.10, 0.21, 0.17), vec3(0.31, 0.43, 0.31), reflection);
        vec3 color = tint + vec3(3.0, 0.16, 0.045) * brightness * (dotCore + halo);
        float opacity = max(fog, min(1.0, dotCore + halo));
        gl_FragColor = vec4(color, opacity);
      }`,
  });
}

function magazine(parent, m) {
  const group = new THREE.Group();
  const a = new ModelBatch(group);
  a.box(m.body, 0, -0.047, 0.017, 0.054, 0.104, 0.067, 0.005, 0.06);
  a.box(m.trim, 0, -0.123, 0.01, 0.054, 0.07, 0.065, 0.004, 0.19);
  a.box(m.edge, 0, -0.161, 0.004, 0.057, 0.014, 0.071, 0.004, 0.19);
  a.box(m.pad, 0, -0.166, 0.004, 0.056, 0.01, 0.067, 0.003, 0.19);
  a.box(m.dark, 0, 0.004, 0.017, 0.04, 0.009, 0.057, 0.003);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const z = i * 0.014 - 0.007;
      a.box(m.edge, side * 0.0275, -0.048, z + 0.006, 0.0025, 0.092, 0.004, 0.001, 0.06);
      a.box(m.body, side * 0.028, -0.119, z - 0.002, 0.003, 0.06, 0.006, 0.001, 0.19);
    }
  }
  a.finish();
  const rounds = new THREE.Group();
  const r = new ModelBatch(rounds);
  for (const side of [-1, 1]) {
    r.tube(m.brass, side * 0.008, 0.012 + side * 0.003, 0.018, 0.0046, 0.032, 12);
    r.tube(m.copper, side * 0.008, 0.012 + side * 0.003, -0.004, 0.0043, 0.012, 10, false, 'z', 0.0018);
  }
  r.finish();
  rounds.visible = false;
  group.add(rounds);
  group.position.copy(MAG_HOME);
  parent.add(group);
  return { group, rounds };
}

function sleeve(a, m, side) {
  const left = side < 0;
  const points = left
    ? [[-0.047, -0.089, -0.222], [-0.099, -0.144, -0.149], [-0.181, -0.237, -0.022], [-0.253, -0.307, 0.154]]
    : [[0.036, -0.162, 0.105], [0.072, -0.213, 0.18], [0.119, -0.281, 0.272], [0.168, -0.377, 0.402]];
  const path = new THREE.CatmullRomCurve3(points.map(point => new V3(...point)));
  const radii = [[0.035, 0.031], [0.037, 0.033], [0.041, 0.037], [0.044, 0.040],
    [0.047, 0.043], [0.050, 0.045], [0.053, 0.048], [0.056, 0.051], [0.059, 0.054],
    [0.062, 0.057], [0.065, 0.060], [0.068, 0.063], [0.070, 0.065]];
  a.add(ellipseTube(points, radii, 24, 0.0024), m.linen);

  // Structured tactical wrist cuff band and velcro closure strap
  const cuffPoints = [0.012, 0.038, 0.065, 0.092].map(t => path.getPoint(t).toArray());
  a.add(ellipseTube(cuffPoints, [[0.0365, 0.0325], [0.038, 0.034], [0.039, 0.035], [0.0385, 0.0345]], 20), m.linenDark);

  const cuffCenter = path.getPoint(0.045);
  a.box(m.polymer, cuffCenter.x + side * 0.034, cuffCenter.y + 0.012, cuffCenter.z, 0.012, 0.016, 0.028, 0.002, left ? 0.52 : -0.45);
  a.box(m.accent, cuffCenter.x + side * 0.038, cuffCenter.y + 0.014, cuffCenter.z - 0.004, 0.004, 0.008, 0.014, 0.001, left ? 0.52 : -0.45);

  if (left) {
    // Left-wrist tactical field watch (band + bezel + luminous dial)
    const watchPoints = [0.042, 0.058, 0.074].map(t => path.getPoint(t).toArray());
    a.add(ellipseTube(watchPoints, [[0.0392, 0.0352], [0.0398, 0.0358], [0.0392, 0.0352]], 20), m.pad);
    const wp = path.getPoint(0.058);
    a.box(m.trim, wp.x + 0.014, wp.y + 0.031, wp.z - 0.008, 0.030, 0.010, 0.030, 0.004, 0.56, -0.32, -0.38);
    a.box(m.steel, wp.x + 0.015, wp.y + 0.034, wp.z - 0.009, 0.025, 0.006, 0.025, 0.003, 0.56, -0.32, -0.38);
    a.box(m.dark, wp.x + 0.016, wp.y + 0.036, wp.z - 0.010, 0.019, 0.004, 0.019, 0.002, 0.56, -0.32, -0.38);
    a.box(m.accent, wp.x + 0.017, wp.y + 0.037, wp.z - 0.011, 0.003, 0.003, 0.011, 0.0005, 0.56, -0.32, -0.38);
  }

  // Forearm utility/comms pocket panel on upper-outer forearm
  const pocketPoints = [0.24, 0.34, 0.44, 0.54].map(t => {
    const p = path.getPoint(t);
    p.x += side * 0.011;
    p.y += 0.009;
    return p.toArray();
  });
  a.add(ellipseTube(pocketPoints, [[0.042, 0.038], [0.047, 0.042], [0.050, 0.045], [0.052, 0.046]], 16), m.linenLight);

  const seam = [];
  for (let i = 0; i < radii.length - 2; i++) {
    const t = i / (radii.length - 1);
    const p = path.getPoint(t);
    p.x += side * radii[i][0] * 0.72;
    p.y += radii[i][1] * 0.66;
    seam.push(p.toArray());
  }
  a.line(m.linenDark, seam, 0.0014);
  for (let i = 1; i < seam.length - 1; i++) {
    const from = new V3(...seam[i]);
    const next = new V3(...seam[i + 1]);
    for (let j = 0; j < 3; j++) {
      const p = from.clone().lerp(next, j / 3);
      a.box(m.stitch, p.x, p.y + 0.001, p.z, 0.0018, 0.0011, 0.004, 0.0003);
    }
  }
}

function glove(group, m, side, withSleeve = true) {
  const a = new ModelBatch(group);
  const left = side < 0;
  const z = left ? -0.239 : 0.101;
  const x = left ? -0.037 : 0.024;
  const y = left ? -0.071 : -0.126;
  const shift = left ? 0.024 : -0.019;
  const palm = [[x + shift * -1.0, y - 0.041, z + 0.034], [x, y - 0.016, z + 0.01],
    [x + shift * 0.2, y + 0.003, z - 0.016], [x + shift, y + 0.01, z - 0.031]];
  a.add(ellipseTube(palm, [[0.025, 0.027], [0.030, 0.026], [0.031, 0.024],
    [0.029, 0.021], [0.026, 0.018], [0.011, 0.0095], [0.003, 0.003]], 18), m.glove);
  const back = x + side * 0.024;
  a.box(m.leather, back, y + 0.006, z - 0.002, 0.017, 0.034, 0.045, 0.007, left ? -0.29 : 0.23);
  a.box(m.pad, back + side * 0.007, y + 0.009, z - 0.005, 0.009, 0.022, 0.034, 0.0035, left ? -0.32 : 0.25);
  a.box(m.trim, back + side * 0.010, y + 0.011, z - 0.012, 0.006, 0.016, 0.024, 0.002, left ? -0.32 : 0.25);
  for (let i = 0; i < 4; i++) {
    const offset = (i - 1.5) * 0.014;
    const knuckleY = y + offset * (left ? 0.45 : -0.95);
    const knuckleZ = z - 0.023 + offset * (left ? 1 : -0.14);
    const finger = [
      [back, knuckleY, knuckleZ + 0.011],
      [x + side * 0.012, knuckleY + (left ? -0.018 : 0.003), knuckleZ - (left ? 0.014 : 0.022)],
      [x - side * 0.009, knuckleY + (left ? -0.02 : 0.003), knuckleZ - (left ? 0.027 : 0.033)],
      [x - side * 0.024, knuckleY + (left ? -0.014 : 0.01), knuckleZ - (left ? 0.029 : 0.025)],
      [x - side * 0.026, knuckleY + (left ? -0.005 : 0.014), knuckleZ - (left ? 0.026 : 0.014)],
    ];
    if (!left && i === 0) {
      finger[2][2] -= 0.016;
      finger[3][2] -= 0.022;
      finger[4][2] -= 0.022;
    }
    a.add(ellipseTube(finger, [[0.0092, 0.0092], [0.009, 0.0082], [0.0082, 0.0072], [0.008, 0.0064],
      [0.0072, 0.0062], [0.0062, 0.0052], [0.0018, 0.0018]], 12), m.leather);
    // Molded TPR knuckle and proximal phalanx armor pads
    a.box(m.pad, back + side * 0.005, knuckleY + 0.005, knuckleZ + 0.005,
      0.013, 0.012, 0.018, 0.0035, 0, 0, side * 0.2);
    a.box(m.trim, x + side * 0.008, knuckleY + (left ? -0.012 : 0.004), knuckleZ - 0.010,
      0.009, 0.008, 0.012, 0.002, 0, 0, side * 0.15);
    a.line(m.stitch, [[back + side * 0.009, knuckleY - 0.002, knuckleZ + 0.005],
      [back + side * 0.01, knuckleY + 0.001, knuckleZ + 0.001],
      [back + side * 0.007, knuckleY + 0.004, knuckleZ - 0.004]], 0.0009, 5);
  }
  const thumb = left
    ? [[-0.058, -0.059, -0.22], [-0.055, -0.025, -0.239], [-0.042, -0.011, -0.261], [-0.034, -0.01, -0.279]]
    : [[0.035, -0.127, 0.113], [0.016, -0.096, 0.119], [-0.015, -0.088, 0.11], [-0.031, -0.093, 0.086]];
  a.add(ellipseTube(thumb, [[0.0135, 0.0125], [0.013, 0.011], [0.0115, 0.0102],
    [0.0102, 0.0092], [0.0092, 0.0082], [0.0072, 0.0062], [0.002, 0.002]], 14), m.glove);
  a.box(m.pad, x, y - 0.034, z + 0.029, 0.062, 0.053, 0.024, 0.007, left ? -0.54 : -0.65);
  a.box(m.accent, x + side * 0.027, y - 0.025, z + 0.029, 0.004, 0.013, 0.015, 0.001);
  if (withSleeve) sleeve(a, m, side);
  a.finish();
}

function muzzleFlash() {
  const group = new THREE.Group();
  const material = new THREE.ShaderMaterial({
    depthWrite: false,
    transparent: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { intensity: { value: 0 }, pattern: { value: 0 } },
    vertexShader: `
      varying vec2 point;
      void main() {
        point = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float intensity;
      uniform float pattern;
      varying vec2 point;
      void main() {
        vec2 p = point * 2.0 - 1.0;
        float center = length(p);
        float angle = atan(p.y, p.x);
        float shape = 0.52 + 0.14 * sin(angle * 7.0 + pattern) + 0.11 * sin(angle * 11.0 - pattern);
        float lobes = (1.0 - smoothstep(shape * 0.42, shape, center));
        float white = pow(1.0 - smoothstep(0.0, 0.31, center), 2.0);
        vec3 color = vec3(3.6, 0.96, 0.11) * lobes + vec3(4.0, 3.3, 2.1) * white;
        gl_FragColor = vec4(color, intensity * max(lobes * 0.86, white));
      }`,
  });
  const plane = new THREE.PlaneGeometry(0.38, 0.40);
  for (let i = 0; i < 3; i++) {
    const card = new THREE.Mesh(plane, material);
    card.rotation.y = i * PI / 3;
    if (i > 0) card.scale.y = 0.72;
    card.frustumCulled = false;
    card.renderOrder = 20;
    group.add(card);
  }
  group.position.set(0, 0.001, MUZZLE_Z - 0.064);
  group.visible = false;
  return { group, material };
}

const WRIST_HOME = new V3(-0.047, -0.089, -0.222);
const ELBOW_HOME = new V3(-0.253, -0.307, 0.154);
const SLEEVE_AXIS = new V3().subVectors(ELBOW_HOME, WRIST_HOME).normalize();
const SLEEVE_LENGTH = ELBOW_HOME.distanceTo(WRIST_HOME);
const MAG_GRIP = new V3(-0.025, -0.09, 0.017);

function nameplate(group) {
  const surface = document.createElement('canvas');
  surface.width = 256;
  surface.height = 96;
  const ctx = surface.getContext('2d');
  ctx.fillStyle = '#a5a58e';
  ctx.font = 'bold 29px monospace';
  ctx.fillText('ML  /  C-14', 11, 31);
  ctx.fillStyle = '#7f8479';
  ctx.font = '14px monospace';
  ctx.fillText('CARBINE   5.5', 12, 57);
  ctx.fillText('S/N  014-226', 12, 76);
  ctx.strokeStyle = '#777d72';
  ctx.beginPath();
  ctx.moveTo(10, 36);
  ctx.lineTo(209, 36);
  ctx.stroke();

  const map = new THREE.CanvasTexture(surface);
  map.colorSpace = THREE.SRGBColorSpace;
  const geometry = new THREE.PlaneGeometry(0.054, 0.021);
  const material = new THREE.MeshStandardMaterial({
    map, transparent: true, depthWrite: false, roughness: 0.95, color: 0xa0a4a0,
  });
  for (const side of [-1, 1]) {
    const mark = new THREE.Mesh(geometry, material);
    mark.position.set(side * 0.0392, 0.004, 0.105);
    mark.rotation.y = side * PI / 2;
    group.add(mark);
  }
  return map;
}

export class WeaponView {
  constructor(scene, seed = 2324) {
    this.random = randomGenerator(seed ^ 0xa130e9b);
    this.root = new THREE.Group();
    this.root.rotation.order = 'YXZ';
    scene.add(this.root);
    this.texture = grainTexture(this.random);
    this.materials = materials(this.texture);
    this.bolt = makeCarbine(this.root, this.materials);
    this.nameplate = typeof document === 'undefined' ? null : nameplate(this.root);
    this.mag = magazine(this.root, this.materials);
    this.sight = makeLens();
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.023, 32), this.sight);
    lens.position.set(0, SIGHT_HEIGHT, -0.026);
    lens.renderOrder = 10;
    this.root.add(lens);
    this.left = new THREE.Group();
    const right = new THREE.Group();
    glove(this.left, this.materials, -1, false);
    glove(right, this.materials, 1);
    this.leftSleeve = new THREE.Group();
    this.leftSleeve.matrixAutoUpdate = false;
    const sleeveBatch = new ModelBatch(this.leftSleeve);
    sleeve(sleeveBatch, this.materials, -1);
    sleeveBatch.finish();
    this.sleeveWrist = new V3();
    this.sleeveDirection = new V3();
    this.sleeveTranslation = new V3();
    this.sleeveRotation = new THREE.Quaternion();
    this.sleeveStretch = new THREE.Matrix4();
    this.magHand = new V3();
    this.root.add(this.left, this.leftSleeve, right);
    const flash = muzzleFlash();
    this.flash = flash.group;
    this.flashMaterial = flash.material;
    this.root.add(this.flash);
    this.events = [];
    this.reset();
  }

  get flashActive() {
    return this.flashTimer > 0;
  }

  get reloadProgress() {
    return this.reloadTime < 0 ? 1 : this.reloadTime / this.reloadDuration;
  }

  reset() {
    this.ads = 0;
    this.time = 0;
    this.step = 0;
    this.sprint = 0;
    this.recoil = this.recoilVelocity = 0;
    this.recoilSide = 0;
    this.swayX = this.swayY = 0;
    this.reloadTime = -1;
    this.inspectTime = -1;
    this.flashTimer = 0;
    this.landing = 0;
    this.previousGrounded = true;
    this.events.length = 0;
    this.update(0);
  }

  fire() {
    this.recoilVelocity = Math.min(5.3, this.recoilVelocity + 2.65 + this.random() * 0.8);
    this.recoilSide = (this.random() - 0.5) * 0.045;
    this.flashTimer = 0.043;
    this.flashMaterial.uniforms.pattern.value = this.random() * PI * 2;
    this.flash.rotation.z = this.random() * PI;
    this.flash.scale.setScalar(0.7 + this.random() * 0.6);
    this.inspectTime = -1;
  }

  reload(empty = false) {
    if (this.reloadTime >= 0) return;
    this.empty = empty;
    this.reloadDuration = empty ? 1.83 : 1.55;
    this.reloadTime = 0;
    this.inspectTime = -1;
  }

  inspect() {
    if (this.reloadTime < 0) this.inspectTime = 0;
  }

  muzzlePosition(out = new V3()) {
    return this.root.localToWorld(out.set(0, 0.001, MUZZLE_Z));
  }

  ejectPosition(out = new V3()) {
    return this.root.localToWorld(out.set(0.046, 0.01, -0.003));
  }

  update(dt, state = {}) {
    const {
      ads = false, sprint = false, crouch = false, grounded = true, speed = 0, strafe = 0,
      mouseX = 0, mouseY = 0, blocked = 0, active = true, brightness = 1,
    } = state;
    dt = clamp(dt || 0, 0, 0.1);
    this.root.visible = active;
    if (!active) return;

    this.time += dt;
    const reloadBefore = this.reloadProgress;
    if (this.reloadTime >= 0) {
      this.reloadTime += dt;
      const progress = this.reloadProgress;
      if (reloadBefore < 0.16 && progress >= 0.16) this.events.push('release');
      if (reloadBefore < 0.64 && progress >= 0.64) this.events.push('mag');
      if (this.empty && reloadBefore < 0.85 && progress >= 0.85) this.events.push('bolt');
      if (this.reloadTime >= this.reloadDuration) this.reloadTime = -1;
    }
    if (this.inspectTime >= 0) {
      this.inspectTime += dt;
      if (this.inspectTime > 2.25 || ads || sprint) this.inspectTime = -1;
    }
    const aims = ads && !sprint && blocked < 0.54 && this.reloadTime < 0 && this.inspectTime < 0;
    this.ads = lerp(this.ads, aims ? 1 : 0, 1 - Math.exp(-dt * (aims ? 16 : 18)));
    this.sprint = lerp(this.sprint, sprint && this.reloadTime < 0 ? 1 : 0, 1 - Math.exp(-dt * 12));
    this.step += dt * clamp(speed * 1.72, 0, 12.4);
    this.swayX = lerp(this.swayX, clamp(mouseX, -80, 80) * 0.00066, 1 - Math.exp(-dt * 18));
    this.swayY = lerp(this.swayY, clamp(mouseY, -80, 80) * 0.00054, 1 - Math.exp(-dt * 18));
    if (grounded && !this.previousGrounded) this.landing = 0.038;
    this.previousGrounded = grounded;
    this.landing *= Math.exp(-dt * 11);
    const displacement = (this.recoilVelocity + 25 * this.recoil) * dt;
    const recoilDamping = Math.exp(-25 * dt);
    this.recoil = (this.recoil + displacement) * recoilDamping;
    this.recoilVelocity = (this.recoilVelocity - 25 * displacement) * recoilDamping;
    this.flashTimer = Math.max(0, this.flashTimer - dt);
    this.flash.visible = this.flashActive;
    this.flashMaterial.uniforms.intensity.value = Math.min(1, this.flashTimer * 48);
    this.sight.uniforms.brightness.value = clamp(brightness, 0.52, 1.5);
    this.bolt.position.z = Math.max(0, this.flashTimer - 0.012) * 0.72;

    const reload = this.reloadTime >= 0 ? this.reloadProgress : 0;
    const drop = smooth(reload, 0, 0.22) * (1 - smooth(reload, 0.66, 1));
    const magTap = Math.sin(PI * smooth(reload, 0.58, 0.72));
    const boltSnap = this.empty ? Math.sin(PI * smooth(reload, 0.80, 0.92)) : 0;
    const examine = this.inspectTime >= 0
      ? smooth(this.inspectTime, 0, 0.45) * (1 - smooth(this.inspectTime, 1.48, 2.25))
      : 0;
    const motion = clamp(speed * 0.20, 0, 1) * (1 - this.ads * 0.90) * (grounded ? 1 : 0.22);
    const breath = (Math.sin(this.time * 2.2) + 0.24 * Math.sin(this.time * 4.4 + 0.7)) * lerp(0.0044, 0.00055, this.ads);
    const idleX = Math.cos(this.time * 1.1) * lerp(0.0018, 0.00018, this.ads);
    const lateral = Math.sin(this.step) * motion;
    const vertical = (Math.cos(this.step * 2) - 0.3) * motion;
    const strideRoll = Math.cos(this.step) * motion;
    const sway = lerp(1, 0.08, this.ads);
    const sprintWave = Math.sin(this.step) * this.sprint;

    this.root.position.set(
      lerp(0.205, 0, this.ads) + idleX + lateral * 0.012 + this.swayX * sway
        + this.sprint * 0.047 - examine * 0.15 - drop * 0.16 + boltSnap * 0.012,
      lerp(-0.164, -SIGHT_HEIGHT, this.ads) + breath + vertical * 0.0082 + this.swayY * sway
        - this.sprint * 0.09 - blocked * 0.078 + drop * 0.098 + magTap * 0.016 - this.landing + examine * 0.057,
      lerp(-0.333, -0.275, this.ads) + this.recoil * 1.38 + blocked * 0.135
        + vertical * 0.007 + (crouch ? 0.018 : 0) - drop * 0.207 - boltSnap * 0.018 - examine * 0.12,
    );
    this.root.rotation.set(
      this.recoil * 0.85 + vertical * 0.022 - this.swayY * sway + blocked * 0.27
        + this.sprint * 0.43 - drop * 0.17 + magTap * 0.055 - boltSnap * 0.045 + examine * 0.07,
      lerp(0.105, 0, this.ads) + this.swayX * sway + this.recoil * this.recoilSide * 12
        - this.sprint * 0.36 + drop * 0.68 - examine * 0.73,
      lerp(-0.067, 0, this.ads) - lateral * 0.028 - strideRoll * 0.012 + this.recoil * this.recoilSide * 10
        + clamp(strafe, -1, 1) * 0.027 * sway + this.sprint * 0.25 + sprintWave * 0.12
        - drop * 0.32 + boltSnap * 0.08 + examine * 0.43,
    );

    const pull = smooth(reload, 0.12, 0.32);
    const replace = smooth(reload, 0.46, 0.66);
    const magLower = reload < 0.43 ? pull : 1 - replace;
    this.mag.group.position.set(
      MAG_HOME.x - magLower * 0.049,
      MAG_HOME.y - magLower * 0.232,
      MAG_HOME.z + magLower * 0.061,
    );
    this.mag.group.rotation.set(magLower * 0.36, -magLower * 0.15, -magLower * 0.45);
    this.mag.group.visible = reload < 0.32 || reload > 0.45;
    this.mag.rounds.visible = reload > 0.45 && reload < 0.66;
    const handMove = smooth(reload, 0, 0.13) * (1 - smooth(reload, 0.68, 1));
    const charge = this.empty
      ? smooth(reload, 0.73, 0.84) * (1 - smooth(reload, 0.88, 0.99))
      : 0;
    this.left.rotation.set(-handMove * 0.39 - charge * 0.14, charge * 0.11, -handMove * 0.32 + charge * 0.28);
    this.magHand.copy(MAG_GRIP).applyEuler(this.mag.group.rotation).add(this.mag.group.position);
    this.sleeveTranslation.set(-0.042, -0.063, -0.239).applyEuler(this.left.rotation);
    this.left.position.subVectors(this.magHand, this.sleeveTranslation).multiplyScalar(handMove);
    this.left.position.x -= charge * 0.016;
    this.left.position.y += charge * 0.087;
    this.left.position.z += charge * 0.34;
    this.fitSleeve();
    this.bolt.position.z += charge * 0.043;
  }

  fitSleeve() {
    this.sleeveWrist.copy(WRIST_HOME).applyEuler(this.left.rotation).add(this.left.position);
    this.sleeveDirection.copy(ELBOW_HOME).addScaledVector(this.left.position, 0.27).sub(this.sleeveWrist);
    const stretch = this.sleeveDirection.length() / SLEEVE_LENGTH - 1;
    this.sleeveRotation.setFromUnitVectors(SLEEVE_AXIS, this.sleeveDirection.normalize());
    const { x, y, z } = SLEEVE_AXIS;
    this.sleeveStretch.set(
      1 + stretch * x * x, stretch * x * y, stretch * x * z, 0,
      stretch * y * x, 1 + stretch * y * y, stretch * y * z, 0,
      stretch * z * x, stretch * z * y, 1 + stretch * z * z, 0,
      0, 0, 0, 1,
    );
    const matrix = this.leftSleeve.matrix;
    matrix.makeRotationFromQuaternion(this.sleeveRotation).multiply(this.sleeveStretch);
    this.sleeveTranslation.copy(WRIST_HOME).applyMatrix4(matrix).negate().add(this.sleeveWrist);
    matrix.setPosition(this.sleeveTranslation);
    this.leftSleeve.matrixWorldNeedsUpdate = true;
  }

  dispose() {
    const geometry = new Set();
    const materials = new Set();
    this.root.traverse(node => {
      if (node.geometry) geometry.add(node.geometry);
      if (node.material) materials.add(node.material);
    });
    for (const part of geometry) part.dispose();
    for (const material of materials) material.dispose();
    this.texture.dispose();
    this.nameplate?.dispose();
    this.root.removeFromParent();
  }
}
