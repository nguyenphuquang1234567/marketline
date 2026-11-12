import * as THREE from 'three';
import skyURL from './assets/al-marfa-sky.webp?url&inline';

// The panorama is rotated to put the photographed sun at this direction.
export const MARKET_SUN = new THREE.Vector3(-0.441521, 0.614022, 0.654245).normalize();

export async function loadMarketSky() {
  const texture = await new THREE.TextureLoader().loadAsync(skyURL);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}
