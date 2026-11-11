import { BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Mesh, Sphere, Vector3 } from 'three';

// Position along the limb, half-width, front-to-back radius, and optional shaping.
const TROUSER = [
  [-.16, .080, .088], [-.09, .088, .096], [-.015, .092, .099], [.06, .093, .098],
  [.14, .090, .095], [.18, .090, .095], [.22, .088, .093], [.28, .085, .090],
  [.34, .081, .086], [.40, .076, .081], [.445, .075, .080], [.48, .077, .083],
  [.505, .078, .085], [.535, .076, .082], [.57, .072, .076], [.62, .070, .076],
  [.69, .069, .076], [.77, .065, .070], [.84, .062, .066], [.89, .063, .067],
  [.93, .054, .057], [.975, .050, .053], [1.022, .048, .051],
];
const SLEEVE = [
  [-.24, .040, .044], [-.15, .060, .062], [-.05, .072, .073], [.04, .076, .075],
  [.11, .075, .074], [.18, .073, .072], [.24, .071, .070], [.31, .067, .065],
  [.38, .063, .061], [.435, .060, .060], [.48, .061, .063], [.52, .061, .063],
  [.565, .059, .060], [.63, .057, .058], [.71, .054, .055], [.79, .050, .051],
  [.85, .049, .050], [.90, .050, .051], [.956, .043, .044],
];
const CLOTH_CHAINS = [[3, 4, 5], [6, 7, 8], [9, 10, 11], [12, 13, 14]];
const CORNER_START = .445;
const CORNER_END = .555;

function clamp01(x) { return Math.min(1, Math.max(0, x)); }

function boxStep(value, low, high, feather = .02) {
  return clamp01((value - low) / feather) * clamp01((high - value) / feather);
}

function limbCenter(out, upper, middle, lower, t, a, b) {
  if (t <= CORNER_START) return out.lerpVectors(upper, middle, t * 2);
  if (t >= CORNER_END) return out.lerpVectors(middle, lower, t * 2 - 1);
  const f = (t - CORNER_START) / (CORNER_END - CORNER_START);
  return out.copy(a).multiplyScalar((1 - f) ** 2).addScaledVector(middle, 2 * f * (1 - f)).addScaledVector(b, f * f);
}

function sections(near, arm) {
  const profile = arm ? SLEEVE : TROUSER;
  if (near) return profile;
  return profile.filter(([t], i) => i % 2 === 0 || i === profile.length - 1 || (arm && t === .18));
}

function pigment(palette, angle, t, variation, arm, side, limb) {
  const cosine = Math.cos(angle), sine = Math.sin(angle);
  const front = Math.max(0, -sine);
  const back = Math.max(0, sine);
  const out = Math.max(0, cosine * side);
  const inner = Math.max(0, -cosine * side);
  const patch = Math.sin(angle * 3.9 + t * 15 + variation * 1.91)
    + .62 * Math.cos(angle * 5 - t * 21 + variation * 2.71)
    + .4 * Math.sin(angle * 8 + t * 33);
  const amount = patch > .92 ? .18 : patch < -.86 ? -.18 : .032 * Math.sin(t * 85 + angle * 2.2);
  const base = (arm ? palette.cloth : palette.trouser).clone();
  base.lerp(amount > 0 ? palette.lighter : palette.dark, Math.abs(amount));
  const seam = Math.max(bellAngle(cosine * side, 1, .09), bellAngle(cosine * side, -1, .09));
  base.multiplyScalar(1 - seam * .14);

  if (!arm) {
    // Waistband shadow, reinforced gusset, cargo pockets, thigh rig straps, knee armor, and bloused cuffs.
    if (t < .03) base.lerp(palette.boot, clamp01((.03 - t) / .04) * .72);
    const gusset = inner ** 2 * clamp01(1 - Math.abs(t - .09) * 5.5);
    base.lerp(palette.dark, gusset * .35);

    const cargoBox = out ** 2.6 * boxStep(t, .15, .35, .022);
    const cargoFlap = out ** 2.4 * boxStep(t, .145, .205, .015);
    const cargoShadow = out ** 2.4 * boxStep(t, .202, .222, .008);
    base.lerp(palette.gear, cargoBox * .58);
    base.lerp(palette.vest, cargoFlap * .72);
    base.lerp(palette.boot, cargoShadow * .75);

    if (side > 0) {
      const strap = boxStep(t, .18, .21, .009) + boxStep(t, .275, .305, .009);
      base.lerp(palette.boot, clamp01(strap) * .82);
    }

    const kneePadSurround = front ** 2.2 * boxStep(t, .425, .575, .022);
    const kneeCap = front ** 3.4 * boxStep(t, .45, .55, .018);
    const kneeRidge = front ** 6 * boxStep(t, .488, .512, .01);
    const kneeStrap = (1 - front ** 2.5) * (boxStep(t, .455, .482, .009) + boxStep(t, .522, .549, .009));
    base.lerp(palette.vest, kneePadSurround * .75);
    base.lerp(palette.boot, clamp01(kneeCap * .92 + kneeStrap * .78));
    base.lerp(palette.lighter, kneeRidge * .28);

    const cuffBlouse = boxStep(t, .87, .93, .02);
    base.lerp(palette.dark, cuffBlouse * .28);
    if (t > .92) base.lerp(palette.boot, clamp01((t - .92) / .04) * .88);
  } else {
    // Underarm gusset, shoulder pocket, Velcro brassard with team insignia, elbow pad, cuff, and wrist watch.
    const underarm = inner ** 1.8 * clamp01((.34 - t) / .22);
    base.lerp(palette.dark, underarm * .36);

    const shoulderPocket = out ** 2.4 * boxStep(t, .06, .30, .02);
    const velcroFrame = out ** 3.6 * boxStep(t, .10, .25, .012);
    const patchStripe = out ** 5.2 * boxStep(t, .155, .195, .008);
    base.lerp(palette.vest, shoulderPocket * .46);
    base.lerp(palette.boot, velcroFrame * .84);
    base.lerp(palette.insignia, patchStripe * .82);

    const elbowPad = back ** 2.4 * boxStep(t, .43, .57, .022);
    const elbowRib = elbowPad * (0.5 + 0.5 * Math.sin(t * 210));
    base.lerp(palette.gear, elbowPad * .76);
    base.lerp(palette.boot, elbowRib * .45);

    if (limb === 2) {
      const watchBand = boxStep(t, .80, .865, .012);
      const watchFace = Math.max(0, out * .7 + back * .55) ** 4 * boxStep(t, .812, .853, .01);
      base.lerp(palette.boot, watchBand * .88);
      base.lerp(palette.watch, clamp01(watchFace * 1.4));
    }
    const cuff = boxStep(t, .875, .956, .016);
    base.lerp(palette.vest, cuff * .68);
    if (t > .92) base.lerp(palette.boot, .38);
  }
  return base;
}

function bellAngle(value, target, width) {
  const d = (value - target) / width;
  return Math.exp(-d * d);
}

function radialAt(t, width, depth, theta, arm, side, phase, limb) {
  const cosine = Math.cos(theta), sine = Math.sin(theta);
  const front = Math.max(0, -sine);
  const back = Math.max(0, sine);
  const out = Math.max(0, cosine * side);
  const jointFold = clamp01(1 - Math.abs(t - .505) * 5.2);
  const folds = 1 + .032 * Math.sin(theta * 3 + t * 21 + phase)
    + .018 * Math.cos(theta * 5 - t * 28 - phase)
    + .038 * jointFold * Math.sin(t * 106 + theta * 1.3);
  if (!arm) {
    const cargo = out ** 3.2 * boxStep(t, .16, .34, .02) * (.009 + .002 * Math.cos((t - .25) * 45));
    const cargoFlap = out ** 3.0 * boxStep(t, .155, .205, .014) * .003;
    const holster = side > 0 ? out ** 3.0 * boxStep(t, .18, .30, .018) * .006 : 0;
    const kneeSurround = front ** 2.4 * boxStep(t, .43, .57, .022) * .007;
    const kneeCap = front ** 3.8 * boxStep(t, .455, .545, .018) * .013;
    const blouse = boxStep(t, .85, .915, .02) * (.006 + .002 * Math.sin(theta * 6 + phase));
    return [
      cosine * (width * folds + blouse) + side * (cargo + cargoFlap + holster),
      sine * (depth * folds + blouse) - (kneeSurround + kneeCap),
    ];
  }
  const shoulderPatch = out ** 2.8 * boxStep(t, .06, .29, .02) * .005;
  const elbowCap = back ** 2.8 * boxStep(t, .43, .57, .022) * .009;
  const watch = limb === 2 ? Math.max(0, out * .7 + back * .55) ** 3.5 * boxStep(t, .805, .86, .012) * .006 : 0;
  const cuff = boxStep(t, .875, .935, .018) * .004;
  return [
    cosine * (width * folds + cuff) + side * (shoulderPatch + watch * .6),
    sine * (depth * folds + cuff) + elbowCap + watch * .5,
  ];
}

export class OperativeUniform {
  constructor(group, detail, index, material, cloth, insignia, vest = '#3f4339', gear = '#4d483e', boot = '#272924') {
    this.geometry = new BufferGeometry();
    this.strips = [];
    this.origin = new Vector3();
    this.frame = {
      a: new Vector3(), b: new Vector3(), axis: new Vector3(), side: new Vector3(), back: new Vector3(),
      last: new Vector3(), next: new Vector3(), upperDir: new Vector3(), lowerDir: new Vector3(),
    };
    const colors = [], uvs = [], indices = [];
    const base = new Color(cloth);
    const vestColor = new Color(vest);
    const gearColor = new Color(gear);
    const bootColor = new Color(boot);
    const trouser = base.clone().lerp(vestColor, .48).lerp(bootColor, .22);
    const palette = {
      cloth: base,
      trouser,
      vest: vestColor,
      gear: gearColor,
      boot: bootColor,
      lighter: base.clone().lerp(new Color('#9c947e'), .48),
      dark: base.clone().multiplyScalar(.48),
      insignia: new Color(insignia),
      watch: new Color('#5d8078'),
    };
    let vertex = 0;
    const around = detail ? 20 : 10;
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
          radial.set(radialAt(t, width, depth, angle, arm, side, phase, limb), 2 * i);
          const color = pigment(palette, angle, t, phase, arm, side, limb);
          colors.push(color.r, color.g, color.b);
          uvs.push(i / around * (arm ? 2.1 : 2.8), t * (arm ? 3.7 : 5.4));
          if (row === rows.length - 1 || i === around) continue;
          const lower = vertex + around + 1;
          indices.push(vertex, vertex + 1, lower, vertex + 1, lower + 1, lower);
        }
      }
      const cap = vertex;
      const bottom = rows.at(-1).first;
      const capColor = arm ? base : trouser;
      for (let i = 0; i < around; i++) {
        indices.push(cap, first + i + 1, first + i, cap + 1, bottom + i, bottom + i + 1);
      }
      for (let i = 0; i < 2; i++) {
        colors.push(capColor.r, capColor.g, capColor.b);
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
    const { a, b, axis, side, back, last, next, upperDir, lowerDir } = this.frame;
    mesh.position.copy(origin);
    for (const { rows, cap, around, arm, side: limbSide, chain } of this.strips) {
      const upper = joints[chain[0]], middle = joints[chain[1]], lower = joints[chain[2]];
      upperDir.subVectors(middle, upper).normalize();
      lowerDir.subVectors(lower, middle).normalize();
      const flex = clamp01((1 - upperDir.dot(lowerDir)) * .55);
      a.lerpVectors(upper, middle, CORNER_START * 2);
      b.lerpVectors(middle, lower, CORNER_END * 2 - 1);
      for (const { t, center } of rows) {
        limbCenter(center, upper, middle, lower, t, a, b).sub(origin);
        if (t < 0) center.addScaledVector(bodySide, t * limbSide * (arm ? .095 : .105));
      }
      side.copy(bodySide);
      for (let ring = 0; ring < rows.length; ring++) {
        const { t, first, center, radial } = rows[ring];
        last.copy(rows[Math.max(0, ring - 1)].center);
        next.copy(rows[Math.min(rows.length - 1, ring + 1)].center);
        axis.subVectors(last, next).normalize();
        side.addScaledVector(axis, -side.dot(axis));
        if (side.lengthSq() < .001) side.crossVectors(bodyFront, axis);
        side.normalize();
        back.crossVectors(side, axis).normalize();
        const jointZone = Math.exp(-(((t - .5) / .09) ** 2)) * flex;
        const widen = 1 + jointZone * .14;
        const patellaShift = (arm ? .012 : -.016) * jointZone;
        for (let j = 0; j <= around; j++) {
          const x = radial[j * 2] * widen;
          const z = radial[j * 2 + 1] + patellaShift;
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
