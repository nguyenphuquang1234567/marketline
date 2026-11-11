import { BufferAttribute, BufferGeometry, CatmullRomCurve3, Color, TubeGeometry, Vector3 } from 'three';

const TAU = Math.PI * 2;
const ACROSS = new Vector3(1, 0, 0);
const VERTICAL = new Vector3(0, 1, 0);
const DOWN = new Vector3(0, -1, 0);

function tint(color, multiplier) {
  return new Color(color).multiplyScalar(multiplier).getHex();
}

function geometry(positions, uv, indices) {
  const shape = new BufferGeometry();
  shape.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  shape.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  shape.setIndex(indices);
  shape.computeVertexNormals();
  return shape;
}

// Rings describe the changing width and depth of a sewn bag, vest, or pouch.
function fabric(parts, profile, color, sections, squareness = 0.69, mottled = true) {
  const positions = [];
  const uv = [];
  const indices = [];
  const softCorner = value => Math.sign(value) * Math.abs(value) ** squareness;
  for (let ring = 0; ring < profile.length; ring++) {
    const [y, x, halfWidth, front, rear] = profile[ring];
    const centerZ = (rear + front) * 0.5;
    const depth = (rear - front) * 0.5;
    for (let s = 0; s < sections; s++) {
      const angle = TAU * s / sections;
      positions.push(
        x + halfWidth * softCorner(Math.cos(angle)),
        y,
        centerZ + depth * softCorner(Math.sin(angle)),
      );
      uv.push(s / sections, ring / (profile.length - 1));
      if (ring === profile.length - 1) continue;
      const first = ring * sections + s;
      const next = ring * sections + (s + 1) % sections;
      indices.push(first, first + sections, next, next, first + sections, next + sections);
    }
  }
  for (const ring of [0, profile.length - 1]) {
    const cap = positions.length / 3;
    const [y, x, , front, rear] = profile[ring];
    positions.push(x, y, (front + rear) * 0.5);
    uv.push(0.5, ring / (profile.length - 1));
    const first = ring * sections;
    for (let s = 0; s < sections; s++) {
      const here = first + s;
      const next = first + (s + 1) % sections;
      if (ring === 0) indices.push(cap, here, next);
      else indices.push(cap, next, here);
    }
  }
  parts.geometry(geometry(positions, uv, indices), color, 0, 0, 0, mottled);
}

// Continuous webbing follows the body from the face of the vest over its shoulders.
function webbing(parts, samples, width, color, across = ACROSS, mottled = false) {
  const points = samples.map(sample => new Vector3(...sample));
  const tangent = new Vector3();
  const lateral = new Vector3();
  const positions = [];
  const uv = [];
  const indices = [];
  for (let i = 0; i < points.length; i++) {
    const center = points[i];
    tangent.subVectors(points[Math.min(i + 1, points.length - 1)], points[Math.max(i - 1, 0)]).normalize();
    lateral.copy(across).addScaledVector(tangent, -across.dot(tangent)).normalize();
    const half = (Array.isArray(width) ? width[i] : width) * 0.5;
    for (const s of [-1, 1]) {
      positions.push(center.x + lateral.x * half * s, center.y + lateral.y * half * s, center.z + lateral.z * half * s);
      uv.push((s + 1) * 0.5, i / (points.length - 1));
    }
    const first = i * 2;
    if (i + 1 < points.length) indices.push(first, first + 2, first + 1, first + 1, first + 2, first + 3);
  }
  parts.geometry(geometry(positions, uv, indices), color, 0, 0, 0, mottled);
}

function tube(parts, points, size, color, detail) {
  const path = new CatmullRomCurve3(points.map(point => new Vector3(...point)));
  parts.geometry(new TubeGeometry(path, detail ? 9 : 4, size, detail ? 5 : 4, false), color);
}

function badge(parts, { x, y, z, direction, width, height, insignia, edging, detail }) {
  if (!detail) {
    const axis = direction > 0 ? VERTICAL : DOWN;
    webbing(parts, [[x - (width + 0.008) / 2, y, z], [x + (width + 0.008) / 2, y, z]], height + 0.008, edging, axis);
    const outer = z + direction * 0.0035;
    webbing(parts, [[x - width / 2, y, outer], [x + width / 2, y, outer]], height, insignia, axis);
    return;
  }
  const layer = (color, w, h, centerZ) => fabric(parts, [
    [y - h * 0.50, x, w * 0.40, centerZ - 0.0026, centerZ + 0.0026],
    [y - h * 0.41, x, w * 0.50, centerZ - 0.0028, centerZ + 0.0028],
    [y + h * 0.41, x, w * 0.50, centerZ - 0.0028, centerZ + 0.0028],
    [y + h * 0.50, x, w * 0.39, centerZ - 0.0026, centerZ + 0.0026],
  ], color, 8, 0.24, false);
  layer(edging, width + 0.008, height + 0.008, z);
  layer(insignia, width, height, z + direction * 0.0035);
  const dz = z + direction * 0.007;
  webbing(parts, [[x - width * 0.19, y - 0.007, dz], [x - width * 0.047, y + 0.011, dz],
    [x + width * 0.095, y - 0.007, dz]], 0.006, tint(insignia, 1.49), direction > 0 ? VERTICAL : DOWN);
}

function pocket(parts, x, y, z, width, height, depth, color, flap, detail, rear = false) {
  const side = rear ? 1 : -1;
  const shell = (u, v, d0, d1) => [y + height * u, x, width * v, z + Math.min(d0 * side, d1 * side), z + Math.max(d0 * side, d1 * side)];
  fabric(parts, [
    shell(-0.5, 0.37, -0.012, depth * 0.74), shell(-0.37, 0.46, -0.014, depth * 0.94),
    shell(0.21, 0.50, -0.013, depth), shell(0.5, 0.43, -0.009, depth * 0.78),
  ], color, detail ? 12 : 8, 0.58);
  if (detail) {
    fabric(parts, [
      shell(0.23, 0.44, depth * 0.65, depth * 0.98), shell(0.35, 0.51, -0.006, depth * 1.035),
      shell(0.50, 0.48, -0.01, depth * 0.91),
    ], flap, 12, 0.53);
    const outer = z + side * (depth + 0.001);
    const bottom = [x, y - height * 0.14, outer];
    const top = [x, y + height * 0.33, outer];
    webbing(parts, rear ? [top, bottom] : [bottom, top], 0.012, tint(color, 0.71));
  }
}

export function addKit(parts, { detail, index, team, cloth, vest, gear, boot, insignia, edging }) {
  const sections = detail ? 16 : 8;
  const equipmentSide = index % 2 ? -1 : 1;
  const carrierTint = tint(vest, 1.12);
  const lining = tint(gear, 0.86);
  const web = tint(boot, 1.28);
  const binding = tint(vest, 0.74);
  const wear = tint(gear, 1.31);
  const darkMetal = '#262a28';
  const packDepthOffset = 0.006 * (index % 3);
  const pocketColor = index % 3 === 1 ? carrierTint : gear;

  // Padded tactical battle belt and inner riggers belt with Cobra buckle and hip pouches.
  fabric(parts, [
    [0.028, 0, 0.158, -0.116, 0.115], [0.044, 0, 0.172, -0.125, 0.123],
    [0.086, 0, 0.173, -0.126, 0.123], [0.102, 0, 0.160, -0.116, 0.116],
  ], binding, sections, 0.84, true);
  fabric(parts, [
    [0.048, 0, 0.175, -0.128, 0.125], [0.056, 0, 0.178, -0.130, 0.127],
    [0.076, 0, 0.178, -0.130, 0.127], [0.084, 0, 0.175, -0.128, 0.125],
  ], boot, sections, 0.85, false);

  // Cobra belt buckle and belt-mounted pistol mag / IFAK / dump pouches.
  parts.box(0.054, 0.038, 0.016, 0, 0.066, -0.131, darkMetal, 0.005);
  if (detail) {
    parts.box(0.014, 0.022, 0.018, 0, 0.066, -0.134, '#9a824c', 0.002);
    parts.box(0.026, 0.044, 0.014, equipmentSide * -0.058, 0.066, -0.128, web, 0.003);
  }
  for (let i = 0; i < 2; i++) {
    const px = -equipmentSide * (0.136 + i * 0.026);
    const pz = -0.095 + i * 0.032;
    parts.box(0.028, 0.072, 0.030, px, 0.072, pz, gear, 0.004);
    if (detail) parts.box(0.022, 0.024, 0.022, px, 0.112, pz, darkMetal, 0.002);
  }
  pocket(parts, 0, 0.068, 0.124, 0.118, 0.078, 0.044, binding, gear, detail, true);
  if (detail) {
    parts.box(0.022, 0.012, 0.008, 0, 0.098, 0.158, '#a83c32', 0.002);
  }

  // Side cummerbund and sculpted swimmer-cut front SAPI plate carrier.
  fabric(parts, [
    [0.162, 0, 0.156, -0.118, 0.112], [0.188, 0, 0.180, -0.134, 0.125],
    [0.264, 0, 0.184, -0.140, 0.129], [0.296, 0, 0.170, -0.130, 0.118],
  ], binding, sections, 0.84);
  fabric(parts, [
    [0.154, 0, 0.118, -0.122, -0.068], [0.178, 0, 0.148, -0.142, -0.072],
    [0.224, 0, 0.158, -0.154, -0.070], [0.334, 0, 0.160, -0.158, -0.070],
    [0.402, 0, 0.146, -0.154, -0.072], [0.448, 0, 0.122, -0.136, -0.074],
    [0.472, 0, 0.098, -0.118, -0.076],
  ], carrierTint, sections, 0.56);

  // Upper chest admin panel and padded shoulder harness.
  fabric(parts, [
    [0.342, 0, 0.124, -0.162, -0.136], [0.358, 0, 0.132, -0.166, -0.136],
    [0.422, 0, 0.122, -0.162, -0.134], [0.438, 0, 0.106, -0.152, -0.130],
  ], gear, detail ? 12 : 8, 0.48);

  for (const side of [-1, 1]) {
    // Side ballistic plate pouches on the cummerbund.
    parts.box(0.028, 0.104, 0.118, side * 0.176, 0.228, -0.012, gear, 0.006);
    const path = [
      [side * 0.118, 0.296, -0.150], [side * 0.116, 0.362, -0.148],
      [side * 0.110, 0.424, -0.134], [side * 0.106, 0.468, -0.086],
      [side * 0.102, 0.498, -0.048], [side * 0.098, 0.514, -0.012],
      [side * 0.098, 0.510, 0.032], [side * 0.096, 0.482, 0.074],
      [side * 0.088, 0.434, 0.118], [side * 0.090, 0.398, 0.150],
    ];
    webbing(parts, path, [0.038, 0.042, 0.050, 0.062, 0.066, 0.064, 0.062, 0.056, 0.044, 0.032], binding, ACROSS, true);
    if (detail) {
      const padPath = path.slice(3, 8).map(([x, y, z]) => [x, y + 0.004, z]);
      webbing(parts, padPath, 0.046, boot, ACROSS, false);
      const visible = path.slice(1, 7).map(([x, y, z]) => [x + side * 0.014, y + 0.002, z - 0.002]);
      webbing(parts, visible, 0.0042, wear);
      parts.box(0.046, 0.026, 0.016, side * 0.116, 0.348, -0.154, boot, 0.004);
      parts.box(0.034, 0.009, 0.010, side * 0.116, 0.347, -0.162, wear, 0.0015);
    }
  }

  badge(parts, { x: equipmentSide * -0.012, y: 0.394, z: -0.164, direction: -1, width: 0.122, height: 0.044, insignia, edging, detail });

  // Open-top triple rifle magazine shingle with protruding STANAG magazines and pull tabs.
  const slots = 3;
  for (let i = 0; i < slots; i++) {
    const x = -0.066 + i * 0.066;
    const py = 0.224 + 0.003 * (i % 2);
    pocket(parts, x, py, -0.146, 0.060, 0.106, 0.042, pocketColor, lining, detail);
    parts.box(0.046, 0.044, 0.024, x, py + 0.064, -0.164, darkMetal, 0.004);
    if (detail) {
      parts.box(0.048, 0.014, 0.026, x, py + 0.088, -0.164, boot, 0.003);
      parts.box(0.008, 0.052, 0.006, x, py + 0.038, -0.188, wear, 0.001);
    }
  }
  pocket(parts, equipmentSide * 0.128, 0.202, -0.108, 0.068, 0.112, 0.038, gear, tint(cloth, 0.90), detail);
  if (detail) {
    // PTT switch box and horizontal tactical chemlight tubes on the chest rig.
    parts.box(0.034, 0.042, 0.018, -equipmentSide * 0.086, 0.388, -0.164, darkMetal, 0.004);
    parts.cylinder(0.0055, 0.0055, 0.088, 0.018, 0.334, -0.166, '#7ca352');
    for (const y of [0.304, 0.320]) {
      webbing(parts, [[-0.130, y, -0.140], [-0.090, y + 0.002, -0.156], [0, y + 0.002, -0.160],
        [0.090, y, -0.156], [0.128, y - 0.001, -0.140]], 0.0075, boot, DOWN, true);
    }
  }

  // Structured rear assault pack with upper and lower compartments, compression straps, and IFF badge.
  fabric(parts, [
    [0.112, equipmentSide * 0.010, 0.088, 0.094, 0.174 + packDepthOffset],
    [0.134, equipmentSide * 0.012, 0.116, 0.086, 0.206 + packDepthOffset],
    [0.186, equipmentSide * 0.010, 0.132, 0.076, 0.230 + packDepthOffset],
    [0.288, equipmentSide * 0.005, 0.136, 0.078, 0.238 + packDepthOffset],
    [0.376, equipmentSide * 0.002, 0.124, 0.078, 0.222 + packDepthOffset],
    [0.424, equipmentSide * -0.002, 0.102, 0.086, 0.188 + packDepthOffset],
    [0.452, equipmentSide * -0.004, 0.074, 0.096, 0.162 + packDepthOffset],
  ], gear, sections, 0.72);
  pocket(parts, equipmentSide * 0.002, 0.334, 0.208 + packDepthOffset, 0.182, 0.126, 0.042, carrierTint, lining, detail, true);
  pocket(parts, equipmentSide * 0.004, 0.194, 0.206 + packDepthOffset, 0.196, 0.124, 0.046, binding, gear, detail, true);
  badge(parts, { x: equipmentSide * 0.004, y: 0.352, z: 0.252 + packDepthOffset, direction: 1, width: 0.126,
    height: 0.044, insignia, edging, detail });
  if (detail) {
    const z = 0.242 + packDepthOffset;
    tube(parts, [[-0.084, 0.258, z - 0.006], [-0.074, 0.242, z + 0.004],
      [0, 0.238, z + 0.010], [0.060, 0.244, z + 0.007], [0.078, 0.258, z - 0.003]], 0.0032, boot, detail);
    tube(parts, [[-0.038, 0.430, 0.130], [-0.028, 0.466, 0.142], [0.032, 0.467, 0.143],
      [0.050, 0.432, 0.139]], 0.0062, boot, detail);
    for (const side of [-1, 1]) {
      webbing(parts, [[side * 0.088, 0.382, 0.232 + packDepthOffset], [side * 0.104, 0.312, 0.244 + packDepthOffset],
        [side * 0.112, 0.242, 0.240 + packDepthOffset], [side * 0.098, 0.168, 0.220 + packDepthOffset]],
      0.016, boot, ACROSS, true);
    }
  }

  const radioX = equipmentSide * 0.134;
  parts.box(0.044, 0.098, 0.042, radioX, 0.358, -0.086, '#32372f', 0.008);
  parts.cylinder(0.0065, 0.0075, 0.024, radioX - equipmentSide * 0.012, 0.415, -0.080, '#222622');
  if (detail) {
    tube(parts, [[radioX, 0.398, -0.072], [radioX + equipmentSide * 0.006, 0.482, -0.068],
      [radioX + equipmentSide * 0.008, 0.562, -0.058], [radioX + equipmentSide * 0.012, 0.608, -0.048]], 0.0032, '#222722', detail);
    const s = team === 0 ? 1 : -1;
    tube(parts, [[s * 0.074, 0.416, 0.168], [s * 0.090, 0.492, 0.088], [s * 0.090, 0.530, -0.004],
      [s * 0.094, 0.488, -0.094], [s * 0.114, 0.422, -0.144], [s * 0.110, 0.380, -0.156]], 0.0052, web, detail);
  }
}
