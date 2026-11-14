import * as THREE from 'three';

// A grid of baked light probes covering the playable district. Each probe
// stores the mean radiance arriving at that point and its first directional
// moment, per colour channel. Shaded surfaces evaluate the grid for diffuse
// sky light and every bounce the bake captured, in place of a flat ambient.
export const PROBE_GRID = {
  min: [-66, .5, -65], step: [2.5, 2.2, 2.5], count: [54, 4, 53],
};
const FACE = 16;

export const irradianceGLSL = /* glsl */ `
uniform highp sampler3D mlProbeR;
uniform highp sampler3D mlProbeG;
uniform highp sampler3D mlProbeB;
uniform vec3 mlProbeMin;
uniform vec3 mlProbeInverseSpan;
uniform float mlProbeOn;

vec3 mlProbeIrradiance(vec3 point, vec3 surfaceNormal, vec3 shadingNormal) {
  // Sample a little off the surface so a wall reads the probes it can see.
  vec3 uvw = (point + surfaceNormal * .45 - mlProbeMin) * mlProbeInverseSpan;
  vec3 size = vec3(textureSize(mlProbeR, 0));
  uvw = (clamp(uvw, 0., 1.) * (size - 1.) + .5) / size;
  vec4 r = texture(mlProbeR, uvw), g = texture(mlProbeG, uvw), b = texture(mlProbeB, uvw);
  vec3 mean = vec3(r.x, g.x, b.x);
  vec3 directional = vec3(dot(r.yzw, shadingNormal), dot(g.yzw, shadingNormal), dot(b.yzw, shadingNormal));
  return max(3.14159265 * mean + 2.0943951 * directional, .35 * mean);
}
`;

function texture3D(data, [nx, ny, nz]) {
  const texture = new THREE.Data3DTexture(data, nx, ny, nz);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.HalfFloatType;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = texture.wrapR = THREE.ClampToEdgeWrapping;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

// coefficients: Float32Array of 12 values per probe (mean rgb, then moment xyz for r, g, b),
// probes ordered x-fastest, then y, then z.
export function irradianceTextures(coefficients, grid = PROBE_GRID) {
  const total = grid.count[0] * grid.count[1] * grid.count[2];
  if (coefficients.length !== total * 12) throw new Error('Irradiance volume does not match the probe grid.');
  const channels = [0, 1, 2].map(() => new Uint16Array(total * 4));
  for (let probe = 0; probe < total; probe++) {
    for (let channel = 0; channel < 3; channel++) {
      const out = channels[channel], from = probe * 12;
      out[probe * 4] = THREE.DataUtils.toHalfFloat(coefficients[from + channel]);
      for (let axis = 0; axis < 3; axis++) {
        out[probe * 4 + 1 + axis] = THREE.DataUtils.toHalfFloat(coefficients[from + 3 + channel * 3 + axis]);
      }
    }
  }
  return channels.map(data => texture3D(data, grid.count));
}

export async function loadIrradiance(url) {
  const buffer = await (await fetch(url)).arrayBuffer();
  return new Float32Array(buffer);
}

const FACES = [
  [[0, 0, -1], [0, -1, 0], [1, 0, 0]], [[0, 0, 1], [0, -1, 0], [-1, 0, 0]],
  [[1, 0, 0], [0, 0, 1], [0, 1, 0]], [[1, 0, 0], [0, 0, -1], [0, -1, 0]],
  [[1, 0, 0], [0, -1, 0], [0, 0, 1]], [[-1, 0, 0], [0, -1, 0], [0, 0, -1]],
];

// Development-time bake. Renders the lit scene into a small cube map at every
// probe and reduces it to the twelve coefficients. `prepare(position)` lets the
// caller centre the sun shadow cascades on the probe first.
export async function bakeIrradiance(renderer, scene, prepare, onProgress = () => {}, grid = PROBE_GRID) {
  const target = new THREE.WebGLCubeRenderTarget(FACE, { type: THREE.FloatType, generateMipmaps: false });
  const camera = new THREE.CubeCamera(.08, 400, target);
  // Direction and solid angle of every texel, shared by all probes.
  const texels = [];
  for (const [right, up, forward] of FACES) {
    const face = new Float32Array(FACE * FACE * 4);
    for (let y = 0; y < FACE; y++) {
      for (let x = 0; x < FACE; x++) {
        const u = (x + .5) / FACE * 2 - 1, v = (y + .5) / FACE * 2 - 1;
        const d = [0, 1, 2].map(i => forward[i] + right[i] * u + up[i] * v);
        const length = Math.hypot(...d);
        face.set([d[0] / length, d[1] / length, d[2] / length, 1 / (length * length * length)], (y * FACE + x) * 4);
      }
    }
    texels.push(face);
  }
  const [nx, ny, nz] = grid.count;
  const out = new Float32Array(nx * ny * nz * 12);
  const pixels = new Float32Array(FACE * FACE * 4);
  const priorTarget = renderer.getRenderTarget();
  // The game clears its targets by hand; the cube faces need a fresh depth buffer each.
  const autoClear = renderer.autoClear;
  renderer.autoClear = true;
  let probe = 0;
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++, probe++) {
        camera.position.set(grid.min[0] + x * grid.step[0], grid.min[1] + y * grid.step[1], grid.min[2] + z * grid.step[2]);
        prepare(camera.position);
        camera.update(renderer, scene);
        const sum = new Float64Array(12);
        let weight = 0;
        for (let face = 0; face < 6; face++) {
          renderer.readRenderTargetPixels(target, 0, 0, FACE, FACE, pixels, face);
          const directions = texels[face];
          for (let i = 0; i < FACE * FACE * 4; i += 4) {
            const w = directions[i + 3];
            weight += w;
            for (let channel = 0; channel < 3; channel++) {
              // A probe that sees the sun's disc or a lamp directly must not blow out the fit.
              const radiance = Math.min(pixels[i + channel], 12) * w;
              sum[channel] += radiance;
              for (let axis = 0; axis < 3; axis++) sum[3 + channel * 3 + axis] += radiance * directions[i + axis];
            }
          }
        }
        for (let i = 0; i < 12; i++) out[probe * 12 + i] = sum[i] / weight * (i < 3 ? 1 : 3);
      }
    }
    onProgress((z + 1) / nz);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  renderer.autoClear = autoClear;
  renderer.setRenderTarget(priorTarget);
  target.dispose();
  return out;
}
