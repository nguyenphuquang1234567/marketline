import * as THREE from 'three';

const widthSegments = 36;
const heightSegments = 9;
const apron = new THREE.PlaneGeometry(1, 1, widthSegments, heightSegments);
const points = apron.getAttribute('position');
const colors = [];
for (let i = 0; i < points.count; i++) {
  const x = points.getX(i);
  const hang = .5 - points.getY(i);
  const fold = Math.sin(x * Math.PI * 15 + hang * 1.6);
  const drape = Math.sin(x * Math.PI * 5.7 - hang * .9);
  points.setXYZ(i, x * (1 - hang * .029), points.getY(i) + (.037 * fold + .023 * drape) * hang ** 2,
    (fold * .027 + drape * .019) * Math.sin(hang * 1.86) - .015 * hang);
  const tone = .93 + fold * .067 + drape * .056 - hang * .09;
  colors.push(tone * 1.04, tone, tone * .96);
}
apron.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
apron.computeVertexNormals();

const shadePanel = new THREE.PlaneGeometry(1, 1, 28, 12);
const shadePoints = shadePanel.getAttribute('position');
const shadeColors = [];
for (let i = 0; i < shadePoints.count; i++) {
  const x = shadePoints.getX(i);
  const z = shadePoints.getY(i);
  const scallop = Math.cos(x * Math.PI * 11);
  const sag = Math.cos(Math.PI * z) * (.104 + .016 * Math.cos(x * 15))
    + (1 - Math.cos(Math.PI * z)) * (.024 + .022 * scallop);
  shadePoints.setXYZ(i, x, -sag, z * (1 - .013 * scallop));
  const discoloration = .89 + .08 * Math.cos(x * 9 - z * 3.8) + .03 * scallop;
  shadeColors.push(discoloration, discoloration, discoloration * .98);
}
shadePanel.setAttribute('color', new THREE.Float32BufferAttribute(shadeColors, 3));
shadePanel.computeVertexNormals();

export function dressStall(frame, width, tableZ, cloth, wood) {
  const front = tableZ + .49;
  frame.mesh(apron, 'stallCloth', cloth, 0, .513, front, width * .84, .71, 1);
  frame.box('wood', wood, 0, .856, front + .03, width * .88, .062, .087);
  for (const offset of [-.4, -.22, 0, .24, .4]) {
    const x = width * offset;
    frame.box('metal', 0x82725b, x, .855, front + .074, .025, .025, .008);
  }
  for (const side of [-1, 1]) {
    const x = side * width * .392;
    frame.pipe(x, .19, tableZ - .405, x, .81, tableZ + .367, .031, wood, 'wood');
  }
}

export function reinforceAwning(frame, width, depth) {
  for (const side of [-1, 1]) {
    const x = side * width / 2;
    const z = depth / 2;
    frame.pipe(x, 2.15, z, x - side * .51, 2.309, z, .028, 0x6d5945, 'wood');
    frame.box('metal', 0x514b3d, x, 2.298, z, .13, .067, .133);
    for (const y of [2.274, 2.324]) frame.box('metal', 0x8a795e, x, y, z + .071, .032, .023, .009);
  }
}

export function addShadePergola(frame, span, awnings) {
  const front = span * .45;
  for (const z of [-front, front]) {
    frame.box('wood', 0x6f573e, 0, 6.27, z, 16.45, .19, .23);
    for (const side of [-1, 1]) {
      frame.box('metal', 0x5a5546, side * 8.09, 6.19, z, .11, .40, .36);
      frame.pipe(side * 8.03, 5.83, z, side * 7.50, 6.21, z, .035, 0x524a3a);
      for (const y of [6.07, 6.34]) {
        frame.box('metal', 0x81765b, side * 8.026, y, z, .034, .054, .054);
      }
    }
  }
  for (let i = 0; i < 18; i++) {
    const x = -.425 * 17 + i * .85;
    frame.box('wood', i % 2 ? 0x7d6246 : 0x6e553c, x, 6.395, 0, .122, .064, span + .34);
  }
  for (const [x, width, tint] of awnings) {
    frame.mesh(shadePanel, 'stallCloth', tint, x, 6.555, 0, width, 1, front * 2 + .23, 0, width, front * 2);
    for (const z of [-front, front]) {
      frame.pipe(x - width * .5, 6.42, z, x + width * .5, 6.42, z, .018, 0x928167, 'wood');
      for (let i = 0; i <= 5; i++) {
        const tie = x + width * (i / 5 - .5);
        frame.box('wood', 0x9e8c6c, tie, 6.467, z, .038, .13, .075);
      }
    }
  }
}

const loadingRoof = new THREE.PlaneGeometry(1, 1, 192, 2);
const roofPoints = loadingRoof.getAttribute('position');
const roofColors = [];
for (let i = 0; i < roofPoints.count; i++) {
  const x = roofPoints.getX(i);
  const run = roofPoints.getY(i) + .5;
  const ridge = .5 + .5 * Math.cos(x * Math.PI * 96);
  roofPoints.setXYZ(i, -x, -run * .245 + .019 * ridge, run - .5);
  const panel = Math.floor((x + .5) * 4);
  const tint = .89 + (panel % 3) * .04 - .08 * run;
  roofColors.push(tint, tint, tint * .97);
}
loadingRoof.setAttribute('color', new THREE.Float32BufferAttribute(roofColors, 3));
loadingRoof.computeVertexNormals();
const loadingSoffit = loadingRoof.clone().translate(0, -.009, 0);
const underside = loadingSoffit.index.array;
for (let i = 0; i < underside.length; i += 3) {
  const vertex = underside[i];
  underside[i] = underside[i + 2];
  underside[i + 2] = vertex;
}
loadingSoffit.computeVertexNormals();

export function addLoadingAwning(frame, width, face, warm) {
  const depth = 1.24;
  const center = width * .115;
  const span = Math.min(width * .46, 7.2);
  const paint = warm ? 0x9a8366 : 0x798278;
  const trim = warm ? 0x6d5c48 : 0x58615a;
  frame.box('coatedSteel', trim, center, 2.88, face + .042, span + .12, .119, .10);
  frame.box('coatedSteel', trim, center, 2.641, face + depth, span + .18, .093, .119);
  frame.mesh(loadingRoof, 'coatedSteel', paint, center, 2.88, face + depth / 2, span, 1, depth);
  frame.mesh(loadingSoffit, 'coatedSteel', trim, center, 2.88, face + depth / 2, span, 1, depth);
  frame.box('coatedSteel', trim, center, 2.617, face + depth + .073, span + .27, .071, .076);
  for (const side of [-1, 1]) {
    const x = center + side * span * .43;
    frame.box('coatedSteel', trim, x, 3.49, face + .038, .11, .25, .089);
    frame.pipe(x, 3.48, face + .077, x, 2.68, face + depth, .024, 0x5b5849);
    frame.pipe(x, 2.846, face + .051, x, 2.618, face + depth + .033, .028, 0x625d4d);
    frame.pipe(x, 2.59, face + depth + .05, x, 2.49, face + depth + .05, .028, 0x827863);
  }
  const gutterEnd = center + span * .5 - .07;
  frame.pipe(gutterEnd, 2.59, face + depth + .083, gutterEnd, 2.42, face + depth + .083, .043, trim);
  frame.pipe(gutterEnd, 2.42, face + depth + .083, gutterEnd, 2.30, face + .11, .043, trim);
  frame.pipe(gutterEnd, 2.30, face + .11, gutterEnd, .22, face + .11, .043, trim);
  for (const y of [.68, 1.67]) frame.box('metal', 0x847868, gutterEnd, y, face + .08, .14, .058, .15);
}
