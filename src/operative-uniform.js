import { BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Mesh, Sphere, Vector3 } from 'three';

// Position along the limb, half-width, front-to-back radius, and optional shaping.
const TROUSER = [
  [-.18, .087, .096], [-.11, .096, .109], [-.025, .103, .111], [.075, .103, .107],
  [.18, .098, .104], [.28, .092, .096], [.37, .085, .092], [.434, .078, .083],
  [.47, .077, .080], [.51, .076, .081], [.552, .076, .078], [.596, .072, .075],
  [.657, .071, .078], [.73, .071, .080], [.81, .065, .069], [.9, .058, .062],
  [.967, .055, .058], [1.022, .052, .056],
];
const SLEEVE = [
  [-.25, .040, .045], [-.165, .062, .063], [-.065, .075, .076], [.04, .080, .079],
  [.13, .078, .077], [.195, .075, .075], [.25, .074, .072], [.326, .070, .066],
  [.404, .065, .060], [.457, .060, .060], [.51, .058, .058], [.56, .059, .060],
  [.621, .056, .059], [.702, .055, .056], [.79, .051, .052], [.9, .046, .048],
  [.956, .045, .046],
];
const CLOTH_CHAINS = [[3, 4, 5], [6, 7, 8], [9, 10, 11], [12, 13, 14]];
const CORNER_START = .42;
const CORNER_END = .585;

function clamp01(x) { return Math.min(1, Math.max(0, x)); }

function limbCenter(out, upper, middle, lower, t, a, b) {
  if (t <= CORNER_START) return out.lerpVectors(upper, middle, t * 2);
  if (t >= CORNER_END) return out.lerpVectors(middle, lower, t * 2 - 1);
  const f = (t - CORNER_START) / (CORNER_END - CORNER_START);
  return out.copy(a).multiplyScalar((1 - f) ** 2).addScaledVector(middle, 2 * f * (1 - f)).addScaledVector(b, f * f);
}

function sections(near, arm) {
  const profile = arm ? SLEEVE : TROUSER;
  if (near) return profile;
  return profile.filter(([t], i) => i % 2 === 0 || i === profile.length - 1 || (arm && t === .195));
}

function pigment(palette, angle, t, variation, arm, side) {
  const patch = Math.sin(angle * 3.9 + t * 15 + variation * 1.91)
    + .62 * Math.cos(angle * 5 - t * 21 + variation * 2.71)
    + .4 * Math.sin(angle * 8 + t * 33);
  const amount = patch > .92 ? .24 : patch < -.86 ? -.23 : .036 * Math.sin(t * 85 + angle * 2.2);
  const base = palette.cloth.clone();
  base.lerp(amount > 0 ? palette.lighter : palette.dark, Math.abs(amount));
  if (!arm) {
    // Cut-and-sewn knee reinforcements and a shaped cargo panel at the outer thigh.
    const front = Math.max(0, -Math.sin(angle));
    const out = Math.max(0, Math.cos(angle) * side);
    const knee = front ** 3 * clamp01(1 - Math.abs(t - .50) * 11);
    const pocket = out ** 4 * clamp01(1 - Math.abs(t - .22) * 7);
    base.lerp(palette.dark, .39 * knee + .32 * pocket);
  } else {
    const out = Math.max(0, Math.cos(angle) * side);
    const panel = clamp01((t - .07) / .07) * clamp01((.303 - t) / .064) * (.73 + .27 * out);
    if (t >= .04 && t <= .326) base.lerp(palette.insignia, panel);
    if (t > .89) base.lerp(palette.dark, .22);
  }
  return base;
}

function radialAt(t, width, depth, theta, arm, side, phase) {
  const cosine = Math.cos(theta), sine = Math.sin(theta);
  const jointFold = clamp01(1 - Math.abs(t - .53) * 5);
  const folds = 1 + .045 * Math.sin(theta * 3 + t * 21 + phase)
    + .021 * Math.cos(theta * 5 - t * 28 - phase)
    + .047 * jointFold * Math.sin(t * 102 + theta * 1.3);
  const sidePanel = !arm ? Math.max(0, cosine * side) ** 6 * clamp01(1 - Math.abs(t - .21) * 7) * .017 : 0;
  const kneePanel = !arm ? Math.max(0, -sine) ** 4 * clamp01(1 - Math.abs(t - .49) * 9) * .006 : 0;
  return [cosine * (width * folds + sidePanel), sine * (depth * folds + kneePanel)];
}

export class OperativeUniform {
  constructor(group, detail, index, material, cloth, insignia) {
    this.geometry = new BufferGeometry();
    this.strips = [];
    this.origin = new Vector3();
    this.frame = {
      a: new Vector3(), b: new Vector3(), axis: new Vector3(), side: new Vector3(), back: new Vector3(),
      last: new Vector3(), next: new Vector3(),
    };
    const colors = [], uvs = [], indices = [];
    const base = new Color(cloth);
    const palette = {
      cloth: base, lighter: base.clone().lerp(new Color('#87806b'), .51),
      dark: base.clone().multiplyScalar(.54), insignia: new Color(insignia),
    };
    let vertex = 0;
    const around = detail ? 18 : 10;
    for (let limb = 0; limb < 4; limb++) {
      const arm = limb >= 2;
      const side = limb % 2 ? 1 : -1;
      const phase = index * .81 + limb * 1.59;
      const rows = sections(detail, arm).map(([t, width, depth]) => ({
        t, width, depth, center: new Vector3(), first: 0, radial: new Float32Array((around + 1) * 2),
      }));
      const first = vertex;
      for (let row = 0; row < rows.length; row++) {
        rows[row].first = vertex;
        const { t, width, depth, radial } = rows[row];
        for (let i = 0; i <= around; i++, vertex++) {
          const angle = (i % around) * (2 * Math.PI / around);
          radial.set(radialAt(t, width, depth, angle, arm, side, phase), 2 * i);
          const color = pigment(palette, angle, t, phase, arm, side);
          colors.push(color.r, color.g, color.b);
          uvs.push(i / around * (arm ? 2.1 : 2.8), t * (arm ? 3.7 : 5.4));
          if (row === rows.length - 1 || i === around) continue;
          const lower = vertex + around + 1;
          indices.push(vertex, vertex + 1, lower, vertex + 1, lower + 1, lower);
        }
      }
      const cap = vertex;
      const bottom = rows.at(-1).first;
      for (let i = 0; i < around; i++) {
        indices.push(cap, first + i + 1, first + i, cap + 1, bottom + i, bottom + i + 1);
      }
      for (let i = 0; i < 2; i++) {
        colors.push(base.r, base.g, base.b);
        uvs.push(.5, i);
        vertex++;
      }
      this.strips.push({ rows, cap, around, arm, side, chain: CLOTH_CHAINS[limb] });
    }
    this.geometry.setAttribute('position', new BufferAttribute(new Float32Array(vertex * 3), 3).setUsage(DynamicDrawUsage));
    this.geometry.setAttribute('normal', new BufferAttribute(new Float32Array(vertex * 3), 3).setUsage(DynamicDrawUsage));
    this.geometry.setAttribute('previousPosition', new BufferAttribute(new Float32Array(vertex * 3), 3).setUsage(DynamicDrawUsage));
    this.geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
    this.geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    this.geometry.setIndex(indices);
    this.geometry.boundingSphere = new Sphere(new Vector3(), 1.4);
    this.mesh = new Mesh(this.geometry, material);
    this.mesh.name = 'Continuous sleeves and trousers';
    this.mesh.castShadow = this.mesh.receiveShadow = true;
    group?.add(this.mesh);
  }

  deform(joints, bodySide, bodyFront, mesh = this.mesh) {
    const origin = this.origin.copy(joints[0]);
    const positions = this.geometry.attributes.position;
    const { a, b, axis, side, back, last, next } = this.frame;
    mesh.position.copy(origin);
    for (const { rows, cap, around, arm, side: limbSide, chain } of this.strips) {
      const upper = joints[chain[0]], middle = joints[chain[1]], lower = joints[chain[2]];
      a.lerpVectors(upper, middle, CORNER_START * 2);
      b.lerpVectors(middle, lower, CORNER_END * 2 - 1);
      for (const { t, center } of rows) {
        limbCenter(center, upper, middle, lower, t, a, b).sub(origin);
        if (t < 0) center.addScaledVector(bodySide, t * limbSide * (arm ? .095 : .105));
      }
      side.copy(bodySide);
      for (let ring = 0; ring < rows.length; ring++) {
        const { first, center, radial } = rows[ring];
        last.copy(rows[Math.max(0, ring - 1)].center);
        next.copy(rows[Math.min(rows.length - 1, ring + 1)].center);
        axis.subVectors(last, next).normalize();
        side.addScaledVector(axis, -side.dot(axis));
        if (side.lengthSq() < .001) side.crossVectors(bodyFront, axis);
        side.normalize();
        back.crossVectors(side, axis).normalize();
        for (let j = 0; j <= around; j++) {
          const x = radial[j * 2], z = radial[j * 2 + 1];
          positions.setXYZ(first + j,
            center.x + side.x * x + back.x * z,
            center.y + side.y * x + back.y * z,
            center.z + side.z * x + back.z * z,
          );
        }
      }
      const top = rows[0].center, bottom = rows.at(-1).center;
      positions.setXYZ(cap, top.x, top.y, top.z);
      positions.setXYZ(cap + 1, bottom.x, bottom.y, bottom.z);
    }
    positions.needsUpdate = true;
    this.geometry.computeVertexNormals();
    const normal = this.geometry.attributes.normal;
    for (const { rows, around } of this.strips) {
      for (const { first } of rows) {
        const seam = first + around;
        axis.set(
          normal.getX(first) + normal.getX(seam),
          normal.getY(first) + normal.getY(seam),
          normal.getZ(first) + normal.getZ(seam),
        ).normalize();
        normal.setXYZ(first, axis.x, axis.y, axis.z);
        normal.setXYZ(seam, axis.x, axis.y, axis.z);
      }
    }
    normal.needsUpdate = true;
  }
}
