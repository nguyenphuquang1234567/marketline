import * as THREE from 'three';

function panelMaterial(canvas, properties) {
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return new THREE.MeshStandardMaterial({ map, vertexColors: true, ...properties });
}

function wear(ctx, width, height, seed, dots) {
  let state = seed;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let i = 0; i < dots; i++) {
    ctx.fillStyle = i % 4 === 0 ? 'rgba(47,38,28,.18)' : 'rgba(229,213,179,.12)';
    ctx.fillRect(random() * width, random() * height, 1 + random() * 3, 1 + random() * 2);
  }
}

function mosaicTile(seed) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#8f8470';
  ctx.fillRect(0, 0, 128, 128);
  const glaze = ctx.createLinearGradient(0, 0, 120, 128);
  glaze.addColorStop(0, '#e7d6b0');
  glaze.addColorStop(1, '#b4a482');
  ctx.fillStyle = glaze;
  ctx.fillRect(2, 2, 124, 124);
  for (let petal = 0; petal < 8; petal++) {
    ctx.save();
    ctx.translate(64, 64);
    ctx.rotate(petal * Math.PI / 4);
    ctx.fillStyle = petal % 2 ? '#537570' : '#294e58';
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(-16, -29);
    ctx.lineTo(0, -49);
    ctx.lineTo(16, -29);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = '#a76c3d';
  ctx.fillRect(57, 57, 14, 14);
  wear(ctx, 128, 128, seed, 760);
  return panelMaterial(canvas, { roughness: 0.52 });
}

function wallPoster(seed) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 384;
  const ctx = canvas.getContext('2d');
  ctx.beginPath();
  ctx.moveTo(9, 8);
  ctx.lineTo(240, 5);
  ctx.lineTo(249, 342);
  ctx.lineTo(226, 358);
  ctx.lineTo(200, 353);
  ctx.lineTo(190, 375);
  ctx.lineTo(14, 369);
  ctx.closePath();
  ctx.clip();
  const paper = ctx.createLinearGradient(0, 0, 252, 386);
  paper.addColorStop(0, '#dbc191');
  paper.addColorStop(1, '#998166');
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, 256, 384);
  ctx.fillStyle = '#654135';
  ctx.fillRect(24, 37, 207, 67);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#e3ca9a';
  ctx.font = 'bold 34px serif';
  ctx.fillText('AL MARFA', 127, 82);
  ctx.fillStyle = '#604d3d';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText('HALLE DU MARCHÉ', 127, 124);
  ctx.strokeStyle = '#5f5342';
  ctx.lineWidth = 3;
  for (const y of [149, 222, 276]) ctx.strokeRect(37, y, 179, 1);
  ctx.font = 'bold 53px serif';
  ctx.fillText('سوق', 127, 200);
  ctx.font = '21px serif';
  ctx.fillText('VENTE AU DÉTAIL', 127, 252);
  ctx.font = '18px serif';
  ctx.fillText('ENTRÉE LIBRE', 127, 308);
  wear(ctx, 256, 384, seed, 4100);
  return panelMaterial(canvas, { roughness: 0.97, alphaTest: 0.5 });
}

export function createFacadeMaterials(seed) {
  return { mosaic: mosaicTile(seed), poster: wallPoster(seed ^ 0x45d9f3b) };
}

export function addFacadePier(frame, left, right, face, style, bay) {
  const width = right - left;
  const center = (left + right) / 2;
  if (style === 'tiled' && width > 0.37) {
    const tileSize = 0.144;
    const columns = Math.floor((width - 0.23) / tileSize);
    for (let column = 0; column < columns; column++) {
      const x = center + (column - (columns - 1) / 2) * tileSize;
      for (let row = 0; row < 3; row++) {
        frame.plate('mosaic', 0xe1cbb2, x, 0.492 + row * tileSize, face + 0.012, tileSize, tileSize);
      }
    }
    frame.box('brick', 0x6c786d, center, 0.861, face + 0.007, columns * tileSize, 0.062, 0.042);
  }
  if (width >= 0.61 && bay % 4 === 2 && (style === 'tiled' || style === 'workshop')) {
    frame.plate('poster', 0xebd4ba, center, 1.53, face + 0.013, 0.37, 0.54);
  }
}

export function addShopRecess(frame, x, y, face, width, height, variant, tint) {
  if (variant === 2) {
    // Roller drum, guide tracks, and lock above the raised threshold.
    frame.box('metal', 0x57564d, x, y + height / 2 - 0.107, face - 0.06, width - 0.1, 0.151, 0.225);
    for (const side of [-1, 1]) {
      frame.box('metal', 0x3b413e, x + side * (width / 2 - 0.086), y - 0.025, face - 0.17,
        0.049, height - 0.28, 0.093);
    }
    frame.box('metal', 0x605f54, x, y - height / 2 + 0.123, face - 0.18, 0.136, 0.096, 0.056);
    frame.box('flat', 0x292621, x, y - height / 2 + 0.121, face - 0.149, 0.017, 0.038, 0.01);
  } else if (variant === 1) {
    // Timber joinery behind the existing security grille.
    frame.box('wood', tint, x, y - height * 0.227, face - 0.234, width - 0.18, 0.09, 0.04);
    for (const side of [-1, 1]) {
      frame.box('glass', 0x3c4644, x + side * width * 0.205, y + height * 0.187, face - 0.249,
        width * 0.355, height * 0.47, 0.019);
    }
    frame.box('wood', tint, x, y, face - 0.218, 0.058, height - 0.133, 0.055);
  }
}

export function addPlasterHood(frame, x, y, face, width, tint) {
  // The crown rises only into the masonry over the rectangular lintel.
  const radius = width * 0.57;
  const rise = 0.29;
  const segments = 10;
  for (let i = 0; i < segments; i++) {
    const a = Math.PI * i / segments;
    const b = Math.PI * (i + 1) / segments;
    frame.pipe(x + Math.cos(a) * radius, y + 0.08 + Math.sin(a) * rise, face + 0.023,
      x + Math.cos(b) * radius, y + 0.08 + Math.sin(b) * rise, face + 0.023,
      0.061, tint, 'plaster');
  }
  frame.box('plaster', tint, x, y + 0.33, face + 0.021, 0.105, 0.152, 0.111);
}

export function addServiceEntrance(frame, width, trim, masonry, marked) {
  const x = width * -0.042;
  const door = 1.12;
  const baseY = 0.23;
  for (const [lo, hi] of [[-width / 2 + 0.027, x - door / 2 - 0.11], [x + door / 2 + 0.11, width / 2 - 0.027]]) {
    frame.box('limestone', 0x9b9180, (lo + hi) / 2, baseY, -0.009, hi - lo, 0.45, 0.058);
  }
  frame.box('limestone', masonry, x, 0.075, 0.075, 1.27, 0.15, 0.22);
  frame.box('plaster', masonry, x, 2.34, 0.053, 1.44, 0.16, 0.16);
  for (const side of [-1, 1]) {
    frame.box('plaster', masonry, x + side * 0.62, 1.2, 0.051, 0.103, 2.22, 0.155);
  }
  frame.box('rubber', 0x3d423e, x, 1.204, 0.007, door + 0.077, 2.12, 0.052);
  frame.box('wood', trim, x, 1.197, 0.039, door, 2.094, 0.067);
  for (const y of [0.59, 1.17, 1.74]) {
    frame.box('wood', trim, x, y, 0.08, door - 0.14, 0.059, 0.032);
    frame.box('metal', 0x58564a, x - door * 0.4, y, 0.101, 0.134, 0.059, 0.036);
  }
  frame.pipe(x + 0.37, 1.21, 0.112, x + 0.37, 1.04, 0.112, 0.018, 0x5f5e52);
  frame.box('metal', 0x74776c, x + 0.92, 1.31, 0.087, 0.31, 0.42, 0.18);
  frame.pipe(x + 0.92, 1.52, 0.085, x + 0.92, 2.78, 0.056, 0.017, 0x6c6759);
  frame.pipe(x + 0.92, 2.78, 0.056, width / 2 - 0.13, 2.78, 0.056, 0.017, 0x6c6759);
  if (marked) frame.plate('poster', 0xc3b597, x - 1.035, 1.52, 0.017, 0.34, 0.48);
}
