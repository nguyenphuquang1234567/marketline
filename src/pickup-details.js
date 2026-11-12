import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { streetLabel } from './street-details.js';
import { addGlazedCab, addPickupDecks, addPickupWheels, addStampedBody, addWheelArchReturns, panel } from './pickup-shell.js';

// Vehicle space uses +Z forward, with Y=0 at the tire contact plane.
const TAU = Math.PI * 2;
const { lerp, smoothstep } = THREE.MathUtils;
const CAB_BEAM = new RoundedBoxGeometry(2, 1, 2, 1, 0.16);
const STEERING_RIM = new THREE.TorusGeometry(.147, .015, 7, 20).rotateX(-.52);

function tube(f, points, radius, material, tint) {
  const path = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point)));
  const geometry = new THREE.TubeGeometry(path, 16, radius, 7, false);
  f.mesh(geometry, material, tint, 0, 0, 0);
  geometry.dispose();
}

function addEngineBay(f, rounded) {
  const beam = 0x4b4640;
  const steel = 0x67635a;
  const oxide = 0x6b5144;
  const hose = 0x363832;

  rounded('rubber', 0x34342d, 0, .662, 1.53, 1.37, .073, 1.15, .029);
  rounded('coatedSteel', beam, 0, 1.006, .997, 1.54, .39, .106, .025);
  for (const side of [-1, 1]) {
    rounded('coatedSteel', beam, side * .591, .709, 1.542, .154, .17, 1.18, .030);
    const innerWing = panel(28, 9, (u, v) => {
      const z = lerp(1.042, 2.069, u);
      const arch = .215 * Math.exp(-(((z - 1.324) / .36) ** 4));
      const rib = .009 * Math.sin(v * Math.PI * 7) * Math.sin(u * Math.PI);
      const x = lerp(.505 + .011 * Math.cos(z * 5), .773 - .044 * u, v);
      const lip = .054 * smoothstep(v, .76, .99);
      return [side * x, .757 + arch + .069 * v + lip + rib, z];
    }, [0, -.015, 0], side < 0);
    f.mesh(innerWing, 'coatedSteel', side < 0 ? 0x675c4d : beam, 0, 0, 0);
    innerWing.dispose();
    f.pipe(side * .615, .71, 1.455, side * .803, .427, 1.33, .035, beam, 'metal', CAB_BEAM);
    for (const z of [1.14, 1.43, 1.84]) {
      const y = .879 + .215 * Math.exp(-(((z - 1.324) / .36) ** 4));
      const x = side * (.760 - .044 * (z - 1.042));
      f.pipe(x, y - .007, z, x, y + .014, z, .011, steel);
    }
  }

  // The cylinder head, exhaust runners and heat shield share the lower block.
  rounded('metal', 0x504b42, -.074, .828, 1.515, .565, .265, .692, .044);
  rounded('coatedSteel', steel, -.075, .995, 1.501, .478, .137, .594, .037);
  for (const side of [-1, 1]) {
    for (let bolt = 0; bolt < 4; bolt++) {
      const z = 1.285 + bolt * .14;
      f.pipe(-.074 + side * .197, 1.055, z, -.074 + side * .197, 1.074, z, .019, 0x867b6c);
      tube(f, [[-.074 + side * .247, .900, z], [-.074 + side * .306, .877, z],
        [-.074 + side * .327, .816, z + .029], [-.074 + side * .315, .775, z + .077]], .022, 'metal', oxide);
    }
  }
  for (let rib = 0; rib < 5; rib++) {
    f.box('metal', 0x7a7467, -.075 + (rib - 2) * .063, 1.064, 1.501, .019, .017, .423);
  }
  f.pipe(-.105, 1.079, 1.673, -.105, 1.113, 1.673, .047, hose, 'rubber');
  rounded('coatedSteel', 0x69665b, -.478, .908, 1.533, .204, .082, .584, .029);

  // Visible structure behind the absent grille rather than a solid black panel.
  rounded('coatedSteel', 0x655849, .028, .904, 2.025, 1.328, .349, .105, .025);
  f.box('rubber', 0x30342e, .017, .911, 2.083, 1.153, .291, .012);
  for (let fin = 0; fin < 11; fin++) {
    f.box('metal', steel, .017, .791 + fin * .024, 2.094, 1.135, .009, .023);
  }
  for (const x of [-.512, .549]) {
    f.box('coatedSteel', beam, x, .918, 2.111, .05, .316, .038);
  }
  f.pipe(.03, .911, 1.878, .03, .911, 1.98, .081, beam);
  const fanShroud = new THREE.TorusGeometry(.148, .018, 7, 22);
  f.mesh(fanShroud, 'rubber', hose, .03, .911, 1.948);
  fanShroud.dispose();
  for (let blade = 0; blade < 5; blade++) {
    const angle = blade * TAU / 5;
    const fanBlade = new RoundedBoxGeometry(.035, .11, .017, 1, .007).rotateZ(angle + .35);
    f.mesh(fanBlade, 'rubber', hose, .03 + Math.sin(-angle) * .091, .911 + Math.cos(angle) * .091, 1.948);
    fanBlade.dispose();
  }

  rounded('rubber', 0x44453d, .508, .925, 1.277, .289, .216, .314, .022);
  f.box('coatedSteel', 0x646153, .508, 1.034, 1.275, .27, .031, .307);
  f.pipe(.426, 1.046, 1.373, .426, 1.08, 1.373, .032, 0x9f5c42);
  f.pipe(.589, 1.046, 1.194, .589, 1.08, 1.194, .032, steel);
  rounded('rubber', 0x988c68, .483, .962, 1.824, .209, .181, .224, .039);
  f.pipe(.481, 1.055, 1.818, .481, 1.085, 1.818, .058, 0x635844, 'rubber');

  const lines = [
    [hose, .041, [[.13, 1.034, 1.78], [.212, 1.114, 1.876], [.44, 1.092, 1.935], [.485, 1.041, 2.005]]],
    [hose, .024, [[-.319, .951, 1.367], [-.518, 1.027, 1.414], [-.538, 1.061, 1.78], [-.422, .961, 1.963]]],
    [0x82604b, .011, [[.421, 1.071, 1.373], [.30, 1.122, 1.265], [.194, 1.124, 1.187], [.02, 1.05, 1.044]]],
  ];
  for (const [tint, radius, points] of lines) tube(f, points, radius, 'rubber', tint);

  // A strip of folded bonnet skin remains attached along the far side.
  const folded = panel(42, 10, (u, v) => {
    const z = lerp(1.065, 2.073, u);
    const irregular = .055 * Math.sin(u * 29.8) + .025 * Math.sin(u * 60.9);
    const tear = lerp(.236, .676, smoothstep(u, .11, .96)) + irregular * Math.sin(u * Math.PI);
    const curl = (.056 + .025 * Math.sin(u * 17)) * (1 - smoothstep(v, 0, .49));
    const roll = .018 * Math.sin(v * Math.PI) + .013 * Math.sin(v * 12.7 + z * 22.6);
    return [lerp(tear, .847 - .036 * u, v), 1.197 - .067 * smoothstep(u, .36, 1) + curl + roll, z];
  }, [0, -.012, 0], false, ([, , z], u, v, inside) => {
    const dark = inside ? .66 : .79 + .21 * smoothstep(v, .06, .75) - .12 * Math.sin(z * 8) ** 2;
    return [dark, dark * .93, dark * .86];
  });
  f.mesh(folded, 'burntSteel', 0x78786d, 0, 0, 0);
  folded.dispose();

  // Spring and damper can be seen in the open near-side wheel well.
  const spring = [];
  for (let i = 0; i <= 64; i++) {
    const t = i / 64;
    const phase = t * TAU * 5.5;
    spring.push(new THREE.Vector3(-.703 + .046 * Math.cos(phase), .51 + t * .33, 1.317 + .046 * Math.sin(phase)));
  }
  const coil = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(spring), 64, .011, 7, false);
  f.mesh(coil, 'metal', 0x8a6f54, 0, 0, 0);
  coil.dispose();
  f.pipe(-.703, .468, 1.317, -.703, .868, 1.317, .022, steel);
}

function addCabInterior(f, rounded, damaged) {
  const dashboard = panel(20, 7, (u, v) => {
    const t = u * 2 - 1;
    const curve = .025 * (1 - t ** 2);
    const hood = .076 * Math.exp(-(((t - .52) / .27) ** 4)) * Math.sin(v * Math.PI) ** 2;
    return [t * .752, 1.253 + curve + .021 * v + hood, lerp(.642 + .049 * t ** 2, 1.008, v)];
  }, [0, -.072, 0], true);
  f.mesh(dashboard, 'rubber', 0x3f3e36, 0, 0, 0);
  dashboard.dispose();
  rounded('rubber', 0x464439, 0, 1.009, .282, 1.5, .098, 1.38, .039);
  f.pipe(.408, 1.228, .764, .408, 1.383, .592, .024, 0x3d3e38, 'rubber');
  f.mesh(STEERING_RIM, 'rubber', 0x2a2e29, .408, 1.383, .592);
  for (const side of [-1, 1]) {
    f.pipe(.408, 1.374, .589, .408 + side * .134, 1.408, .583, .015, 0x49483d, 'rubber');
  }
  rounded('rubber', 0x48473c, .408, 1.375, .573, .094, .072, .037, .019);
  f.pipe(.381, 1.332, .626, .294, 1.373, .613, .008, 0x4b4940);
  for (let i = 0; i < 5; i++) f.box('rubber', 0x30312a, -.078 + i * .036, 1.281, .887, .021, .007, .059);

  const fabric = ([, , z], u, v, inside) => {
    const seam = .81 + .19 * smoothstep(Math.abs((u - .5) * 2), .48, .57);
    const folds = 1 + .08 * Math.sin(z * 144 + u * 26) * Math.sin(u * Math.PI) ** 2;
    const discoloration = damaged ? .25 * Math.exp(-(((u - .28) / .18) ** 2) - ((v - .69) / .25) ** 2) : 0;
    const value = (inside ? .71 : seam * folds) * (1 - discoloration);
    return [value, value * .98, value * .93];
  };
  const seatBack = (u, v) => {
    const t = u * 2 - 1;
    const width = lerp(.223, .191, v) - .030 * (1 - smoothstep(v, 0, .11) + smoothstep(v, .84, 1));
    const bolster = .049 * Math.exp(-(((Math.abs(t) - .74) / .23) ** 2)) * Math.sin(v * Math.PI) ** .7;
    return [t * width, .453 * v, .044 - .142 * v + .027 * (1 - t ** 2) + bolster];
  };
  const back = panel(16, 12, seatBack, [0, 0, -.096], false, fabric);
  const pad = panel(16, 8, (u, v) => {
    const t = u * 2 - 1;
    const width = .226 - .041 * (smoothstep(v, .78, 1) + .53 * (1 - smoothstep(v, 0, .16)));
    const bolster = .034 * Math.exp(-(((Math.abs(t) - .70) / .25) ** 2)) * Math.sin(v * Math.PI) ** .7;
    return [t * width, .058 * Math.sin(v * Math.PI) + bolster + .021 * v, lerp(-.025, .405, v)];
  }, [0, -.062, 0], true, fabric);
  for (const side of [-1, 1]) {
    const x = side * .421;
    f.mesh(back, 'cloth', damaged ? 0x6e6657 : 0x6e7066, x, 1.154, .012, 1, 1, 1, 0, .45, .48);
    f.mesh(pad, 'cloth', damaged ? 0x746a58 : 0x73766a, x, 1.142, .033, 1, 1, 1, 0, .44, .44);
    for (const offset of [-.055, .055]) f.pipe(x + offset, 1.59, -.094, x + offset, 1.65, -.105, .008, 0x887f70);
    rounded('cloth', damaged ? 0x665d50 : 0x5b5c53, x, 1.683, -.106, .214, .115, .112, .052);
    f.box('rubber', 0x48473e, side * .732, 1.145, .275, .105, .219, 1.287);
    const strap = panel(2, 14, (u, v) => {
      const sag = Math.sin(v * Math.PI);
      return [side * (lerp(.621, .736, v) - .027 * sag) + (u - .5) * .040, lerp(1.116, 1.638, v),
        lerp(.030, -.314, v) - .050 * sag + .014 * (u - .5)];
    }, [0, 0, -.003]);
    f.mesh(strap, 'cloth', damaged ? 0x6b6050 : 0x42423a, 0, 0, 0);
    strap.dispose();
    f.box('rubber', 0x423c35, side * .196, 1.196, .167, .054, .069, .034);
    f.box('enamel', 0x775047, side * .196, 1.233, .167, .037, .006, .022);
  }
  back.dispose();
  pad.dispose();

  rounded('rubber', 0x535044, 0, 1.148, .324, .192, .208, .625, .030);
  f.pipe(0, 1.251, .435, 0, 1.367, .424, .010, 0x686257);
  rounded('rubber', 0x414139, 0, 1.367, .424, .053, .041, .051, .019);
  for (const [u, end] of [[-.704, -.148], [.053, .654]]) {
    f.pipe(u, 1.277, 1.054, end, 1.316, 1.053, .009, 0x363733, 'rubber');
  }
}

export function addPickupDetails(f, shade, color, index) {
  const damaged = index === 0;
  const finish = damaged ? 'burntSteel' : 'enamel';
  const paint = shade(color, damaged ? .74 : .88);
  const bright = shade(color, damaged ? .94 : 1.12);
  const seal = 0x3b3b35;
  const rounded = (material, tint, u, y, v, w, h, d, radius) => {
    const geometry = new RoundedBoxGeometry(w, h, d, 1, Math.min(radius, Math.min(w, h, d) * .49));
    f.mesh(geometry, material, tint, u, y, v);
    geometry.dispose();
  };
  // Narrow inner chassis leaves room for recessed tire wells in the outer panels.
  rounded('rubber', 0x4c4b43, 0, 0.52, 0.02, 1.21, 0.28, 4.30, 0.045);
  rounded('coatedSteel', paint, 0, .816, -1.34, 1.66, .126, 1.62, .036);
  if (damaged) {
    rounded(finish, paint, 0, .91, .189, 1.66, .30, 1.422, .068);
    addEngineBay(f, rounded);
  } else {
    rounded('enamel', paint, 0, .91, .81, 1.66, .30, 2.71, .068);
  }
  const tailgate = panel(24, 11, (u, v) => {
    const t = u * 2 - 1;
    const edges = smoothstep(Math.abs(t), .91, 1);
    const recess = (1 - smoothstep(Math.abs(t), .77, .86)) * smoothstep(v, .19, .29) * (1 - smoothstep(v, .72, .82));
    const impact = damaged ? .018 * Math.exp(-(((t + .49) / .22) ** 2) - ((v - .54) / .34) ** 2) : 0;
    return [t * .862, lerp(.819, 1.126, v) - .010 * edges * v,
      -2.184 + edges * .032 + recess * .025 + impact - .009 * smoothstep(v, .84, .98)];
  }, [0, 0, .043], true);
  f.mesh(tailgate, finish, paint, 0, 0, 0);
  tailgate.dispose();
  rounded('coatedSteel', paint, 0, .801, -2.136, 1.68, .065, .087, .013);
  rounded('coatedSteel', paint, 0, .833, -2.192, .361, .129, .038, .016);
  rounded('rubber', seal, 0, 1.09, -2.203, .173, .053, .016, .007);
  f.box('coatedSteel', bright, 0, 1.09, -2.215, .135, .019, .01);
  rounded('coatedSteel', 0x5c5c53, 0, 0.682, -2.205, 1.87, 0.137, 0.19, 0.048);
  if (damaged) {
    rounded('coatedSteel', 0x6c6252, .28, .665, 2.168, 1.34, .151, .19, .039);
    const bentBumper = new RoundedBoxGeometry(.65, .111, .185, 2, .029).rotateZ(.235).rotateY(-.16);
    f.mesh(bentBumper, 'coatedSteel', 0x736654, -.649, .582, 2.165);
    bentBumper.dispose();
    f.pipe(-.317, .642, 2.14, -.821, .545, 2.178, .023, 0x98735a, 'coatedSteel', CAB_BEAM);
  } else {
    rounded('coatedSteel', 0x66675d, 0, .691, 2.205, 1.94, .16, .21, .048);
    rounded('rubber', seal, 0, .989, 2.185, 1.17, .232, .082, .028);
    for (let row = 0; row < 5; row++) {
      f.box('metal', 0x74766b, 0, .913 + row * .039, 2.23, 1.105, .014, .028);
    }
    f.box('metal', 0x8d8a80, 0, .989, 2.247, .13, .066, .012);
    f.box('flat', 0xc2b899, .06, .69, 2.321, .316, .104, .013);
    streetLabel(f, 'plate' + index, .06, .69, 2.329, .307, .095);
  }
  f.box('flat', 0xc2b899, .08, .83, -2.217, .316, .104, .013);
  streetLabel(f, 'plate' + index, .08, .83, -2.225, .307, .095, Math.PI);
  for (const offset of [-.136, .136]) {
    if (!damaged) f.box('metal', 0x737067, .06 + offset, .726, 2.331, .01, .01, .004);
    f.box('metal', 0x737067, .08 + offset, .866, -2.227, .01, .01, .004);
  }
  for (const side of [-1, 1]) {
    if (!damaged || side === 1) {
      rounded('rubber', 0x3a3b35, side * .719, 1.018, 2.176, .325, .196, .108, .027);
      rounded('metal', 0x999484, side * .719, 1.018, 2.202, .301, .171, .075, .023);
      rounded('autoGlass', 0xaca799, side * .719, 1.018, 2.236, .274, .145, .024, .010);
      for (let flute = -5; flute <= 5; flute++) {
        f.box('autoGlass', 0xb6b1a1, side * .719 + flute * .021, 1.018, 2.25, .004, .118, .006);
      }
      f.box('enamel', 0xb37e39, side * .844, .949, 2.231, .048, .035, .029);
    } else {
      rounded('rubber', 0x3a3b35, -.711, .993, 2.073, .321, .184, .129, .034);
      rounded('coatedSteel', 0x7d6653, -.704, .969, 2.133, .271, .069, .028, .012);
      f.pipe(-.75, .964, 2.14, -.722, .931, 2.187, .008, 0x78674c, 'rubber');
      f.pipe(-.722, .931, 2.187, -.671, .908, 2.162, .008, 0x78674c, 'rubber');
    }
    rounded('rubber', 0x484037, side * .836, .943, -2.147, .123, .208, .092, .020);
    rounded('enamel', 0x91452f, side * .835, .944, -2.191, .102, .186, .035, .012);
    f.box('flat', 0xb6a37b, side * .835, .967, -2.211, .079, .036, .008);
    for (const y of [.893, .913, .996, 1.014]) {
      f.box('enamel', 0x82432e, side * .835, y, -2.21, .081, .004, .005);
    }
    if (!damaged || side > 0) f.box('flat', 0xb68b4c, side * .848, 1.018, 1.988, .022, .037, .113);
  }

  addStampedBody(f, finish, paint, damaged);
  addWheelArchReturns(f, finish, paint, damaged);
  addPickupDecks(f, finish, bright, damaged);
  addGlazedCab(f, finish, paint, damaged);

  addCabInterior(f, rounded, damaged);

  for (const side of [-1, 1]) {
    const exposedSide = damaged && side === -1;
    // Handles and locks mount into recessed plates on the independently stamped doors.
    rounded('rubber', 0x3a3830, side * .879, 1.138, -.154, .020, .061, .164, .009);
    rounded('coatedSteel', shade(color, .72), side * .891, 1.142, -.155, .021, .023, .116, .007);
    f.pipe(side * .888, 1.137, -.243, side * .904, 1.137, -.243, .010, 0x837b68);
    if (!damaged) streetLabel(f, 'delivery', side * .905, 1.027, .356, .38, .16, side * Math.PI / 2);
    f.box('rubber', seal, side * .842, .655, .257, .019, .036, 1.144);
    f.box('metal', 0x736e61, side * .853, .655, .257, .015, .007, 1.108);
    rounded('coatedSteel', paint, side * .850, .984, -1.57, .019, .133, .147, .008);
    f.box('rubber', seal, side * .860, .982, -1.519, .005, .017, .018);
    if (!exposedSide) {
      f.pipe(side * .852, 1.37, .791, side * 1.027, 1.418, .824, .028, seal, 'rubber');
      rounded('enamel', bright, side * 1.046, 1.442, .825, .193, .123, .125, .037);
      f.box('autoGlass', 0x737871, side * 1.047, 1.449, .758, .146, .074, .015);
    }
  }
  addPickupWheels(f, damaged);
}
