import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const palette = ['#96694f', '#a47859', '#8e614c', '#a27862', '#a67758', '#946d55'];
const roundProfile = (points, segments = 16) =>
  new THREE.LatheGeometry(points.map(([radius, height]) => new THREE.Vector2(radius, height)), segments);
const teaGlass = roundProfile([[0, 0], [.78, 0], [.82, .08], [1, .92], [1, 1],
  [.89, 1], [.88, .87], [.68, .12], [0, .12]]);
const tin = roundProfile([[0, 0], [.93, 0], [1, .045], [1, .95], [.91, .98], [0, .98]]);
const kettle = roundProfile([[0, 0], [.42, 0], [.59, .09], [.96, .24], [1, .4],
  [.87, .56], [.64, .66], [.47, .76], [.53, .83], [.36, .94], [.14, .94], [.1, 1], [0, 1]]);
const kettleHandle = new THREE.TorusGeometry(.104, .012, 6, 18);
const lampShade = roundProfile([[1, 0], [.97, .02], [.49, .46], [.17, .94], [.15, 1],
  [.13, 1], [.14, .94], [.45, .44], [.92, .02], [.95, 0]], 24);
const rugPlane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

function noise(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function surface(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return { canvas, context: canvas.getContext('2d') };
}

function material(canvas, roughness, repeat = false) {
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  if (repeat) map.wrapS = map.wrapT = THREE.RepeatWrapping;
  return new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness });
}

function tileSurface(seed) {
  // Four courses per metre, with pigment variation and a narrower, worn grout line.
  const { canvas, context: ctx } = surface(512, 512);
  const random = noise(seed);
  ctx.fillStyle = '#625850';
  ctx.fillRect(0, 0, 512, 512);
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
    const x = col * 128, y = row * 128;
    ctx.fillStyle = palette[Math.floor(random() * palette.length)];
    ctx.fillRect(x + 2, y + 2, 124, 124);
    const glaze = ctx.createLinearGradient(x, y, x + 128, y + 128);
    glaze.addColorStop(0, 'rgba(254,227,183,.26)');
    glaze.addColorStop(.53, 'rgba(255,237,194,0)');
    glaze.addColorStop(1, 'rgba(47,30,24,.23)');
    ctx.fillStyle = glaze;
    ctx.fillRect(x + 2, y + 2, 124, 124);
    ctx.fillStyle = 'rgba(50,32,29,.2)';
    ctx.fillRect(x + 3, y + 123, 121, 3);
    for (let grain = 0; grain < 420; grain++) {
      ctx.fillStyle = random() < .44 ? 'rgba(45,31,26,.17)' : 'rgba(232,207,172,.17)';
      ctx.fillRect(x + 3 + random() * 119, y + 3 + random() * 119, 1 + random() * 3, 1 + random() * 1.8);
    }
  }
  return material(canvas, .74, true);
}

function rugSurface(seed) {
  const { canvas, context: ctx } = surface(256, 768);
  const random = noise(seed);
  ctx.fillStyle = '#814b3a';
  ctx.fillRect(0, 0, 256, 768);
  for (const [inset, ink, size] of [[9, '#3e4740', 10], [24, '#c19e6c', 3], [32, '#4e6559', 5], [42, '#b8926c', 3]]) {
    ctx.lineWidth = size;
    ctx.strokeStyle = ink;
    ctx.strokeRect(inset, inset, 256 - inset * 2, 768 - inset * 2);
  }
  for (let row = 0; row < 5; row++) {
    const cy = 104 + row * 140;
    for (const [radius, ink] of [[72, '#b99169'], [62, '#635848'], [47, '#9e684e'], [29, '#b9a175'], [16, '#626757']]) {
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.moveTo(128, cy - radius);
      ctx.lineTo(128 + radius * 1.08, cy);
      ctx.lineTo(128, cy + radius);
      ctx.lineTo(128 - radius * 1.08, cy);
      ctx.closePath();
      ctx.fill();
    }
  }
  for (let grain = 0; grain < 17000; grain++) {
    ctx.fillStyle = random() < .52 ? 'rgba(52,31,23,.17)' : 'rgba(218,187,147,.19)';
    ctx.fillRect(random() * 255, random() * 767, 1 + random() * 2.1, 1);
  }
  return material(canvas, .98);
}

function menuSurface(seed) {
  const { canvas, context: ctx } = surface(384, 480);
  const random = noise(seed);
  ctx.fillStyle = '#373c35';
  ctx.fillRect(0, 0, 384, 480);
  for (let grain = 0; grain < 3100; grain++) {
    ctx.fillStyle = grain % 5 === 0 ? 'rgba(23,24,19,.26)' : 'rgba(189,181,149,.10)';
    ctx.fillRect(random() * 382, random() * 477, 1 + random() * 7, 1 + random() * 2);
  }
  ctx.strokeStyle = '#afaa84';
  ctx.lineWidth = 2;
  ctx.strokeRect(18, 18, 348, 444);
  ctx.fillStyle = '#dad0ad';
  ctx.textAlign = 'center';
  ctx.font = 'bold 33px Georgia, serif';
  ctx.fillText('THÉ & MENTHE', 192, 91);
  ctx.font = '32px Georgia, serif';
  ctx.fillText('شاي بالنعناع', 192, 139);
  ctx.beginPath();
  ctx.moveTo(49, 169);
  ctx.lineTo(335, 169);
  ctx.stroke();
  ctx.font = '29px Georgia, serif';
  ['Thé à la menthe', 'Thé aux pignons', 'Café noir', 'Infusion de verveine']
    .forEach((label, index) => ctx.fillText(label, 192, 225 + index * 53));
  return material(canvas, .96);
}

export function createShopMaterials(seed) {
  return {
    shopTile: tileSurface(seed ^ 0x8ec78),
    shopRug: rugSurface(seed ^ 0x19d73),
    shopMenu: menuSurface(seed ^ 0x92bc1),
  };
}

function archProfile(opening, depth, spring, rise) {
  const { span } = opening;
  const radius = span / 2;
  const profile = new THREE.Shape();
  profile.moveTo(-radius, spring);
  for (let i = 1; i <= 22; i++) {
    const angle = Math.PI * (1 - i / 22);
    profile.lineTo(Math.cos(angle) * radius, spring + Math.sin(angle) * rise);
  }
  profile.lineTo(radius, 3.02);
  profile.lineTo(-radius, 3.02);
  profile.closePath();
  return new THREE.ExtrudeGeometry(profile, { depth, bevelEnabled: false }).translate(0, 0, -depth / 2);
}

function partition(frame, width, z) {
  const spring = 1.81, rise = .78, depth = .27;
  const openings = [{ x: -width * .277, span: 3.18 }, { x: width * .219, span: 3.42 }];
  let previous = -width / 2 + .235;
  for (const opening of [...openings, { x: width / 2 - .235, span: 0 }]) {
    const edge = opening.x - opening.span / 2;
    const w = edge - previous, x = (edge + previous) / 2;
    frame.box('plaster', 0xc6ac89, x, 1.526, z, w, 2.98, depth);
    frame.box('brick', 0x8d9380, x, .348, z, w, .625, depth + .015);
    frame.body(x, 1.526, z, w, 2.98, depth);
    previous = opening.x + opening.span / 2;
  }
  for (const opening of openings) {
    const { x, span } = opening;
    const geometry = archProfile(opening, depth, spring, rise);
    frame.mesh(geometry, 'plaster', 0xc6ac89, x, 0, z);
    geometry.dispose();
    // Register the actual aperture with the same wall thickness as the wings.
    const slices = 18;
    const radius = span / 2;
    for (let i = 0; i < slices; i++) {
      const a = -radius + span * i / slices, b = -radius + span * (i + 1) / slices;
      const sample = Math.abs(a) > Math.abs(b) ? a : b;
      const base = spring + rise * Math.sqrt(Math.max(0, 1 - (sample / radius) ** 2));
      frame.body(x + (a + b) / 2, (base + 3.02) / 2, z, b - a, 3.02 - base, depth);
    }
    // Smooth limestone beads trace both reveals, with block joints caught in the light.
    for (const side of [-1, 1]) {
      const edge = x + side * (radius + .035);
      for (const face of [-1, 1]) {
        frame.box('limestone', 0xe2c59f, edge, .94, z + face * .143, .071, 1.749, .049);
        frame.box('limestone', 0xd2b58b, edge, .169, z + face * .162, .129, .206, .080);
        frame.box('limestone', 0xe0c29c, edge, spring - .012, z + face * .157, .162, .11, .103);
      }
    }
    for (let segment = 0; segment < 14; segment++) {
      const a = segment * Math.PI / 14, b = (segment + 1) * Math.PI / 14;
      for (const face of [-1, 1]) {
        const f = z + face * .15;
        frame.pipe(x + Math.cos(a) * (radius + .031), spring + Math.sin(a) * (rise + .031), f,
          x + Math.cos(b) * (radius + .031), spring + Math.sin(b) * (rise + .031), f,
          .028, segment % 3 === 0 ? 0xdec6a6 : 0xe4c8a5, 'limestone');
      }
    }
  }
}

function pendant(frame, x, z, lampY, workshop = false) {
  frame.box('metal', 0x55544b, x, 2.958, z, .155, .065, .155);
  frame.pipe(x, lampY + .13, z, x, 2.925, z, .009, 0x5a5144);
  if (workshop) {
    frame.box('coatedSteel', 0x8f887a, x, lampY + .058, z, .39, .115, 1.3);
    frame.box('lantern', 0xffeed7, x, lampY, z, .275, .024, 1.19);
    return;
  }
  frame.mesh(lampShade, 'coatedSteel', 0x575747, x, lampY + .035, z, .292, .151, .292);
  frame.pipe(x, lampY, z, x, lampY + .04, z, .149, 0xffe8af, 'lantern');
}

function teaCounter(frame, x, z) {
  frame.box('wood', 0x785239, x, .433, z, .84, .794, 3.38);
  frame.box('wood', 0xa78255, x, .866, z, .97, .082, 3.53);
  frame.box('wood', 0x876040, x + .43, .178, z, .049, .134, 3.37);
  frame.body(x, .46, z, .97, .92, 3.53, 'wood');
  for (let panel = 0; panel < 5; panel++) {
    const at = z + (panel - 2) * .628;
    frame.box('wood', 0x62402c, x + .431, .467, at, .023, .386, .52);
    frame.box('wood', panel % 2 ? 0x94613d : 0x885637, x + .445, .469, at, .019, .332, .473);
  }
  // Small raised tray and swept vessel details read as a tea counter through the door.
  const trayZ = z + .68;
  frame.pipe(x + .09, .922, trayZ, x + .09, .941, trayZ, .34, 0xa39b83, 'metal');
  frame.mesh(kettle, 'metal', 0xa99a77, x + .025, .94, trayZ, .14, .235, .14);
  frame.mesh(kettleHandle, 'metal', 0x7c6d57, x - .14, 1.084, trayZ, .72, .76, .72);
  frame.pipe(x + .104, 1.039, trayZ, x + .221, 1.080, trayZ, .024, 0xad9a70);
  frame.pipe(x + .221, 1.080, trayZ, x + .257, 1.132, trayZ, .018, 0xad9a70);
  for (const [dx, dz] of [[.22, .16], [.11, .23], [.01, .17], [-.065, -.20]]) {
    frame.mesh(teaGlass, 'glass', 0xc5a06d, x + dx, .94, trayZ + dz, .037, .089, .037);
  }
  for (let i = 0; i < 4; i++) {
    const offset = z - 1.31 + i * .29;
    frame.mesh(tin, 'coatedSteel', [0x63837b, 0xb67c57, 0x5d7671, 0xa89965][i],
      x - .12, .907, offset, .094, .214 + (i % 3) * .048, .094);
  }
}

function wallStock(frame, width, depth, tea) {
  const at = -width / 2 + .255;
  const z = -depth * .23;
  const wood = tea ? 0x8f694a : 0x766451;
  // Stock is over the original counter, which already has its own collider.
  for (const end of [-1, 1]) {
    frame.box('wood', wood, at + .27, 1.606, z + end * .995, .055, 1.393, .055);
  }
  for (let row = 0; row < 3; row++) {
    const h = 1.16 + row * .401;
    frame.box('wood', wood, at + .284, h, z, .54, .054, 2.05);
    for (let col = 0; col < 7; col++) {
      if ((row + col * 3) % 11 === 4) continue;
      const position = z + (col - 3) * .247;
      const tone = (tea ? [0xa0a58c, 0x7d8a75, 0xb98561, 0xb9ab83] : [0x877b61, 0x817e68, 0x7e7865, 0xa19470])[(row + col) % 4];
      const radius = .065 + (col % 3) * .012;
      const size = .151 + ((row + col * 3) % 5) * .024;
      frame.mesh(tin, 'coatedSteel', tone, at + .365, h + .028, position, radius, size, radius);
      frame.pipe(at + .365, h + size + .022, position, at + .365, h + size + .04, position,
        radius * 1.015, tea ? 0x888073 : 0x6e6b5a, 'metal');
    }
  }
}

function loungeBench(frame, x, z, span) {
  frame.box('wood', 0x705644, x, .194, z, span, .312, .68);
  frame.box('wood', 0x866348, x, .371, z, span + .055, .064, .726);
  frame.box('wood', 0x785639, x, .556, z - .285, span, .406, .111);
  frame.body(x, .39, z, span + .055, .78, .726, 'wood');
  const count = Math.max(1, Math.round(span / .65));
  const cushionW = span / count;
  const seatCushion = new RoundedBoxGeometry(cushionW - .012, .104, .551, 1, .024);
  const backCushion = new RoundedBoxGeometry(cushionW - .025, .218, .091, 1, .021);
  for (let i = 0; i < count; i++) {
    const offset = (i - (count - 1) / 2) * cushionW;
    const color = [0xa75e49, 0x89724f, 0x527367][(i * 7 + Math.round(x * 3) + 30) % 3];
    frame.mesh(seatCushion, 'cloth', color, x + offset, .452 + (i % 3) * .004, z + .027);
    frame.mesh(backCushion, 'cloth', color, x + offset, .622 - (i % 3) * .004, z - .208);
    for (const stripe of [-.22, .22]) {
      frame.box('cloth', 0xb89564, x + offset + stripe * cushionW, .625, z - .161, .012, .163, .004);
    }
  }
  seatCushion.dispose();
  backCushion.dispose();
}

function teaRoom(frame, width, depth) {
  partition(frame, width, .58);
  frame.mesh(rugPlane, 'shopRug', 0xe6d2bd, -width * .304, .039, depth * .242, 1.46, 1, depth * .465);
  frame.mesh(rugPlane, 'shopRug', 0xe0c9ab, -width * .208, .039, -depth * .278, 1.91, 1, depth * .40);
  teaCounter(frame, -width / 2 + .755, depth * .268);
  pendant(frame, -4.9, 3.6, 2.42);
  pendant(frame, -3.6, -3.3, 2.42);

  // Keep both paths around the floor runners open and seat the furniture against the back wall.
  loungeBench(frame, -width * .244, -depth / 2 + .72, width * .392);
  loungeBench(frame, width * .228, -depth / 2 + .72, width * .371);
  const tableZ = -depth / 2 + 1.98;
  for (const x of [-width * .246, width * .23]) {
    frame.box('wood', 0x835f46, x, .445, tableZ, 1.34, .075, .71);
    for (const dx of [-.54, .54]) for (const dz of [-.259, .259]) {
      frame.box('wood', 0x765a40, x + dx, .236, tableZ + dz, .076, .4, .073);
    }
    frame.pipe(x - .26, .485, tableZ, x - .26, .504, tableZ, .149, 0x979184);
    frame.mesh(kettle, 'metal', 0xad9677, x - .27, .504, tableZ, .091, .151, .091);
    frame.body(x, .26, tableZ, 1.34, .52, .71, 'wood');
  }
  const rear = -depth / 2 + .333;
  for (const [x, w, h, y, print] of [
    [-width * .265, .66, .83, 1.69, 'shopMenu'],
    [-width * .139, .39, .54, 1.58, 'poster'],
    [width * .222, .51, .71, 1.67, 'poster'],
  ]) {
    frame.box('wood', 0x866849, x, y, rear + .071, w + .065, h + .065, .043);
    frame.plate(print, 0xf4e4c6, x, y, rear + .096, w, h);
  }
}

function finishRearWall(frame, width, depth, tea) {
  const rear = -depth / 2 + .333;
  const innerWidth = width - .43;
  frame.box('plaster', 0xc7ac8b, 0, 1.48, rear, innerWidth, 2.96, .11);
  frame.box('brick', tea ? 0x789482 : 0xa69b83, 0, .477, rear + .069, innerWidth, .865, .051);
  frame.box('wood', 0x7c5a43, 0, .947, rear + .078, innerWidth, .084, .073);
}

function workshop(frame, width, depth) {
  const at = -width / 2 + .44;
  const length = Math.min(4.7, depth * .4);
  const z = depth * .185;
  const metal = 0x7f8276;
  frame.box('coatedSteel', 0x656e65, at, .398, z, .51, .724, length);
  frame.box('wood', 0x8f7556, at + .023, .817, z, .616, .099, length + .12);
  frame.body(at, .446, z, .64, .895, length + .12, 'metal');
  for (let i = 0; i < 7; i++) {
    const offset = z + (i - 3) * length / 7;
    frame.box('coatedSteel', i % 3 ? 0x6b7063 : 0x90836f, at + .267, .445, offset, .028, .607, length / 7 - .045);
    frame.pipe(at + .302, .627, offset - .09, at + .302, .627, offset + .09, .011, metal);
  }
  frame.box('wood', 0x857661, at - .112, 1.437, z, .08, 1.064, length);
  for (let i = 0; i < 8; i++) {
    const offset = z - length * .43 + i * .46;
    const tip = 1.35 + (i % 3) * .104;
    frame.pipe(at - .052, tip, offset, at - .052, tip + .27, offset + .049, .012, metal);
    frame.pipe(at - .052, tip + .264, offset + .045, at - .052, tip + .32, offset + .075, .027, 0x4e554d);
  }
  pendant(frame, at + .915, z, 2.51, true);
  pendant(frame, width * .22, -depth * .24, 2.56, true);
}

function provisions(frame, width, depth) {
  const x = -width / 2 + .69;
  const z = depth * .22;
  frame.box('wood', 0x826040, x, .433, z, .78, .794, 3.42);
  frame.box('wood', 0x9b7b55, x, .847, z, .87, .073, 3.49);
  frame.body(x, .444, z, .87, .888, 3.49, 'wood');
  for (let slot = 0; slot < 4; slot++) {
    const at = z + (slot - 1.5) * .78;
    frame.box('wood', 0x99775a, x, .958, at, .648, .139, .69);
    frame.box('cloth', [0xb48351, 0x926142, 0xb89a6a, 0x828455][slot], x, 1.033, at, .544, .029, .586);
    frame.box('wood', 0x735840, x + .327, 1.009, at, .045, .098, .71);
  }
  pendant(frame, -5.0, 3.8, 2.48);
  pendant(frame, width * .22, -depth * .21, 2.54);
}

export function addShopInterior(frame, width, depth, scheme, through) {
  const tea = scheme === 'carved' && !through;
  const utility = through || scheme === 'workshop';
  frame.box('shopTile', tea ? 0xf5e3ca : utility ? 0x8f9997 : 0xd4c1a0,
    0, .036, 0, width - .46, .004, depth - .43);
  for (let z = -depth / 2 + .47; z <= depth / 2 - .44; z += 1.43) {
    frame.box('wood', tea ? 0x6c584a : 0x675e53, 0, 2.906, z, width - .42, .153, .165);
  }
  if (!through) finishRearWall(frame, width, depth, tea);
  wallStock(frame, width, depth, tea);
  if (tea) teaRoom(frame, width, depth);
  else if (utility) workshop(frame, width, depth);
  else provisions(frame, width, depth);
}
