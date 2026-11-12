// x, z, transverse radius, longitudinal radius. Water collects by curb drains
// and on the edges of the main lane, where the paving sinks away from traffic.
const pools = [
  [-5.45, 39, 1.04, 2.9], [4.65, 32.9, 1.5, 3.2],
  [-4.60, 26.4, 1.02, 2.7], [5.62, 11.2, .73, 3.8],
  [-4.80, -16.1, 1.25, 3.2], [5.2, -39, .97, 3.4],
  [-29.4, 35.6, 1.18, 2.9], [29.9, 12.0, .87, 2.7],
];
const poolCenters = pools.map(p => `vec4(${p.map(value => value.toFixed(3)).join(', ')})`).join(',\n  ');

export const streetWetnessGLSL = /* glsl */ `
float streetHash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float streetField(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3. - 2. * f);
  return mix(mix(streetHash2(i), streetHash2(i + vec2(1, 0)), f.x),
    mix(streetHash2(i + vec2(0, 1)), streetHash2(i + vec2(1)), f.x), f.y);
}
const vec4 streetPools[${pools.length}] = vec4[${pools.length}](
  ${poolCenters}
);
float streetWetness(vec2 worldXZ) {
  float basin = 1e5;
  for (int i = 0; i < ${pools.length}; i++) {
    vec2 delta = (worldXZ - streetPools[i].xy) / streetPools[i].zw;
    basin = min(basin, dot(delta, delta));
  }
  if (basin > 2.) return 0.;
  float bank = streetField(worldXZ * vec2(2.6, 1.25));
  float edge = streetField(worldXZ * 8.1);
  return 1. - smoothstep(.60, 1.19, basin + (bank - .5) * .54 + (edge - .5) * .14);
}
`;
