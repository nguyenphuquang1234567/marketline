import * as THREE from 'three';

const geometry = new THREE.SphereGeometry(1, 24, 14).rotateZ(Math.PI / 2);
const positions = geometry.attributes.position;
const signedPower = (value, power) => Math.sign(value) * Math.abs(value) ** power;

for (let i = 0; i < positions.count; i++) {
  const t = THREE.MathUtils.clamp(positions.getX(i), -1, 1);
  const section = Math.sqrt(Math.max(0, 1 - t * t));
  if (section < 0.001) {
    positions.setXYZ(i, t, -0.05, 0.03 * t);
    continue;
  }
  const side = positions.getZ(i) / section;
  const height = positions.getY(i) / section;
  const x = signedPower(t, 0.78);
  const fill = (1 - Math.abs(x) ** 4.4) ** 0.4;
  // Fabric gathers near the stitched mouth and flattens where bags stack.
  const gatheredEnd = Math.exp(-((x - 0.77) ** 2) * 37);
  const fold = gatheredEnd * Math.cos(Math.atan2(height, side) * 7 + x * 12) * 0.072;
  const seam = Math.exp(-((height + 0.03) ** 2) * 77) * (0.065 + Math.cos(x * 14) * 0.011);
  const y = signedPower(height, 0.7) * fill * (height < 0 ? 0.89 : 1);
  const z = signedPower(side, 0.74) * (fill + seam * fill + fold) + x * 0.032;
  const wrinkles = 0.038 * Math.sin(x * 14 + side * 7) * (0.35 + gatheredEnd) * fill;
  positions.setXYZ(i, x, y - 0.035 + wrinkles, z);
}

geometry.computeVertexNormals();
export { geometry as sandbagGeometry };
