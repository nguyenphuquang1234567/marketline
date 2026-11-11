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
  const packDepthOffset = 0.006 * (index % 3);
  const pocketColor = index % 3 === 1 ? carrierTint : gear;

  // Side cummerbund and curved front carrier. The straps bridge the cloth shoulder without rigid pads.
  fabric(parts, [
    [0.165, 0, 0.150, -0.112, 0.108], [0.189, 0, 0.172, -0.127, 0.119],
    [0.248, 0, 0.178, -0.134, 0.123], [0.274, 0, 0.164, -0.126, 0.112],
  ], binding, sections, 0.84);
  fabric(parts, [
    [0.149, 0, 0.107, -0.113, -0.068], [0.168, 0, 0.135, -0.129, -0.073],
    [0.212, 0, 0.151, -0.146, -0.071], [0.318, 0, 0.153, -0.153, -0.070],
    [0.384, 0, 0.143, -0.152, -0.073], [0.429, 0, 0.117, -0.133, -0.076],
    [0.447, 0, 0.095, -0.116, -0.079],
  ], carrierTint, sections, 0.55);
  fabric(parts, [
    [0.043, 0, 0.148, -0.111, 0.112], [0.054, 0, 0.163, -0.122, 0.122],
    [0.082, 0, 0.164, -0.121, 0.120], [0.092, 0, 0.153, -0.112, 0.114],
  ], web, sections, 0.81, false);

  for (const side of [-1, 1]) {
    const path = [
      [side * 0.120, 0.284, -0.146], [side * 0.119, 0.351, -0.146],
      [side * 0.111, 0.412, -0.136], [side * 0.105, 0.455, -0.088],
      [side * 0.100, 0.484, -0.055], [side * 0.096, 0.502, -0.021],
      [side * 0.096, 0.499, 0.024], [side * 0.094, 0.475, 0.067],
      [side * 0.083, 0.428, 0.113], [side * 0.088, 0.397, 0.147],
    ];
    webbing(parts, path, [0.034, 0.037, 0.044, 0.054, 0.056, 0.054, 0.054, 0.052, 0.041, 0.029], binding, ACROSS, true);
    if (detail) {
      const visible = path.slice(1, 7).map(([x, y, z]) => [x + side * 0.014, y + 0.0016, z - 0.0018]);
      webbing(parts, visible, 0.0038, wear);
      parts.box(0.043, 0.024, 0.014, side * 0.120, 0.333, -0.151, web, 0.004);
      parts.box(0.032, 0.008, 0.009, side * 0.121, 0.332, -0.160, wear, 0.0015);
    }
  }

  badge(parts, { x: equipmentSide * -0.014, y: 0.373, z: -0.153, direction: -1, width: 0.121, height: 0.042, insignia, edging, detail });
  const slots = index % 3 === 2 ? 2 : 3;
  for (let i = 0; i < slots; i++) {
    const x = equipmentSide * (-0.092 + i * 0.062);
    pocket(parts, x, 0.221 + 0.004 * (i % 2), -0.144, 0.060, 0.102 + (i % 2) * 0.012, 0.042, pocketColor, lining, detail);
  }
  pocket(parts, equipmentSide * 0.114, 0.188, -0.105, 0.072, 0.117, 0.038, gear, tint(cloth, 0.90), detail);
  if (detail) {
    parts.box(0.048, 0.034, 0.014, equipmentSide * -0.013, 0.067, -0.123, '#42463d', 0.006);
    parts.box(0.028, 0.006, 0.003, equipmentSide * -0.013, 0.069, -0.132, wear, 0.001);
    for (const y of [0.297, 0.314]) {
      webbing(parts, [[-0.125, y, -0.137], [-0.087, y + 0.002, -0.152], [0, y + 0.002, -0.155],
        [0.088, y, -0.152], [0.122, y - 0.001, -0.137]], 0.007, lining, DOWN, true);
    }
  }

  // The loaded pack expands in its middle, with narrower shoulders and a tucked bottom.
  fabric(parts, [
    [0.109, equipmentSide * 0.012, 0.077, 0.097, 0.169 + packDepthOffset],
    [0.125, equipmentSide * 0.015, 0.103, 0.089, 0.196 + packDepthOffset],
    [0.174, equipmentSide * 0.014, 0.120, 0.078, 0.221 + packDepthOffset],
    [0.275, equipmentSide * 0.007, 0.124, 0.080, 0.231 + packDepthOffset],
    [0.364, equipmentSide * 0.003, 0.112, 0.080, 0.214 + packDepthOffset],
    [0.413, equipmentSide * -0.003, 0.092, 0.088, 0.180 + packDepthOffset],
    [0.439, equipmentSide * -0.006, 0.065, 0.098, 0.157 + packDepthOffset],
  ], gear, sections, 0.74);
  pocket(parts, equipmentSide * 0.002, 0.272, 0.203 + packDepthOffset, 0.181, 0.201, 0.043, carrierTint, lining, detail, true);
  badge(parts, { x: equipmentSide * 0.016, y: 0.327, z: 0.247 + packDepthOffset, direction: 1, width: 0.124,
    height: 0.044, insignia, edging, detail });
  if (detail) {
    const z = 0.237 + packDepthOffset;
    tube(parts, [[-0.084, 0.228, z - 0.006], [-0.074, 0.208, z + 0.004],
      [0, 0.204, z + 0.010], [0.060, 0.212, z + 0.007], [0.078, 0.229, z - 0.003]], 0.0028, web, detail);
    tube(parts, [[-0.036, 0.417, 0.128], [-0.026, 0.454, 0.140], [0.032, 0.455, 0.141],
      [0.049, 0.420, 0.137]], 0.0056, lining, detail);
    for (const side of [-1, 1]) {
      webbing(parts, [[side * 0.080, 0.369, 0.228 + packDepthOffset], [side * 0.095, 0.305, 0.239 + packDepthOffset],
        [side * 0.105, 0.241, 0.234 + packDepthOffset], [side * 0.090, 0.168, 0.215 + packDepthOffset]],
      0.014, web, ACROSS, true);
    }
  }

  const radioX = equipmentSide * 0.126;
  parts.box(0.041, 0.093, 0.039, radioX, 0.358, -0.081, '#3d4137', 0.008);
  parts.cylinder(0.006, 0.007, 0.022, radioX - equipmentSide * 0.012, 0.411, -0.076, '#2a2f2a');
  if (detail) {
    tube(parts, [[radioX, 0.394, -0.068], [radioX + equipmentSide * 0.006, 0.475, -0.066],
      [radioX + equipmentSide * 0.006, 0.550, -0.056], [radioX + equipmentSide * 0.010, 0.589, -0.047]], 0.0029, '#282e28', detail);
    const s = team === 0 ? 1 : -1;
    tube(parts, [[s * 0.071, 0.407, 0.165], [s * 0.087, 0.481, 0.087], [s * 0.086, 0.521, -0.004],
      [s * 0.091, 0.480, -0.092], [s * 0.112, 0.416, -0.141], [s * 0.108, 0.375, -0.152]], 0.0048, web, detail);
  }
}
