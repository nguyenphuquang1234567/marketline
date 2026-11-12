import * as THREE from 'three';

const ROOF_LAYER = 5;
const COVERAGE = 76;
const HEIGHT = 35;
const NEAR = .5;
const FAR = 40;
const MAP_SIZE = 1024;

export const skyOcclusionGLSL = /* glsl */ `
uniform sampler2D mlRoofHeight;

float mlRoofOverhead(vec3 point, vec2 offset) {
  vec2 uv = (point.xz + offset) * vec2(.5, -.5) / ${COVERAGE.toFixed(1)} + .5;
  if (any(lessThanEqual(uv, vec2(0.))) || any(greaterThanEqual(uv, vec2(1.)))) return 0.;
  float depth = unpackRGBAToDepth(texture(mlRoofHeight, uv));
  float overhead = ${(HEIGHT - NEAR).toFixed(1)} - depth * ${(FAR - NEAR).toFixed(1)} - point.y;
  return smoothstep(.40, 1.25, overhead);
}

float mlSkyOcclusion(vec3 point, vec3 normal) {
  // Sample the overhead silhouette at several angles. Under an awning, the
  // open side of the roof still admits light, unlike a binary indoor volume.
  float spacing = mix(.62, 1.35, smoothstep(0., 8., point.y));
  vec2 base = normal.xz * .24;
  return mlRoofOverhead(point, base) * .36
    + mlRoofOverhead(point, base + vec2(.92, .38) * spacing) * .16
    + mlRoofOverhead(point, base + vec2(-.38, .92) * spacing) * .16
    + mlRoofOverhead(point, base + vec2(-.92, -.38) * spacing) * .16
    + mlRoofOverhead(point, base + vec2(.38, -.92) * spacing) * .16;
}
`;

export class SkyOcclusion {
  constructor(renderer) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(MAP_SIZE, MAP_SIZE, {
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false,
    });
    this.camera = new THREE.OrthographicCamera(-COVERAGE, COVERAGE, COVERAGE, -COVERAGE, NEAR, FAR);
    this.camera.position.set(0, HEIGHT, 0);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(0, 0, 0);
    this.camera.layers.set(ROOF_LAYER);
    this.depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  }

  bake(scene) {
    // World batches and cloth are direct children. Keep actors, loose props
    // and GLB decoration out of this static indirect lighting input.
    const occluders = scene.children.filter(object => object.isMesh && object.castShadow);
    for (const mesh of occluders) mesh.layers.enable(ROOF_LAYER);

    const renderer = this.renderer;
    const priorTarget = renderer.getRenderTarget();
    const priorOverride = scene.overrideMaterial;
    const priorBackground = scene.background;
    const priorColor = renderer.getClearColor(new THREE.Color());
    const priorAlpha = renderer.getClearAlpha();
    try {
      scene.overrideMaterial = this.depth;
      scene.background = null;
      renderer.setRenderTarget(this.target);
      renderer.setClearColor(0xffffff, 1);
      renderer.clear();
      renderer.render(scene, this.camera);
    } finally {
      for (const mesh of occluders) mesh.layers.disable(ROOF_LAYER);
      scene.overrideMaterial = priorOverride;
      scene.background = priorBackground;
      renderer.setRenderTarget(priorTarget);
      renderer.setClearColor(priorColor, priorAlpha);
    }
  }

  dispose() {
    this.target.dispose();
    this.depth.dispose();
  }
}
