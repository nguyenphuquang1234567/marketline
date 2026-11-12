import * as THREE from 'three';

const WHEEL_HEIGHT = .377;
const AXLES = [-1.37, 1.33];
const TAU = 2 * Math.PI;
const { lerp, smoothstep } = THREE.MathUtils;

function buffer(position, indices, uv, color) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (color) geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// Pressed panels use a curved front skin, a thinner back skin, and a folded edge.
export function panel(columns, rows, sample, thickness, flipped = false, tint = null) {
  const count = (columns + 1) * (rows + 1);
  const skins = thickness ? 2 : 1;
  const positions = [], indices = [], uv = [], colors = tint ? [] : null;
  for (let skin = 0; skin < skins; skin++) {
    for (let row = 0; row <= rows; row++) {
      for (let column = 0; column <= columns; column++) {
        const u = column / columns, v = row / rows;
        const point = sample(u, v);
        positions.push(...point.map((coordinate, axis) => coordinate + (thickness?.[axis] ?? 0) * skin));
        uv.push(u, v);
        if (colors) colors.push(...tint(point, u, v, skin));
      }
    }
  }
  const quad = (a, b, c, d, reverse) => {
    if (reverse) indices.push(a, d, b, a, c, d);
    else indices.push(a, b, d, a, d, c);
  };
  const stride = columns + 1;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const a = row * stride + column;
      quad(a, a + 1, a + stride, a + stride + 1, flipped);
      if (thickness) quad(a + count, a + count + 1, a + count + stride, a + count + stride + 1, !flipped);
    }
  }
  if (!thickness) return buffer(positions, indices, uv, colors);
  for (let i = 0; i < columns; i++) {
    quad(i, i + count, i + 1, i + 1 + count, flipped);
    const top = rows * stride + i;
    quad(top, top + 1, top + count, top + 1 + count, flipped);
  }
  for (let i = 0; i < rows; i++) {
    const a = i * stride, b = a + columns;
    quad(a, a + stride, a + count, a + stride + count, flipped);
    quad(b, b + count, b + stride, b + stride + count, flipped);
  }
  return buffer(positions, indices, uv, colors);
}

function profile(stations, t) {
  for (let i = 1; i < stations.length; i++) {
    const [end, target] = stations[i];
    if (t > end) continue;
    const [start, base] = stations[i - 1];
    return lerp(base, target, smoothstep(t, start, end));
  }
  return stations.at(-1)[1];
}

function skinColor([x, y, z], u, v, damaged, inside) {
  const dust = .78 + .22 * smoothstep(y, .48, .92);
  const grain = 1 + .033 * Math.cos(z * 49.2 + y * 67.1 + x * 50) * Math.sin(z * 31.3 + y * 21.7);
  const heat = damaged ? .51 * Math.exp(-((z - 1.08) ** 2) / .47 - ((y - 1.22) ** 2) / .17) : 0;
  const lip = inside ? .77 : .87 + .13 * smoothstep(Math.min(u, 1 - u, v, 1 - v), 0, .092);
  return [dust * grain * lip * (1 - heat * .76), dust * grain * lip * (1 - heat), dust * grain * lip * (1 - heat * 1.13)];
}

const sill = .585;
const belt = 1.221;
const bedRailTop = z => 1.136 - .023 * smoothstep(Math.abs(z), 1.87, 2.14);
const shoulder = [
  [.47, .76], [.565, .791], [.62, .817], [.735, .828],
  [.943, .842], [1.035, .857], [1.106, .882], [1.184, .893], [1.265, .865],
];
const buckle = [
  [1.019, 1.143], [1.145, 1.085], [1.278, 1.087], [1.387, .96],
  [1.477, .961], [1.546, 1.049], [1.645, 1.004], [1.738, .89],
  [1.834, .932], [1.994, .82], [2.116, .826],
];

const distanceToAxle = z => Math.min(Math.abs(z - AXLES[0]), Math.abs(z - AXLES[1]));

function arch(z) {
  const distance = distanceToAxle(z);
  if (distance > .443) return .472;
  const crown = WHEEL_HEIGHT + .472 * Math.sqrt(1 - (distance / .451) ** 2);
  return Math.max(.472, crown);
}

function flank(z, y, damage) {
  const taper = .037 * smoothstep(Math.abs(z), 1.82, 2.17);
  const wheel = distanceToAxle(z);
  const flare = .039 * (1 - smoothstep(wheel, .406, .486)) * (1 - smoothstep(y - arch(z), 0, .115));
  const crease = .011 * Math.exp(-(((y - 1.035) / .045) ** 2));
  const dent = damage ? .039 * Math.exp(-(((z - .61) / .24) ** 2) - ((y - 1.04) / .18) ** 2)
    + .023 * Math.exp(-(((z - 1.72) / .16) ** 2) - ((y - .84) / .22) ** 2) : 0;
  return profile(shoulder, y) - taper + flare + crease - dent;
}

export function addStampedBody(f, finish, paint, damaged) {
  for (const side of [-1, 1]) {
    const torn = damaged && side < 0;
    const panels = [
      ['bed', -2.145, -.388, arch, bedRailTop],
      ['rocker', -.388, 1.006, arch, () => sill - .008],
      ['door', -.381, .996, () => sill, () => belt],
      ['front', 1.007, 2.136, arch, z => torn ? profile(buckle, z) : 1.204 - .081 * smoothstep(z, 1.51, 2.134)],
    ];
    for (const [part, from, to, lower, upper] of panels) {
      const columns = torn ? (part === 'bed' ? 30 : 26) : 20;
      const geometry = panel(columns, part === 'door' ? 10 : 7, (u, v) => {
        const z = lerp(from, to, u);
        const bottom = lower(z);
        const y = lerp(bottom, Math.max(bottom + .022, upper(z)), v);
        const pressed = part === 'door' ? .018 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v) : 0;
        const warp = torn && part === 'front' ? .038 * smoothstep(v, .46, 1) * Math.sin(z * 34) : 0;
        return [side * (flank(z, y, torn) + pressed + warp), y, z];
      }, [-side * (part === 'door' ? .024 : .012), 0, 0], side > 0,
      (point, u, v, skin) => skinColor(point, u, v, torn, skin));
      f.mesh(geometry, finish, paint, 0, 0, 0);
      geometry.dispose();
    }
  }
}

export function addWheelArchReturns(f, finish, paint, damaged) {
  for (const side of [-1, 1]) for (const axle of AXLES) {
    const torn = damaged && side < 0 && axle === AXLES[1];
    const geometry = panel(torn ? 35 : 24, 3, (u, v) => {
      const angle = lerp(.217, Math.PI - .217, u);
      const r = .451 + .027 * v;
      const z = axle + Math.cos(angle) * r;
      const y = WHEEL_HEIGHT + Math.sin(angle) * (r + .018);
      return [side * (flank(z, y, torn) + .001 + Math.sin(v * Math.PI) * .016), y, z];
    }, [-side * .018, 0, 0], side < 0);
    f.mesh(geometry, torn ? 'coatedSteel' : finish, torn ? 0x5e5045 : paint, 0, 0, 0);
    geometry.dispose();
  }
}

export function addPickupDecks(f, finish, paint, damaged) {
  const roof = panel(damaged ? 22 : 16, damaged ? 14 : 10, (u, v) => {
    const x = (u * 2 - 1) * (.740 + .025 * Math.sin(v * Math.PI));
    const z = lerp(-.407, .835, v) - .025 * Math.abs(u * 2 - 1) ** 3;
    const crown = .041 * (1 - (u * 2 - 1) ** 2) + .028 * Math.sin(Math.PI * v);
    const dent = damaged ? .028 * Math.exp(-(((x + .35) / .20) ** 2) - ((z - .62) / .24) ** 2) : 0;
    return [x, 1.83 + crown - dent, z];
  }, [0, -.046, 0], true, (point, u, v, skin) => skinColor(point, u, v, damaged, skin));
  f.mesh(roof, finish, paint, 0, 0, 0);
  roof.dispose();
  if (!damaged) {
    const hood = panel(20, 15, (u, v) => {
      const t = u * 2 - 1;
      const x = t * lerp(.867, .840, v);
      const z = lerp(1.048, 2.173 - .039 * Math.abs(t) ** 3, v);
      const rise = .022 * (1 - t ** 2) + .019 * Math.exp(-((t / .53) ** 8));
      return [x, lerp(1.209, 1.122, v) + rise, z];
    }, [0, -.029, 0], true);
    f.mesh(hood, finish, paint, 0, 0, 0);
    hood.dispose();
  }
  const bed = panel(46, 5, (u, v) => {
    const t = u * 2 - 1;
    const z = lerp(-2.061, -.498, v);
    const rim = .040 * smoothstep(Math.abs(t), .87, 1);
    const press = .013 * (.5 + .5 * Math.cos(TAU * u * 10)) ** 1.7;
    return [t * .785, .917 + rim + press, z];
  }, [0, -.025, 0], true, (point, u, v, skin) => skinColor(point, u, v, damaged, skin));
  f.mesh(bed, 'coatedSteel', damaged ? 0x6c6355 : 0x77776c, 0, 0, 0);
  bed.dispose();
  for (const side of [-1, 1]) {
    const rail = panel(23, 7, (u, v) => {
      const z = lerp(-2.128, -.390, u);
      const y = bedRailTop(z);
      const returnDepth = .039 * smoothstep(v, .19, .55) + .151 * smoothstep(v, .59, 1);
      const wheelTub = .071 * Math.exp(-(((z - AXLES[0]) / .32) ** 4)) * smoothstep(v, .60, 1);
      const hem = .008 * Math.sin(Math.PI * smoothstep(v, 0, .56));
      const x = lerp(flank(z, y, damaged && side < 0) - .006, .767 - wheelTub, smoothstep(v, 0, .72));
      return [side * x, y + hem - returnDepth, z];
    }, [side * .009, -.011, 0], side > 0, (point, u, v, skin) => skinColor(point, u, v, damaged, skin));
    f.mesh(rail, finish, paint, 0, 0, 0);
    rail.dispose();
  }
}

// Angled window openings, cowl, roof and side pillars share these coordinates.
const frontWindow = (u, v) => {
  const x = (u * 2 - 1) * lerp(.766, .704, v);
  const bulge = 1 - (u * 2 - 1) ** 2;
  return [x, lerp(1.235, 1.785, v) + .039 * bulge * v, lerp(1.062, .785, v) + bulge * .025];
};
const backWindow = (u, v) => {
  const t = u * 2 - 1;
  return [-t * lerp(.75, .700, v), lerp(1.244, 1.791, v) + .036 * (1 - t ** 2) * v, lerp(-.420, -.371, v) - .021 * (1 - t ** 2)];
};
const sideWindow = (u, v, side) => {
  const z = lerp(lerp(-.418, 1.048, u), lerp(-.368, .785, u), v);
  const x = side * (lerp(.849, .714, v) + .019 * Math.sin(u * Math.PI));
  return [x, lerp(1.229, 1.787, v) + (.009 + .013 * v) * Math.sin(u * Math.PI), z];
};

const shards = [
  [[.036, .05], [.39, .05], [.358, .097], [.279, .092], [.237, .184], [.158, .157], [.109, .315], [.034, .402]],
  [[.966, .052], [.967, .756], [.895, .678], [.879, .48], [.822, .52], [.85, .315], [.79, .249], [.847, .165], [.73, .056]],
  [[.15, .94], [.528, .94], [.484, .872], [.391, .90], [.304, .838], [.238, .877]],
];

function glassPatch(outline, sample) {
  const points = outline.map(([x, y]) => new THREE.Vector2(x, y));
  const indices = THREE.ShapeUtils.triangulateShape(points, []).flat();
  return buffer(outline.flatMap(([u, v]) => sample(u, v)), indices, outline.flat());
}

function addWindowTrim(f, sample, thickness, reverse, finish, tint, margins) {
  const [side, bottom, top] = margins;
  const strips = [
    [0, side, 0, 1], [1 - side, 1, 0, 1], [side, 1 - side, 0, bottom], [side, 1 - side, 1 - top, 1],
  ];
  for (const [u0, u1, v0, v1] of strips) {
    const upright = u1 - u0 < v1 - v0;
    const geometry = panel(upright ? 2 : 10, upright ? 7 : 2,
      (u, v) => sample(lerp(u0, u1, u), lerp(v0, v1, v)), thickness, reverse);
    f.mesh(geometry, finish, tint, 0, 0, 0);
    geometry.dispose();
  }
}

export function addGlazedCab(f, finish, paint, damaged) {
  const seal = 0x393b32;
  for (const [sample, depth, flip, broken] of [
    [frontWindow, [0, 0, -.032], false, damaged], [backWindow, [0, 0, .032], false, false],
  ]) {
    addWindowTrim(f, sample, depth, flip, finish, paint, [.036, .058, .067]);
    const gasket = (u, v) => sample(lerp(.036, .964, u), lerp(.058, .933, v));
    addWindowTrim(f, gasket, depth.map(value => value * .42), flip, 'rubber', seal, [.013, .026, .03]);
    if (broken) {
      for (const outline of shards) {
        const geometry = glassPatch(outline, (u, v) => {
          const [x, y, z] = gasket(u, v);
          return [x, y, z - .006];
        });
        f.mesh(geometry, 'cabinGlass', 0x7e9998, 0, 0, 0);
        geometry.dispose();
      }
    } else {
      const glass = panel(18, 9, (u, v) => {
        const [x, y, z] = gasket(u, v);
        return [x, y, z + depth[2] * .20];
      }, null, flip);
      f.mesh(glass, 'cabinGlass', 0x698080, 0, 0, 0);
      glass.dispose();
    }
  }
  for (const side of [-1, 1]) {
    for (const isFront of [true, false]) {
      const glass = isFront ? frontWindow : backWindow;
      const edge = panel(4, 13, (u, v) => {
        const corners = [
          glass((side > 0) === isFront ? 1 : 0, v),
          sideWindow(isFront ? 1 : 0, v, side),
        ];
        return corners[0].map((value, axis) => lerp(value, corners[1][axis], u));
      }, null, (side < 0) === isFront);
      f.mesh(edge, finish, paint, 0, 0, 0);
      edge.dispose();
    }
    const sample = (u, v) => sideWindow(u, v, side);
    const depth = [-side * .037, 0, 0];
    addWindowTrim(f, sample, depth, side > 0, finish, paint, [.062, .065, .084]);
    const gasket = (u, v) => sample(lerp(.062, .938, u), lerp(.065, .916, v));
    addWindowTrim(f, gasket, [-side * .016, 0, 0], side > 0, 'rubber', seal, [.026, .029, .03]);
    if (damaged && side < 0) {
      const geometry = glassPatch([[.03, .03], [.39, .03], [.30, .108], [.17, .09], [.125, .214], [.032, .39]], gasket);
      f.mesh(geometry, 'cabinGlass', 0x627978, 0, 0, 0);
      geometry.dispose();
    } else {
      const geometry = panel(18, 9, (u, v) => {
        const [x, y, z] = gasket(u, v);
        return [x - side * .006, y, z];
      }, null, side > 0);
      f.mesh(geometry, 'cabinGlass', 0x647c7c, 0, 0, 0);
      geometry.dispose();
    }
  }
}

// The bead, sidewall, load patch and tread are one continuous carcass.
function tire(resolution, treads) {
  const cross = [
    [-.119, .220, 0], [-.139, .278, 0], [-.144, .323, 0], [-.136, .351, 0],
    [-.113, .377, .7], [-.077, .386, 1], [-.063, .382, 1], [-.044, .388, 1],
    [0, .382, 1], [.044, .388, 1], [.063, .382, 1], [.077, .386, 1],
    [.113, .377, .7], [.136, .351, 0], [.144, .323, 0], [.139, .278, 0],
    [.119, .220, 0], [.103, .209, 0], [-.103, .209, 0],
  ];
  const points = [], uv = [], colors = [], indices = [];
  for (let ring = 0; ring < resolution; ring++) {
    const a = ring * TAU / resolution, c = Math.cos(a), s = Math.sin(a);
    const contact = smoothstep(-c, .895, 1);
    for (const [i, [w, base, strength]] of cross.entries()) {
      const treadPhase = treads * a + 23 * Math.abs(w) + (w < 0 ? .34 : -.34);
      const groove = (1 - smoothstep(Math.abs(Math.sin(treadPhase * .5)), .06, .55)) * strength;
      const radius = base - groove * .008;
      const squash = Math.max(0, -c - .86) * .079;
      points.push(w * (1 + contact * .065), radius * c + squash, radius * s);
      uv.push(ring / resolution, i / cross.length);
      const dirt = 1 + .20 * groove + .13 * contact + .18 * (1 - strength) * (Math.max(0, Math.sin(9 * a + w * 47)) ** 6);
      colors.push(dirt * 1.015, dirt, dirt * .94);
    }
  }
  for (let ring = 0; ring < resolution; ring++) {
    for (let i = 0; i < cross.length; i++) {
      const a = ring * cross.length + i;
      const b = ring * cross.length + ((i + 1) % cross.length);
      const c = ((ring + 1) % resolution) * cross.length + i;
      const d = ((ring + 1) % resolution) * cross.length + ((i + 1) % cross.length);
      indices.push(a, c, b, b, c, d);
    }
  }
  return buffer(points, indices, uv, colors);
}

function ventilatedRim() {
  const face = new THREE.Shape();
  face.absarc(0, 0, .207, 0, TAU, false);
  for (let hole = 0; hole < 8; hole++) {
    const a = TAU * hole / 8;
    const opening = new THREE.Path();
    const transform = ([radial, lateral]) => [
      radial * Math.cos(a) - lateral * Math.sin(a), radial * Math.sin(a) + lateral * Math.cos(a),
    ];
    const corners = [[.118, -.023], [.118, .023], [.143, .036], [.176, .035], [.187, .020],
      [.187, -.020], [.176, -.035], [.143, -.036]].map(transform);
    opening.moveTo(...corners[0]);
    for (const corner of corners.slice(1)) opening.lineTo(...corner);
    opening.closePath();
    face.holes.push(opening);
  }
  return new THREE.ExtrudeGeometry(face, {
    depth: .019, curveSegments: 16, bevelSize: .0025, bevelThickness: .0025, bevelSegments: 1,
  }).rotateY(Math.PI / 2).translate(.116, 0, 0);
}

const wreckTire = tire(96, 32);
const serviceTire = tire(72, 24);
const ventDisc = ventilatedRim();
const wheelRim = new THREE.LatheGeometry([
  [.198, -.124], [.217, -.133], [.225, -.132], [.228, -.121],
  [.222, -.106], [.217, .105], [.225, .121], [.225, .136],
  [.220, .144], [.209, .149], [.200, .143], [.196, .128], [.198, -.124],
].map(([r, w]) => new THREE.Vector2(r, w)), 32).rotateZ(-Math.PI / 2);
const hub = new THREE.CylinderGeometry(.070, .076, .044, 20).rotateZ(-Math.PI / 2);
const bolt = new THREE.CylinderGeometry(.017, .017, .015, 6).rotateZ(-Math.PI / 2);
const valve = new THREE.CylinderGeometry(.006, .009, .037, 8).rotateZ(-Math.PI / 2);

export function addPickupWheels(f, damaged) {
  for (const side of [-1, 1]) for (const axle of AXLES) {
    const x = side * .843;
    const mirror = side < 0 ? Math.PI : 0;
    f.mesh(damaged ? wreckTire : serviceTire, 'rubber', 0x30302c, x, WHEEL_HEIGHT, axle);
    f.mesh(wheelRim, 'metal', damaged ? 0x867d6b : 0x9b9a8f, x, WHEEL_HEIGHT, axle, 1, 1, 1, mirror);
    f.mesh(ventDisc, 'coatedSteel', damaged ? 0x4d4840 : 0x77766d, x, WHEEL_HEIGHT, axle, 1, 1, 1, mirror);
    f.mesh(hub, 'metal', 0x746f62, x + side * .142, WHEEL_HEIGHT, axle, 1, 1, 1, mirror);
    for (let i = 0; i < 6; i++) {
      const angle = i * TAU / 6;
      f.mesh(bolt, 'metal', 0x969084, x + side * .145,
        WHEEL_HEIGHT + Math.cos(angle) * .091, axle + Math.sin(angle) * .091);
    }
    f.mesh(valve, 'rubber', 0x49463e, x + side * .154, WHEEL_HEIGHT - .196, axle + .029, 1, 1, 1, mirror);
  }
}
