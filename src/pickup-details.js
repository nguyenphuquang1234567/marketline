import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { addTireTreads, streetLabel } from './street-details.js';

// Vehicle space uses +Z forward, with Y=0 at the tire contact plane.
const TAU = Math.PI * 2;
const CAB_BEAM = new RoundedBoxGeometry(2, 1, 2, 1, 0.16);
const STEERING_RIM = new THREE.TorusGeometry(.147, .015, 7, 20).rotateX(-.52);
const DRUM = new THREE.CylinderGeometry(1, 1, 1, 18);
const tireGeometry = new THREE.LatheGeometry([
  [0.209, -0.118], [0.267, -0.127], [0.336, -0.123], [0.373, -0.105],
  [0.391, -0.069], [0.392, 0.069], [0.374, 0.106], [0.337, 0.122],
  [0.266, 0.127], [0.209, 0.117],
].map(([radius, width]) => new THREE.Vector2(radius, width)), 32).rotateZ(Math.PI / 2);

function pressedSidePanel(axles, wheelY, damaged = false) {
  const outline = new THREE.Shape();
  outline.moveTo(-2.16, .49);
  for (const axle of axles) {
    for (let step = 0; step <= 12; step++) {
      const arc = Math.PI - .225 - (Math.PI - .45) * step / 12;
      outline.lineTo(axle + Math.cos(arc) * .432, wheelY + Math.sin(arc) * .432);
    }
  }
  outline.lineTo(2.12, .49);
  if (damaged) {
    // The buckled top stops short of the engine bay, leaving the wheel lip intact.
    outline.lineTo(2.08, .763);
    outline.lineTo(1.86, .852);
    outline.lineTo(1.70, .798);
    outline.lineTo(1.56, .879);
    outline.lineTo(1.41, .851);
    outline.lineTo(1.26, .926);
    outline.lineTo(1.09, .906);
    outline.lineTo(.92, 1.166);
  } else {
    outline.lineTo(2.15, 1.116);
    outline.lineTo(1.86, 1.16);
    outline.lineTo(1.07, 1.185);
  }
  outline.lineTo(-.3, 1.245);
  outline.lineTo(-.48, 1.109);
  outline.lineTo(-2.15, 1.109);
  outline.closePath();
  const panel = new THREE.ExtrudeGeometry(outline, {
    depth: .09, steps: 1, bevelEnabled: true,
    bevelSize: damaged ? .012 : .025, bevelThickness: .021, bevelSegments: 2,
  });
  return panel.translate(0, 0, -.045).rotateY(-Math.PI / 2);
}

function addEngineBay(f, rounded) {
  const beam = 0x504945;
  const steel = 0x827b6b;
  const oxide = 0x795747;
  const hose = 0x363832;

  rounded('rubber', 0x34342d, 0, .662, 1.53, 1.37, .073, 1.15, .029);
  rounded('coatedSteel', beam, 0, 1.006, .997, 1.54, .39, .106, .025);
  for (const side of [-1, 1]) {
    rounded('coatedSteel', beam, side * .591, .709, 1.542, .154, .17, 1.18, .030);
    f.pipe(side * .67, 1.119, 1.022, side * .506, .877, 2.051, .037, oxide, 'coatedSteel', CAB_BEAM);
    f.pipe(side * .615, .71, 1.455, side * .836, .426, 1.33, .055, beam, 'metal', CAB_BEAM);
  }

  // The cylinder head, exhaust runners and heat shield share the lower block.
  rounded('metal', 0x655e50, -.074, .828, 1.515, .565, .265, .692, .044);
  rounded('coatedSteel', steel, -.075, .995, 1.501, .478, .137, .594, .037);
  for (const side of [-1, 1]) {
    for (let bolt = 0; bolt < 4; bolt++) {
      const z = 1.285 + bolt * .14;
      f.pipe(-.074 + side * .197, 1.056, z, -.074 + side * .197, 1.078, z, .026, 0xa29882);
      f.pipe(-.074 + side * .247, .901, z, -.074 + side * .318, .811, z + .036, .034, oxide);
    }
  }
  for (let rib = 0; rib < 5; rib++) {
    f.box('metal', 0x918677, -.075 + (rib - 2) * .063, 1.068, 1.501, .027, .017, .441);
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
  for (const [tint, radius, points] of lines) {
    const curve = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point)));
    const tubing = new THREE.TubeGeometry(curve, 13, radius, 7, false);
    f.mesh(tubing, 'rubber', tint, 0, 0, 0);
    tubing.dispose();
  }

  // A strip of folded bonnet skin remains attached along the far side.
  const hood = new THREE.Shape();
  for (const [index, [x, z]] of [
    [.728, 1.059], [.252, 1.065], [.311, 1.241], [.232, 1.365], [.438, 1.461],
    [.333, 1.676], [.522, 1.804], [.573, 1.993], [.806, 2.075], [.832, 1.78], [.797, 1.36],
  ].entries()) {
    if (index === 0) hood.moveTo(x, z);
    else hood.lineTo(x, z);
  }
  hood.closePath();
  const folded = new THREE.ExtrudeGeometry(hood, {
    depth: .028, bevelEnabled: true, bevelSize: .005, bevelThickness: .004, bevelSegments: 1,
  }).rotateX(Math.PI / 2);
  const vertices = folded.attributes.position;
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i), z = vertices.getZ(i);
    vertices.setY(i, 1.198 + vertices.getY(i) + (1 - x) * .15 + Math.sin(z * 7.6) * .033);
  }
  folded.computeVertexNormals();
  f.mesh(folded, 'coatedSteel', 0x988a70, 0, 0, 0);
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

export function addPickupDetails(f, shade, color, index) {
  const damaged = index === 0;
  const finish = damaged ? 'burntSteel' : 'enamel';
  const paint = shade(color, damaged ? .74 : .88);
  const bright = shade(color, damaged ? .94 : 1.12);
  const rubber = 0x353632;
  const seal = 0x3b3b35;
  const glass = 0x4d5a59;
  const axles = [-1.37, 1.33];
  const wheelY = 0.392;
  const rounded = (material, tint, u, y, v, w, h, d, radius) => {
    const geometry = new RoundedBoxGeometry(w, h, d, 2, radius);
    f.mesh(geometry, material, tint, u, y, v);
    geometry.dispose();
  };
  const sheet = (material, tint, corners) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(corners.flat(), 3));
    const uv = [0, 0, 1, 0, 1, 1, 0, 1];
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv.slice(0, corners.length * 2), 2));
    geometry.setIndex(corners.length === 4 ? [0, 1, 2, 0, 2, 3] : [0, 1, 2]);
    geometry.computeVertexNormals();
    f.mesh(geometry, material, tint, 0, 0, 0);
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
    rounded('enamel', bright, 0, 1.125, 1.53, 1.69, .18, 1.34, .074);
  }
  rounded(finish, paint, 0, 1.007, -2.13, 1.76, .335, .14, .036);
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
    rounded('enamel', 0x9d4a30, side * 0.838, 0.949, -2.157, 0.122, 0.225, 0.099, 0.019);
    f.box('flat', 0xb6a37b, side * 0.839, 0.981, -2.211, 0.082, 0.041, 0.01);
    f.box('flat', 0xb68b4c, side * 0.911, 1.018, 1.988, 0.015, 0.037, 0.113);
  }

  const bodyPanel = pressedSidePanel(axles, wheelY);
  const tornPanel = damaged ? pressedSidePanel(axles, wheelY, true) : null;

  // The roof, A-pillars and sloping glazing form one cab rather than a box on the hood.
  rounded(finish, bright, 0, 1.854, 0.274, 1.596, 0.131, 1.253, 0.061);
  const windshield = [[-.728, 1.273, 1.041], [.728, 1.273, 1.041], [.691, 1.778, .86], [-.691, 1.778, .86]];
  if (damaged) {
    sheet('cabinGlass', glass, [windshield[0], [-.452, 1.273, 1.041], [-.641, 1.457, .975]]);
    sheet('cabinGlass', glass, [windshield[1], windshield[2], [.532, 1.778, .86], [.573, 1.572, .934]]);
  } else {
    sheet('cabinGlass', glass, windshield);
  }
  f.pipe(-.766, 1.264, 1.043, .766, 1.264, 1.043, .021, seal, 'rubber', CAB_BEAM);
  f.pipe(-.738, 1.783, .855, .738, 1.783, .855, .022, seal, 'rubber', CAB_BEAM);

  sheet('cabinGlass', glass, [[.722, 1.275, -.398], [-.722, 1.275, -.398], [-.695, 1.787, -.344], [.695, 1.787, -.344]]);
  rounded(finish, paint, 0, 1.179, -.418, 1.56, .171, .115, .035);
  f.pipe(-.75, 1.779, -.344, .75, 1.779, -.344, .023, seal, 'rubber', CAB_BEAM);

  // The tinted glazing exposes the dashboard, seats, and wheel from either side.
  rounded('rubber', 0x45433b, 0, 1.252, .863, 1.52, .118, .324, .043);
  rounded('rubber', 0x383a35, .402, 1.338, .772, .433, .083, .23, .036);
  rounded('rubber', 0x464439, 0, 1.009, .282, 1.5, .098, 1.38, .039);
  f.pipe(.408, 1.267, .766, .408, 1.405, .593, .029, 0x3d3e38, 'rubber');
  f.mesh(STEERING_RIM, 'rubber', 0x2a2e29, .408, 1.405, .593);
  f.box('rubber', 0x46463e, .408, 1.401, .596, .24, .043, .028);
  for (const side of [-1, 1]) {
    rounded('cloth', 0x736b58, side * .421, 1.152, .167, .477, .119, .45, .053);
    rounded('cloth', 0x655e4d, side * .421, 1.402, -.065, .453, .464, .125, .059);
    rounded('cloth', 0x5e5848, side * .421, 1.683, -.078, .208, .112, .108, .044);
    f.box('rubber', 0x48473e, side * .732, 1.145, .275, .105, .219, 1.287);
    if (damaged) {
      for (const rail of [-.059, .059]) {
        f.pipe(side * .421 + rail, 1.606, -.075, side * .421 + rail, 1.653, -.079, .010, 0x9c8e77);
      }
      rounded('cloth', 0x98896c, side * .421, 1.4, -.003, .267, .334, .022, .01);
      f.pipe(side * .583, 1.163, .128, side * .631, 1.639, -.321, .014, 0x8c7b62, 'cloth');
    }
  }
  f.box('rubber', 0x555247, 0, 1.167, .316, .195, .241, .633);
  f.pipe(0, 1.25, .435, 0, 1.397, .447, .012, 0x626158);
  rounded('rubber', 0x42433b, 0, 1.397, .447, .062, .049, .055, .02);
  for (const [u, end] of [[-0.71, -0.14], [0.05, 0.67]]) {
    f.pipe(u, 1.288, 1.048, end, 1.332, 1.032, 0.013, 0x363733, 'rubber');
  }
  rounded('coatedSteel', 0x4f5149, 0, .908, -1.336, 1.594, .065, 1.55, .021);
  for (let slat = -6; slat <= 6; slat++) {
    f.box('coatedSteel', 0x626358, slat * .119, .948, -1.34, .032, .017, 1.47);
  }

  for (const side of [-1, 1]) {
    const exposedSide = damaged && side === -1;
    f.mesh(exposedSide ? tornPanel : bodyPanel, finish,
      exposedSide ? 0xa29782 : paint, side * .836, 0, 0);
    rounded(finish, bright, side * 0.851, 1.122, -1.36, 0.134, 0.071, 1.53, 0.033);
    rounded('coatedSteel', paint, side * .735, .991, -1.37, .197, .163, .671, .038);
    f.box('rubber', seal, side * 0.905, 0.791, 0.342, 0.018, 0.018, 1.316);
    f.box('rubber', seal, side * 0.905, 1.008, -0.331, 0.016, 0.42, 0.017);
    f.box('rubber', seal, side * 0.905, 1.001, .988, .014, .412, .011);
    f.box('rubber', 0x514d43, side * .912, 1.143, -.117, .019, .062, .185);
    rounded('coatedSteel', shade(color, .79), side * .931, 1.148, -.117, .032, .039, .154, .012);
    if (!damaged) streetLabel(f, 'delivery', side * .906, 1.013, .376, .48, .214, side * Math.PI / 2);
    f.box('rubber', seal, side * .906, .691, .144, .018, .037, .929);
    f.box('metal', 0x767468, side * .913, .692, .144, .012, .010, .89);
    f.box('coatedSteel', paint, side * .907, .982, -1.508, .012, .163, .167);
    f.box('rubber', seal, side * .914, .981, -1.448, .006, .028, .035);
    f.pipe(side * .788, 1.234, 1.044, side * .744, 1.818, .838, .045, color, finish, CAB_BEAM);
    f.pipe(side * .788, 1.234, -.419, side * .744, 1.818, -.337, .057, color, finish, CAB_BEAM);
    f.pipe(side * .808, 1.251, -.396, side * .812, 1.251, 1.014, .023, seal, 'rubber', CAB_BEAM);
    f.pipe(side * .77, 1.781, -.33, side * .773, 1.781, .83, .026, seal, 'rubber', CAB_BEAM);
    if (exposedSide) {
      sheet('cabinGlass', glass, [[-.821, 1.266, -.389], [-.824, 1.266, -.125], [-.797, 1.49, -.366]]);
    } else {
      sheet('cabinGlass', glass, [[side * .821, 1.266, -.389], [side * .826, 1.266, 1.005],
        [side * .766, 1.78, .816], [side * .766, 1.78, -.338]]);
    }
    f.pipe(side * .823, 1.264, -.188, side * .769, 1.783, -.188, .021, seal, 'rubber', CAB_BEAM);
    f.pipe(side * .824, 1.269, .646, side * .769, 1.783, .646, .014, seal, 'rubber', CAB_BEAM);
    if (!exposedSide) {
      f.pipe(side * .852, 1.37, .791, side * 1.027, 1.418, .824, .028, seal, 'rubber');
      rounded('enamel', bright, side * 1.046, 1.442, .825, .193, .123, .125, .037);
      f.box('autoGlass', 0x737871, side * 1.047, 1.449, .758, .146, .074, .015);
    }
    for (const axle of axles) {
      f.mesh(tireGeometry, 'rubber', rubber, side * 0.886, wheelY, axle);
      addTireTreads(f, side * .886, wheelY, axle);
      f.pipe(side * 0.777, wheelY, axle, side * 1.005, wheelY, axle, 0.227, 0x77756d, 'metal', DRUM);
      f.pipe(side * 1.003, wheelY, axle, side * 1.017, wheelY, axle, 0.182, 0x4c4e47, 'metal', DRUM);
      f.pipe(side * 1.01, wheelY, axle, side * 1.031, wheelY, axle, 0.082, 0x77786e, 'metal', DRUM);
      for (let lug = 0; lug < 6; lug++) {
        const a = lug * TAU / 6;
        const yy = wheelY + Math.sin(a) * 0.127;
        const zz = axle + Math.cos(a) * 0.127;
        f.pipe(side * 1.013, yy, zz, side * 1.023, yy, zz, 0.018, 0x9a978b);
      }
    }
  }
  bodyPanel.dispose();
  tornPanel?.dispose();
}
