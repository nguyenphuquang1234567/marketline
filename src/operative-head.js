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

function relief(x, y, head, masked) {
  const lateral = Math.abs(x);
  const offsetX = x - head.noseBias;
  const brow = 0.0062 * bell(lateral, 0.031, 0.026) * bell(y, 0.035, 0.0085);
  const glabella = 0.0035 * bell(x, 0, 0.012) * bell(y, 0.032, 0.008);
  const socket = -0.0115 * bell(lateral, 0.0305, 0.0185) * bell(y, 0.016, 0.013);
  const cheek = 0.0095 * bell(lateral, 0.048, 0.019) * bell(y, -0.011, 0.020);
  const noseBridge = 0.0155 * bell(offsetX, 0, 0.012) * bell(y, -0.004, 0.029);
  const noseTip = head.nose * bell(offsetX, 0, 0.0115) * bell(y, -0.026, 0.0115);
  const noseWings = 0.0095 * bell(Math.abs(offsetX), 0.012, 0.0065) * bell(y, -0.033, 0.0065);
  const muzzle = 0.009 * bell(x, 0, 0.027) * bell(y, -0.055, 0.018);
  const lips = 0.0035 * bell(x, 0, 0.022) * bell(y, -0.060, 0.006);
  const chin = 0.0075 * bell(x, 0, 0.027) * bell(y, -0.091, 0.011);
  const jawAngle = 0.0055 * bell(lateral, 0.046, 0.014) * bell(y, -0.068, 0.018);
  let cloth = 0;
  if (masked) {
    const maskLine = -0.007 + 0.010 * bell(offsetX, 0, 0.020) - 0.016 * (lateral / 0.075) ** 1.4;
    const onMask = MathUtils.smoothstep(maskLine - y, -0.005, 0.006);
    const fold = 0.0022 * Math.sin(y * 190 + Math.abs(x) * 65);
    const seam = 0.0018 * bell(y, maskLine, 0.0035);
    cloth = onMask * (0.0032 + fold) + seam;
  }
  return brow + glabella + socket + cheek + noseBridge + noseTip + noseWings + muzzle + lips + chin + jawAngle + cloth;
}

function frontZ(x, y, head) {
  const [width, front] = crossSection(y, head);
  const side = MathUtils.clamp(x / Math.max(width, 0.001), -1, 1);
  return -front * Math.sqrt(Math.max(0, 1 - side * side)) - relief(x, y, head, head.masked);
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

function skullMesh(parts, head, colors, detail) {
  const skin = new Color(head.skin);
  const shadow = new Color('#4d332a');
  const beard = new Color('#362e27');
  const cheek = new Color('#b86f58');
  const maskFabric = new Color(colors.vest).lerp(new Color(colors.boot), 0.42);
  const maskTrim = new Color(colors.boot).multiplyScalar(0.88);
  const hoodFabric = maskFabric.clone().multiplyScalar(0.86);
  const geometry = surface(detail ? 46 : 24, detail ? 44 : 24, (v, ring, point, tint) => {
    const frontRelative = ring <= Math.PI ? ring : ring - TAU;
    // More of each ring is sampled around the nose and eye sockets.
    const angle = Math.sign(frontRelative) * Math.PI * (Math.abs(frontRelative) / Math.PI) ** 1.32;
    const y = -0.115 + v * 0.227;
    const [width, front, back] = crossSection(y, head);
    const forward = Math.cos(angle);
    const x = Math.sin(angle) * width;
    const z = forward >= 0 ? -forward * front - relief(x, y, head, head.masked) : -forward * back;
    point.set(x, y, z);
    const freckles = Math.cos(x * 441 + y * 518 + head.index) * Math.sin(y * 281 - x * 227) * 0.023;
    tint.copy(skin).multiplyScalar(1 + freckles);
    const lowerJaw = MathUtils.smoothstep(y, -0.112, -0.072) * (1 - MathUtils.smoothstep(y, -0.068, -0.032));
    const mustache = bell(x, 0, 0.024) * bell(y, -0.048, 0.008) * Math.max(0, forward);
    const eyeSocket = bell(Math.abs(x), 0.032, 0.018) * bell(y, 0.019, 0.013) * Math.max(0, forward);
    const nostrils = bell(Math.abs(x - head.noseBias), 0.012, 0.0048) * bell(y, -0.037, 0.005);
    const cheekTone = bell(Math.abs(x), 0.051, 0.014) * bell(y, -0.015, 0.024);
    tint.lerp(cheek, cheekTone * Math.max(0, forward) * 0.19);
    tint.lerp(shadow, eyeSocket * 0.36 + nostrils * Math.max(0, forward) * 0.45);
    tint.lerp(beard, head.stubble * Math.min(1, lowerJaw + mustache * 0.85) * Math.max(0, forward));

    if (head.masked) {
      const lateral = Math.abs(x);
      const maskLine = -0.007 + 0.010 * bell(x - head.noseBias, 0, 0.020) - 0.016 * (lateral / 0.075) ** 1.4;
      const lowerMask = MathUtils.smoothstep(maskLine - y, -0.004, 0.004);
      const eyeOpening = MathUtils.smoothstep(forward, 0.38, 0.56)
        * MathUtils.smoothstep(y, maskLine - 0.003, maskLine + 0.004)
        * (1 - MathUtils.smoothstep(y, 0.038, 0.048));
      const balaclavaWeight = Math.max(lowerMask, 1 - eyeOpening);
      const weave = 1 + 0.045 * Math.sin(y * 210 + angle * 7) - 0.06 * bell(x, 0, 0.0035);
      const vent = bell(x, 0, 0.022) * bell(y, -0.048, 0.020) * (0.5 + 0.5 * Math.sin(x * 620) * Math.cos(y * 620));
      const edgeBand = bell(y, maskLine, 0.0032) * Math.max(0, forward);
      const clothColor = maskFabric.clone().multiplyScalar(weave).lerp(maskTrim, vent * 0.38 + edgeBand * 0.75);
      tint.lerp(clothColor, balaclavaWeight);
    } else {
      const napeHood = 1 - MathUtils.smoothstep(forward, -0.15, 0.22);
      tint.lerp(hoodFabric, napeHood * 0.88);
    }
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

function eyes(parts, head, colors, detail, hasGlasses) {
  const sclera = new Color('#b4a796');
  const eyelid = new Color(head.skin).lerp(new Color('#4a3429'), 0.42);
  const browColor = new Color(head.skin).lerp(new Color('#2b231c'), 0.76);
  const iris = new Color(['#5b4132', '#445e57', '#463024'][head.index % 3]);
  const pupil = new Color('#14110f');
  const rim = new Color('#1d2221');
  const lens = new Color(['#253433', '#383124', '#233034'][head.index % 3]);
  const reflection = new Color('#96b2b0');

  if (hasGlasses) {
    // Rigid wraparound polycarbonate ballistic lenses positioned in front of the brow and nose bridge.
    for (const side of [-1, 1]) {
      const lx = side * 0.031 * head.width;
      const lensPatch = surface(detail ? 6 : 4, detail ? 24 : 14, (r, angle, point, color) => {
        const radial = Math.max(0.0001, r);
        const u = Math.cos(angle) * radial;
        const s = Math.sin(angle);
        const v = Math.sign(s) * Math.abs(s) ** 0.72 * radial;
        const px = lx + u * 0.031 * head.width;
        const py = 0.0175 + v * 0.014 - u * side * 0.0022;
        const span = px / (0.064 * head.width);
        const pz = (-0.098 + 0.024 * span * span) * head.depth - 0.004 * Math.sqrt(1 - r * r);
        point.set(px, py, pz);
        const glare = Math.max(0, 0.78 - Math.abs(v - 0.24) * 1.35 - Math.abs(u + side * 0.18) * 1.1);
        const frame = MathUtils.smoothstep(r, 0.74, 0.98);
        color.copy(lens).lerp(reflection, glare * 0.58);
        color.lerp(rim, frame * 0.95);
      }, true);
      parts.geometry(lensPatch, null);
    }
    const browZ = -0.096 * head.depth;
    parts.box(0.118 * head.width, 0.0055, 0.012, 0, 0.030, browZ, '#1b1f1e', 0.002);
    parts.box(0.016, 0.009, 0.010, 0, 0.019, browZ - 0.003, '#1b1f1e', 0.002);
    return;
  }

  for (const side of [-1, 1]) {
    const x = side * (0.0305 + 0.0015 * (head.index % 2));
    const y = 0.0175 + side * head.eyeBias;
    parts.geometry(facePatch(head, {
      x, y, width: 0.0138, height: 0.0046, offset: detail ? 0.0014 : 0.0025, depth: 0.0025, slope: side * 0.00085,
      rows: detail ? 6 : 4, segments: detail ? 22 : 14,
      paint(u, v, r, color) {
        const radius = Math.hypot(u - 0.012 * (head.index % 3 - 1), v * 0.37);
        const glint = bell(u, -0.11, 0.065) * bell(v, 0.43, 0.16);
        color.copy(sclera).lerp(iris, 1 - MathUtils.smoothstep(radius, 0.22, 0.34));
        color.lerp(pupil, 1 - MathUtils.smoothstep(radius, 0.105, 0.17));
        color.lerp(sclera, glint * 0.68);
        color.lerp(eyelid, MathUtils.smoothstep(r, 0.60, 1));
      },
    }), null);

    parts.geometry(facePatch(head, {
      x: x + side * 0.0013, y: y + 0.0152, width: 0.017, height: 0.0032,
      offset: 0.0011, depth: 0.0009, slope: -side * 0.0031, rows: 3, segments: detail ? 18 : 12,
      paint(u, v, r, color) {
        color.copy(browColor).lerp(eyelid, MathUtils.smoothstep(r, 0.48, 1));
      },
    }), null);
  }
}

function lips(parts, head, detail) {
  if (head.masked) return;
  const outer = new Color(head.skin);
  const upper = outer.clone().lerp(new Color('#593630'), 0.46);
  const lower = outer.clone().lerp(new Color('#a56058'), 0.36);
  const seam = outer.clone().lerp(new Color('#382622'), 0.68);
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
  const browCut = 0.016 * Math.max(0, forward);
  const napeDrop = -0.036 * Math.max(0, -forward) ** 1.35;
  const earArch = (highCut ? 0.026 : 0.014) * side ** 4 * Math.max(0, 1 - Math.abs(forward - 0.05) * 1.4);
  return 0.004 + browCut + napeDrop + earArch;
}

function helmet(parts, head, colors, detail) {
  const highCut = head.index % 3 !== 1;
  const shell = new Color(colors.gear);
  const accent = new Color(colors.insignia);
  const edge = new Color(colors.edging);
  const velcro = new Color(colors.boot).lerp(shell, 0.32);
  const crownHeight = 0.132 + (head.index % 3) * 0.002;
  const width = 0.107 + (head.width - 1) * 0.038;
  const depth = 0.115 + (head.depth - 1) * 0.045;
  const shellMesh = surface(detail ? 15 : 8, detail ? 36 : 20, (t, angle, point, tint) => {
    const rimY = helmetRim(angle, highCut);
    const cap = Math.sqrt(Math.max(0.000004, 1 - t ** 2));
    const forward = Math.cos(angle);
    const side = Math.sin(angle);
    const railStep = Math.abs(side) > 0.68 && t > 0.08 && t < 0.36 ? 0.0028 : 0;
    point.set(
      side * (width * cap + railStep),
      rimY + (crownHeight - rimY) * t,
      0.012 - forward * depth * cap,
    );
    const tape = MathUtils.smoothstep(t, 0.04, 0.14) * (1 - MathUtils.smoothstep(t, 0.24, 0.34));
    const sideVelcro = Math.abs(side) > 0.58 && t > 0.22 && t < 0.62 && Math.abs(forward) < 0.55;
    const iffStripe = Math.abs(side) > 0.72 && t > 0.32 && t < 0.44 && Math.abs(forward - 0.06) < 0.18;
    const fiber = Math.sin(angle * 11 + t * 61) * Math.cos(angle * 24 - t * 38);
    const seam = Math.max(0, 1 - Math.abs(Math.sin(angle * 2 + 0.53)) * 9);
    tint.copy(shell).multiplyScalar(1 + 0.095 * fiber - seam * 0.12);
    if (sideVelcro) tint.lerp(velcro, 0.68);
    tint.lerp(velcro, tape * 0.48);
    if (iffStripe) tint.lerp(accent, 0.78);
  });
  parts.geometry(shellMesh, null);
  parts.geometry(surface(2, detail ? 36 : 20, (t, angle, point, tint) => {
    const rimY = helmetRim(angle, highCut);
    const bevel = Math.sin(t * Math.PI) * 0.0016;
    point.set(Math.sin(angle) * (width + bevel + 0.0008), rimY - 0.005 + t * 0.009, 0.012 - Math.cos(angle) * (depth + bevel));
    tint.copy(edge).multiplyScalar(0.78 + 0.22 * t);
  }), null);

  // Front Wilcox NVG shroud and mount bracket.
  parts.box(0.042, 0.032, 0.014, 0, 0.062, -0.097, colors.vest, 0.004);
  parts.box(0.026, 0.022, 0.012, 0, 0.062, -0.103, colors.boot, 0.003);
  if (detail) {
    parts.box(0.016, 0.010, 0.008, 0, 0.064, -0.108, '#585d56', 0.002);
  }

  // Rear counterweight / battery pack and IFF patch.
  parts.box(0.056, 0.036, 0.022, 0, 0.008, 0.114, colors.vest, 0.005);
  parts.box(0.042, 0.014, 0.006, 0, 0.012, 0.126, colors.insignia, 0.002);

  // Side ARC accessory rails and tactical helmet light.
  for (const side of [-1, 1]) {
    parts.box(0.010, 0.015, 0.068, side * (width - 0.004), 0.034, -0.012, colors.boot, 0.003);
    parts.box(0.007, 0.022, 0.032, side * (width - 0.003), 0.024, 0.024, colors.boot, 0.002);
    parts.box(0.004, 0.016, 0.038, side * (width - 0.005), 0.058, 0.006, colors.insignia, 0.001);
    if (detail && side === (head.index % 2 ? 1 : -1)) {
      parts.cylinder(0.0075, 0.0075, 0.044, side * (width + 0.004), 0.035, -0.026, '#272b2a', true);
      parts.cylinder(0.0085, 0.0085, 0.012, side * (width + 0.004), 0.035, -0.050, '#454b49', true);
    }
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
    const temple = new Vector3(side * 0.100, 0.030, -0.012);
    const nape = new Vector3(side * 0.088, 0.004, 0.054);
    const cheek = new Vector3(side * 0.072, -0.042, -0.020);
    const jaw = new Vector3(side * 0.049, -0.083, -0.036);
    const chin = chinAnchor(side * 0.026, -0.101);
    parts.geometry(strap([temple, cheek, jaw, chin], 0.0052, 0.0017, normal, colors.boot, detail), null);
    parts.geometry(strap([nape, cheek], 0.0046, 0.0015, normal, colors.boot, detail), null);
    if (hasGlasses) {
      parts.geometry(strap([
        new Vector3(side * 0.058, 0.022, -0.066),
        new Vector3(side * 0.082, 0.023, -0.032),
        new Vector3(side * 0.098, 0.026, 0.010),
      ], 0.0042, 0.0018, normal, '#1d211f', detail), null);
    }
    // Dual-ear Peltor ComTac tactical headset cups and wire yokes.
    parts.round(0.028, 0.048, 0.042, side * 0.088, -0.010, 0.016, colors.vest);
    parts.round(0.018, 0.036, 0.032, side * 0.099, -0.010, 0.016, colors.boot);
    parts.box(0.005, 0.038, 0.006, side * 0.098, 0.014, 0.016, '#484d49', 0.0015);
  }
  // Boom microphone curving from left headset cup to mouth.
  if (detail) {
    const micSide = head.index % 2 ? 1 : -1;
    parts.geometry(strap([
      new Vector3(micSide * 0.094, -0.022, 0.008),
      new Vector3(micSide * 0.078, -0.054, -0.036),
      new Vector3(micSide * 0.042, -0.068, -0.078),
      new Vector3(micSide * 0.012, -0.065, -0.095),
    ], 0.0022, 0.0022, new Vector3(0, 1, 0), '#232726', detail), null);
    parts.round(0.014, 0.011, 0.016, micSide * 0.010, -0.065, -0.096, '#1c1f1e');
  }
  parts.geometry(strap([
    chinAnchor(-0.027, -0.101),
    chinAnchor(0, -0.110),
    chinAnchor(0.027, -0.101),
  ], 0.0052, 0.0017, new Vector3(0, -0.64, -0.76), colors.boot, detail), null);
}

export function buildHead(parts, { detail, index, vest, gear, boot, insignia, edging }) {
  const head = {
    index,
    skin: SKIN[index % SKIN.length],
    width: [1.0, 0.965, 1.045, 1.0, 0.975, 1.02, 0.99][index % SKIN.length],
    depth: [1.0, 0.985, 0.97, 1.045, 1.015, 0.985, 1.03][index % SKIN.length],
    nose: 0.0185 + (index % 4) * 0.0015,
    noseBias: (index % 3 - 1) * 0.0018,
    eyeBias: (index % 4 - 1.5) * 0.0006,
    stubble: [0.24, 0.42, 0.15, 0.52, 0.35, 0.18, 0.46][index % SKIN.length],
    masked: index % 4 !== 1,
  };
  const colors = { vest, gear, boot, insignia, edging };
  const hasGlasses = index % 2 === 1;
  skullMesh(parts, head, colors, detail);
  // Tactical neck gaiter / balaclava wrap instead of bare neck cylinder.
  const gaiterColor = new Color(vest).lerp(new Color(boot), 0.38).getHex();
  parts.garment([
    [-.182, .054, .058, .016], [-.154, .052, .056, .018],
    [-.122, .049, .053, .020], [-.092, .051, .054, .019], [-.068, .054, .056, .016],
  ], gaiterColor, index + .7);
  for (const side of [-1, 1]) ear(parts, head, side, detail);
  eyes(parts, head, colors, detail, hasGlasses);
  lips(parts, head, detail);
  helmet(parts, head, colors, detail);
  webbing(parts, head, colors, detail, hasGlasses);
}
