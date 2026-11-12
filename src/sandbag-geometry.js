import * as THREE from 'three';

const geometry = new THREE.SphereGeometry(1, 24, 14).rotateZ(Math.PI / 2);
const positions = geometry.attributes.position;
const signedPower = (value, power) => Math.sign(value) * Math.abs(value) ** power;

function fabricPoint(x, height, side, target) {
  const fill = (1 - Math.abs(x) ** 4.4) ** 0.4;
  const gatheredEnd = Math.exp(-((x - 0.77) ** 2) * 37);
  const fold = gatheredEnd * Math.cos(Math.atan2(height, side) * 7 + x * 12) * 0.094;
  const seam = Math.exp(-((height + 0.03) ** 2) * 77) * (0.060 + Math.cos(x * 14) * 0.011);
  const y = signedPower(height, 0.7) * fill * (height < 0 ? 0.89 : 1);
  const z = signedPower(side, 0.74) * (fill + seam * fill + fold) + x * 0.032;
  const wrinkles = 0.066 * Math.sin(x * 14 + side * 7) * (0.35 + gatheredEnd) * fill;
  return target.set(x, y - 0.035 + wrinkles, z);
}

const point = new THREE.Vector3();
for (let i = 0; i < positions.count; i++) {
  const t = THREE.MathUtils.clamp(positions.getX(i), -1, 1);
  const section = Math.sqrt(Math.max(0, 1 - t * t));
  if (section < 0.001) {
    positions.setXYZ(i, t, -0.035, 0.032 * t);
    continue;
  }
  fabricPoint(signedPower(t, .78), positions.getY(i) / section, positions.getZ(i) / section, point);
  positions.setXYZ(i, point.x, point.y, point.z);
}
geometry.computeVertexNormals();

const seamPoints = [];
for (const side of [1, -1]) {
  for (let i = 0; i <= 24; i++) {
    const x = Math.cos(Math.PI * i / 24) * side;
    if (side === -1 && (i === 0 || i === 24)) continue;
    const seamPoint = fabricPoint(x, 0, side, new THREE.Vector3());
    seamPoint.z += .008 * side * Math.sqrt(1 - x * x);
    seamPoints.push(seamPoint);
  }
}
const seamPath = new THREE.CatmullRomCurve3(seamPoints, true);
const sandbagSeamGeometry = new THREE.TubeGeometry(seamPath, 28, .016, 3, true);

export { geometry as sandbagGeometry, sandbagSeamGeometry };
