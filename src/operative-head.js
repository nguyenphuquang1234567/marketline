import {
  BufferAttribute, BufferGeometry, CatmullRomCurve3, Color, MathUtils, Vector3,
} from 'three';

const TAU = Math.PI * 2;
const SKIN = ['#977258', '#b08665', '#795641', '#a3785f', '#684938', '#ae8268', '#8c614b'];
const SKULL = [
  [-0.115, 0.002, 0.020, 0.019],
  [-0.107, 0.025, 0.058, 0.032],
  [-0.095, 0.041, 0.069, 0.045],
  [-0.080, 0.053, 0.072, 0.056],
  [-0.061, 0.063, 0.072, 0.069],
  [-0.042, 0.069, 0.075, 0.080],
  [-0.021, 0.074, 0.078, 0.085],
  [0.001, 0.076, 0.081, 0.089],
  [0.021, 0.076, 0.083, 0.091],
  [0.042, 0.075, 0.085, 0.091],
  [0.063, 0.071, 0.082, 0.085],
  [0.085, 0.058, 0.070, 0.073],
  [0.102, 0.032, 0.041, 0.049],
  [0.112, 0.001, 0.005, 0.009],
];

function bell(value, center, width) {
  const normalized = (value - center) / width;
  return Math.exp(-normalized * normalized);
}

function crossSection(y, head) {
  let index = 1;
  while (index < SKULL.length - 1 && y > SKULL[index][0]) index += 1;
  const a = SKULL[index - 1];
  const b = SKULL[index];
  const t = MathUtils.clamp((y - a[0]) / (b[0] - a[0]), 0, 1);
  const width = MathUtils.lerp(a[1], b[1], t) * head.width;
  const front = MathUtils.lerp(a[2], b[2], t) * head.depth;
  const back = MathUtils.lerp(a[3], b[3], t);
  return [width, front, back];
}

function relief(x, y, head) {
  const lateral = Math.abs(x);
  const offsetX = x - head.noseBias;
  const brow = 0.0045 * bell(lateral, 0.033, 0.027) * bell(y, 0.036, 0.008);
  const socket = -0.010 * bell(lateral, 0.0305, 0.019) * bell(y, 0.016, 0.013);
  const cheek = 0.008 * bell(lateral, 0.049, 0.019) * bell(y, -0.012, 0.020);
  const noseBridge = 0.014 * bell(offsetX, 0, 0.0125) * bell(y, -0.005, 0.030);
  const noseTip = head.nose * bell(offsetX, 0, 0.0115) * bell(y, -0.026, 0.011);
  const noseWings = 0.009 * bell(Math.abs(offsetX), 0.012, 0.0065) * bell(y, -0.033, 0.0065);
  const muzzle = 0.0085 * bell(x, 0, 0.026) * bell(y, -0.055, 0.017);
  const lips = 0.003 * bell(x, 0, 0.022) * bell(y, -0.060, 0.006);
  const chin = 0.006 * bell(x, 0, 0.026) * bell(y, -0.091, 0.010);
  return brow + socket + cheek + noseBridge + noseTip + noseWings + muzzle + lips + chin;
}

function frontZ(x, y, head) {
  const [width, front] = crossSection(y, head);
  const side = MathUtils.clamp(x / Math.max(width, 0.001), -1, 1);
  return -front * Math.sqrt(Math.max(0, 1 - side * side)) - relief(x, y, head);
}

function surface(rows, segments, sample, flip = false) {
  const positions = [];
  const colors = [];
  const uvs = [];
  const indices = [];
  const p = new Vector3();
  const tint = new Color();
  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column < segments; column += 1) {
      sample(row / rows, column / segments * TAU, p, tint);
      positions.push(p.x, p.y, p.z);
      colors.push(tint.r, tint.g, tint.b);
      uvs.push(column / segments, row / rows);
      if (row === rows) continue;
      const a = row * segments + column;
      const b = row * segments + (column + 1) % segments;
      const c = a + segments;
      const d = b + segments;
      if (flip) indices.push(a, b, c, b, d, c);
      else indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function skullMesh(parts, head, detail) {
  const skin = new Color(head.skin);
  const shadow = new Color('#5d4036');
  const beard = new Color('#4d4239');
  const cheek = new Color('#bc755d');
  const geometry = surface(detail ? 44 : 23, detail ? 42 : 24, (v, ring, point, tint) => {
    const frontRelative = ring <= Math.PI ? ring : ring - TAU;
    // More of each ring is sampled around the nose and eye sockets.
    const angle = Math.sign(frontRelative) * Math.PI * (Math.abs(frontRelative) / Math.PI) ** 1.32;
    const y = -0.115 + v * 0.227;
    const [width, front, back] = crossSection(y, head);
    const forward = Math.cos(angle);
    const x = Math.sin(angle) * width;
    const z = forward >= 0 ? -forward * front - relief(x, y, head) : -forward * back;
    point.set(x, y, z);
    const freckles = Math.cos(x * 441 + y * 518 + head.index) * Math.sin(y * 281 - x * 227) * 0.023;
    tint.copy(skin).multiplyScalar(1 + freckles);
    const lowerJaw = MathUtils.smoothstep(y, -0.112, -0.075) * (1 - MathUtils.smoothstep(y, -0.075, -0.045));
    const eyeSocket = bell(Math.abs(x), 0.032, 0.018) * bell(y, 0.019, 0.013) * Math.max(0, forward);
    const nostrils = bell(Math.abs(x - head.noseBias), 0.012, 0.0048) * bell(y, -0.037, 0.005);
    const cheekTone = bell(Math.abs(x), 0.051, 0.014) * bell(y, -0.015, 0.024);
    tint.lerp(cheek, cheekTone * Math.max(0, forward) * 0.19);
    tint.lerp(shadow, eyeSocket * 0.27 + nostrils * Math.max(0, forward) * 0.41);
    tint.lerp(beard, head.stubble * lowerJaw * Math.max(0, forward));
  });
  parts.geometry(geometry, null);
}

function facePatch(head, {
  x, y, width, height, offset, depth = 0, slope = 0, corners = 1.4, rows = 4, segments = 24, paint,
}) {
  return surface(rows, segments, (r, angle, point, color) => {
    const radial = Math.max(0.0001, r);
    const u = Math.cos(angle) * radial;
    const s = Math.sin(angle);
    const v = Math.sign(s) * Math.abs(s) ** corners * radial;
    const px = x + u * width;
    const py = y + v * height + u * slope;
    point.set(px, py, frontZ(px, py, head) - offset - depth * Math.sqrt(1 - r * r));
    paint(u, v, r, color);
  }, true);
}

function eyes(parts, head, detail, hasGlasses) {
  const sclera = new Color('#ab9d8c');
  const eyelid = new Color(head.skin).lerp(new Color('#574034'), 0.34);
  const browColor = new Color(head.skin).lerp(new Color('#342b23'), 0.69);
  const iris = new Color(['#64493a', '#4b655e', '#4c3428'][head.index % 3]);
  const pupil = new Color('#1b1715');
  const rim = new Color('#222a29');
  const lens = new Color(['#495f5b', '#5c5541', '#455758'][head.index % 3]);
  const reflection = new Color('#8fa7a6');

  for (const side of [-1, 1]) {
    const x = side * (0.0305 + 0.0015 * (head.index % 2));
    const y = 0.0175 + side * head.eyeBias;
    if (hasGlasses) {
      const shape = { x: side * 0.033, y: y + 0.002, width: 0.0255, height: 0.0135, slope: side * 0.0018, corners: 0.55 };
      parts.geometry(facePatch(head, {
        ...shape, offset: 0.0075, depth: 0.006, rows: detail ? 4 : 3, segments: detail ? 18 : 12,
        paint(u, v, r, color) {
          color.copy(lens).lerp(reflection, Math.max(0, 0.58 - Math.abs(v - 0.5) - Math.abs(u + 0.27) * 0.38));
          color.lerp(rim, MathUtils.smoothstep(r, 0.74, 1));
        },
      }), null);
      continue;
    }

    parts.geometry(facePatch(head, {
      x, y, width: 0.0133, height: 0.0043, offset: detail ? 0.0014 : 0.0025, depth: 0.0024, slope: side * 0.00085,
      rows: detail ? 6 : 4, segments: detail ? 22 : 14,
      paint(u, v, r, color) {
        const radius = Math.hypot(u - 0.012 * (head.index % 3 - 1), v * 0.37);
        const glint = bell(u, -0.11, 0.065) * bell(v, 0.43, 0.16);
        color.copy(sclera).lerp(iris, 1 - MathUtils.smoothstep(radius, 0.22, 0.34));
        color.lerp(pupil, 1 - MathUtils.smoothstep(radius, 0.105, 0.17));
        color.lerp(sclera, glint * 0.64);
        color.lerp(eyelid, MathUtils.smoothstep(r, 0.63, 1));
      },
    }), null);

    parts.geometry(facePatch(head, {
      x: x + side * 0.0013, y: y + 0.0156, width: 0.016, height: 0.0028,
      offset: 0.0009, depth: 0.0007, slope: -side * 0.0029, rows: 3, segments: detail ? 18 : 12,
      paint(u, v, r, color) {
        color.copy(browColor).lerp(eyelid, MathUtils.smoothstep(r, 0.48, 1));
      },
    }), null);
  }
  if (hasGlasses) parts.box(0.024, 0.007, 0.009, 0, 0.020, -0.088 * head.depth, '#2d3029', 0.003);
}

function lips(parts, head, detail) {
  const outer = new Color(head.skin);
  const upper = outer.clone().lerp(new Color('#613d37'), 0.42);
  const lower = outer.clone().lerp(new Color('#af675f'), 0.35);
  const seam = outer.clone().lerp(new Color('#412e2a'), 0.63);
  parts.geometry(facePatch(head, {
    x: head.noseBias * 0.62, y: -0.0605, width: 0.022 + head.index % 3 * 0.0007,
    height: 0.0051, offset: 0.0012, depth: 0.0012, slope: -0.0007, rows: detail ? 6 : 4, segments: detail ? 22 : 14,
    paint(u, v, r, color) {
      const cupid = 0.045 - Math.cos(u * 11) * 0.105;
      color.copy(v < cupid ? lower : upper);
      color.lerp(seam, bell(v, cupid, 0.26));
      color.lerp(outer, MathUtils.smoothstep(r, 0.63, 1));
    },
  }), null);
}

function ear(parts, head, side, detail) {
  const flesh = new Color(head.skin);
  const inner = flesh.clone().lerp(new Color('#633b36'), 0.62);
  const rim = flesh.clone().lerp(new Color('#bf7866'), 0.28);
  parts.geometry(surface(detail ? 5 : 3, detail ? 20 : 12, (r, angle, point, color) => {
    const roll = Math.sin(angle);
    const edge = Math.cos(angle);
    const helix = 0.013 * bell(r, 0.70, 0.25);
    const fold = 0.006 * bell(r, 0.43, 0.18) * (0.5 + 0.5 * roll);
    point.set(
      side * (0.072 * head.width + helix + fold - roll * 0.005 * r),
      -0.014 + roll * 0.025 * r,
      0.017 + (edge * 0.015 + roll * 0.004) * r,
    );
    color.copy(flesh).lerp(inner, bell(r, 0.26, 0.31) * (0.63 + edge * 0.23));
    color.lerp(rim, bell(r, 0.73, 0.20) * (0.52 + roll * 0.27));
  }, side > 0), null);
}

function helmetRim(angle, highCut) {
  const forward = Math.cos(angle);
  const side = Math.sin(angle);
  return 0.010 + 0.017 * forward + (highCut ? 0.021 : 0.010) * side ** 4;
}

function helmet(parts, head, colors, detail) {
  const highCut = head.index % 3 !== 1;
  const shell = new Color(colors.gear);
  const accent = new Color(colors.insignia);
  const edge = new Color(colors.edging);
  const crownHeight = 0.132 + (head.index % 3) * 0.002;
  const width = 0.105 + (head.width - 1) * 0.038;
  const depth = 0.111 + (head.depth - 1) * 0.045;
  const shellMesh = surface(detail ? 13 : 8, detail ? 34 : 20, (t, angle, point, tint) => {
    const rimY = helmetRim(angle, highCut);
    const cap = Math.sqrt(Math.max(0.000004, 1 - t ** 2));
    const forward = Math.cos(angle);
    point.set(Math.sin(angle) * width * cap, rimY + (crownHeight - rimY) * t, 0.011 - forward * depth * cap);
    const tape = MathUtils.smoothstep(t, 0.045, 0.17) * (1 - MathUtils.smoothstep(t, 0.42, 0.58));
    const fiber = Math.sin(angle * 11 + t * 61) * Math.cos(angle * 24 - t * 38);
    const seam = Math.max(0, 1 - Math.abs(Math.sin(angle * 2 + 0.53)) * 9);
    tint.copy(shell).multiplyScalar(1 + 0.105 * fiber - seam * 0.13);
    tint.lerp(accent, tape * (0.58 + 0.12 * Math.abs(forward)));
  });
  parts.geometry(shellMesh, null);
  parts.geometry(surface(2, detail ? 34 : 20, (t, angle, point, tint) => {
    const rimY = helmetRim(angle, highCut);
    const bevel = Math.sin(t * Math.PI) * 0.0012;
    point.set(Math.sin(angle) * (width + bevel + 0.0004), rimY - 0.005 + t * 0.009, 0.011 - Math.cos(angle) * (depth + bevel));
    tint.copy(edge).multiplyScalar(0.86 + 0.21 * t);
  }), null);

  if (head.index % 3 !== 2) {
    parts.box(0.035, 0.025, 0.012, 0, 0.071, -0.088, colors.vest, 0.004);
    if (detail) parts.box(0.019, 0.007, 0.005, 0, 0.072, -0.094, colors.boot, 0.002);
  }
}

function strap(points, width, thickness, normal, color, detail) {
  const curve = new CatmullRomCurve3(points);
  const center = new Vector3();
  const tangent = new Vector3();
  const across = new Vector3();
  const outward = new Vector3();
  const cloth = new Color(color);
  return surface(detail ? 10 : 5, detail ? 7 : 5, (t, angle, point, tint) => {
    curve.getPoint(t, center);
    curve.getTangent(t, tangent);
    across.crossVectors(normal, tangent).normalize();
    outward.crossVectors(tangent, across).normalize();
    point.copy(center).addScaledVector(across, Math.sin(angle) * width)
      .addScaledVector(outward, Math.cos(angle) * thickness);
    tint.copy(cloth).multiplyScalar(0.92 + Math.cos(t * 53) * 0.065);
  });
}

function webbing(parts, head, colors, detail, hasGlasses) {
  const chinAnchor = (x, y) => new Vector3(x, y, frontZ(x, y, head) - 0.0025);
  for (const side of [-1, 1]) {
    const normal = new Vector3(side, 0, -0.16);
    const temple = new Vector3(side * 0.100, 0.030, 0.009);
    const cheek = new Vector3(side * 0.069, -0.042, -0.022);
    const jaw = new Vector3(side * 0.048, -0.083, -0.037);
    const chin = chinAnchor(side * 0.026, -0.101);
    parts.geometry(strap([temple, cheek, jaw, chin], 0.0051, 0.0016, normal, colors.vest, detail), null);
    if (hasGlasses) {
      parts.geometry(strap([
        new Vector3(side * 0.053, 0.020, -0.059),
        new Vector3(side * 0.080, 0.023, -0.034),
        new Vector3(side * 0.100, 0.033, 0.006),
      ], 0.0037, 0.0017, normal, colors.boot, detail), null);
    }
    if (side === (head.index % 2 ? 1 : -1)) {
      parts.round(0.025, 0.043, 0.038, side * 0.088, -0.008, 0.023, colors.vest);
      parts.round(0.015, 0.032, 0.029, side * 0.099, -0.009, 0.023, colors.boot);
      if (detail) parts.round(0.012, 0.012, 0.013, side * 0.069, -0.065, -0.024, '#84755c');
    }
  }
  parts.geometry(strap([
    chinAnchor(-0.027, -0.101),
    chinAnchor(0, -0.110),
    chinAnchor(0.027, -0.101),
  ], 0.0049, 0.0015, new Vector3(0, -0.64, -0.76), colors.vest, detail), null);
}

export function buildHead(parts, { detail, index, vest, gear, boot, insignia, edging }) {
  const head = {
    index,
    skin: SKIN[index % SKIN.length],
    width: [1.0, 0.955, 1.055, 1.0, 0.97, 1.02, 0.99][index % SKIN.length],
    depth: [1.0, 0.98, 0.96, 1.055, 1.015, 0.985, 1.035][index % SKIN.length],
    nose: 0.018 + (index % 4) * 0.0015,
    noseBias: (index % 3 - 1) * 0.002,
    eyeBias: (index % 4 - 1.5) * 0.0007,
    stubble: [0.08, 0.31, 0.0, 0.44, 0.22, 0.07, 0.36][index % SKIN.length],
  };
  const colors = { vest, gear, boot, insignia, edging };
  const hasGlasses = index % 3 === 1;
  skullMesh(parts, head, detail);
  parts.garment([
    [-.177, .037, .041, .023], [-.149, .042, .046, .024],
    [-.112, .039, .043, .025], [-.084, .044, .04, .027],
  ], head.skin, index + .7);
  for (const side of [-1, 1]) ear(parts, head, side, detail);
  eyes(parts, head, detail, hasGlasses);
  lips(parts, head, detail);
  helmet(parts, head, colors, detail);
  webbing(parts, head, colors, detail, hasGlasses);
}
