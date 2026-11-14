import * as THREE from 'three';
import { screenVertex } from './shaders.js';

const ROOF_LAYER = 5;
const COVERAGE = 76;
const HEIGHT = 35;
const NEAR = .5;
const FAR = 40;
const MAP_SIZE = 1024;
const BOUNCE_SIZE = 512;
const BOUNCE_TEXEL = 2 * COVERAGE / BOUNCE_SIZE;

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

// Sunlight that reaches open paving is the street's second light source. The
// bake marches the roof height field toward the sun for every ground texel;
// its mip chain then answers "how much sunlit ground does this point face".
export const sunBounceGLSL = /* glsl */ `
uniform sampler2D mlBounce;
uniform vec3 mlBounceColor;

vec3 mlSunBounce(vec3 point, vec3 normal) {
  float facingGround = .5 * (1. - normal.y);
  if (facingGround < .02) return vec3(0.);
  float height = max(point.y, 0.);
  vec2 uv = (point.xz + normal.xz * (1.2 + height * .9)) * vec2(.5, -.5) / ${COVERAGE.toFixed(1)} + .5;
  float lod = log2(max(1., (1.5 + height * 1.6) / ${BOUNCE_TEXEL.toFixed(4)}));
  float sunlit = mix(textureLod(mlBounce, uv, lod).r, textureLod(mlBounce, uv, lod + 1.6).r, .4);
  return mlBounceColor * sunlit * facingGround / (1. + height * height * .012);
}
`;

const bounceBake = /* glsl */ `
uniform sampler2D mlRoofHeight;
uniform vec3 sun;
in vec2 uvScreen;
out vec4 pixel;
#include <packing>
float surfaceHeight(vec2 uv) {
  return ${(HEIGHT - NEAR).toFixed(1)} - unpackRGBAToDepth(texture(mlRoofHeight, uv)) * ${(FAR - NEAR).toFixed(1)};
}
void main() {
  float height = surfaceHeight(uvScreen);
  float ground = 1. - smoothstep(.45, .9, height);
  height = max(height, 0.);
  vec2 heading = normalize(sun.xz);
  vec2 stride = vec2(heading.x, -heading.y) * .5 / ${COVERAGE.toFixed(1)};
  float rise = sun.y / length(sun.xz);
  float lit = ground;
  for (int i = 1; i <= 80 && lit > 0.; i++) {
    float t = float(i) * .36;
    if (surfaceHeight(uvScreen + stride * t) > height + rise * t + .35) lit = 0.;
  }
  pixel = vec4(vec3(lit), 1.);
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
    this.bounce = new THREE.WebGLRenderTarget(BOUNCE_SIZE, BOUNCE_SIZE, {
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true, depthBuffer: false,
    });
    this.heights = null;
  }

  bakeBounce(sun) {
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: screenVertex, fragmentShader: bounceBake,
      uniforms: { mlRoofHeight: { value: this.target.texture }, sun: { value: sun } },
      depthTest: false, depthWrite: false, toneMapped: false, blending: THREE.NoBlending,
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const triangle = new THREE.Mesh(geometry, material);
    triangle.frustumCulled = false;
    const renderer = this.renderer;
    const priorTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.bounce);
    renderer.render(triangle, new THREE.Camera());
    renderer.setRenderTarget(priorTarget);
    geometry.dispose();
    material.dispose();
  }

  // Height of the highest shadow-casting surface above a map position. Open
  // paving reads as ground level.
  heightAt(x, z) {
    if (!this.heights) {
      this.heights = new Uint8Array(MAP_SIZE * MAP_SIZE * 4);
      this.renderer.readRenderTargetPixels(this.target, 0, 0, MAP_SIZE, MAP_SIZE, this.heights);
    }
    const u = Math.floor((x * .5 / COVERAGE + .5) * MAP_SIZE);
    const v = Math.floor((-z * .5 / COVERAGE + .5) * MAP_SIZE);
    if (u < 0 || v < 0 || u >= MAP_SIZE || v >= MAP_SIZE) return 0;
    const i = (v * MAP_SIZE + u) * 4, data = this.heights;
    const depth = (data[i] + data[i + 1] / 256 + data[i + 2] / 65536) / 256 + data[i + 3] / (255 * 16777216);
    return Math.max(0, HEIGHT - NEAR - depth * (FAR - NEAR));
  }

  bake(scene, sun) {
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
    this.heights = null;
    this.bakeBounce(sun);
  }

  dispose() {
    this.target.dispose();
    this.bounce.dispose();
    this.depth.dispose();
  }
}
