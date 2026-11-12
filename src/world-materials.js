import * as THREE from 'three';

const textures = import.meta.glob('./assets/world-textures/*.webp', {
  eager: true, query: '?inline', import: 'default',
});

const scans = {
  plaster: { meters: [2, 2], normal: 0.48, roughness: 1, occlusion: 0.24 },
  road: { meters: [2, 2], normal: 0.72, roughness: 1, occlusion: 0.38 },
  asphalt: { meters: [2, 2], normal: 0.43, roughness: 1, occlusion: 0.13 },
  limestone: { meters: [2, 2], normal: 0.36, roughness: 1, occlusion: 0.16 },
  brick: { meters: [3, 3], normal: 0.59, roughness: 1, occlusion: 0.24 },
  wood: { meters: [2, 2], normal: 0.55, roughness: 1, occlusion: 0.24 },
  metal: { meters: [2, 2], normal: 0.31, roughness: 0.88, occlusion: 0.16, metalness: 1 },
  shutter: { meters: [2, 2], normal: 0.75, roughness: 0.91, occlusion: 0.25 },
  cloth: { meters: [0.27, 0.27], normal: 0.35, roughness: 1, occlusion: 0.08 },
};

export const WORLD_MATERIAL_METERS = Object.fromEntries(
  Object.entries(scans).map(([kind, scan]) => [kind, scan.meters]),
);

const loader = new THREE.TextureLoader();
const textureLoads = [];

const weathering = {
  plaster: /* glsl */ `
    vec2 wall = vec2( marketSurfacePosition.x + marketSurfacePosition.z, marketSurfacePosition.y );
    float plasterClouds = marketSurfaceNoise( wall * vec2( 0.29, 0.62 ) );
    float runoff = marketSurfaceNoise( wall * vec2( 3.2, 0.21 ) + vec2( plasterClouds * 0.65, 2.2 ) );
    float lichen = marketSurfaceNoise( wall * vec2( 3.9, 4.3 ) + 8.3 );
    float splashLine = 0.25 + 0.65 * marketSurfaceNoise( marketSurfacePosition.xz * 1.1 );
    float risingDamp = (1.0 - smoothstep( 0.035, splashLine, wall.y )) * marketSurfaceVertical;
    float damp = max( risingDamp * 0.84, smoothstep( 0.52, 0.95, runoff ) * 0.40 * marketSurfaceVertical );
    float mineral = smoothstep( 0.42, 0.82, plasterClouds * 0.67 + lichen * 0.33 );
    diffuseColor.rgb *= mix( vec3( 0.87, 0.82, 0.75 ), vec3( 1.10, 1.08, 1.03 ), mineral );
    diffuseColor.rgb *= mix( vec3( 1.0 ), vec3( 0.66, 0.63, 0.54 ), damp );
    roughnessFactor = mix( roughnessFactor, 0.73, damp * 0.38 );
  `,
  asphalt: /* glsl */ `
    vec2 street = marketSurfacePosition.xz;
    float patches = marketSurfaceNoise( street * 0.39 + 1.8 );
    float aggregate = marketSurfaceNoise( street * 1.72 - 4.7 );
    float resurfaced = smoothstep( 0.42, 0.75, patches * 0.83 + aggregate * 0.17 );
    diffuseColor.rgb *= mix( vec3( 1.08, 1.05, 1.00 ), vec3( 0.71, 0.73, 0.74 ), resurfaced );
    roughnessFactor = mix( roughnessFactor, 0.71, resurfaced * 0.36 );
  `,
  limestone: /* glsl */ `
    vec2 paving = marketSurfacePosition.xz;
    float dust = marketSurfaceNoise( paving * 1.3 + 0.19 * marketSurfacePosition.y );
    float traffic = marketSurfaceNoise( paving * 0.31 + 3.1 );
    float polish = smoothstep( 0.43, 0.79, traffic * 0.72 + dust * 0.28 );
    diffuseColor.rgb *= mix( vec3( 1.08, 1.04, 0.96 ), vec3( 0.80, 0.76, 0.68 ), polish );
    roughnessFactor = mix( roughnessFactor, 0.68, polish * 0.45 );
  `,
};

const surfaceVaryings = /* glsl */ `
  varying vec3 marketSurfacePosition;
  varying float marketSurfaceVertical;
`;

const surfaceNoise = /* glsl */ `
  float marketSurfaceHash( vec2 grid ) {
    vec3 p = fract( vec3( grid.xyx ) * 0.1031 );
    p += dot( p, p.yzx + 33.33 );
    return fract( (p.x + p.y) * p.z );
  }
  float marketSurfaceNoise( vec2 p ) {
    vec2 grid = floor( p );
    vec2 t = fract( p );
    t = t * t * (3.0 - 2.0 * t);
    float a = marketSurfaceHash( grid );
    float b = marketSurfaceHash( grid + vec2( 1, 0 ) );
    float c = marketSurfaceHash( grid + vec2( 0, 1 ) );
    float d = marketSurfaceHash( grid + vec2( 1, 1 ) );
    return mix( mix( a, b, t.x ), mix( c, d, t.x ), t.y );
  }
`;

const damagedPlaster = /* glsl */ `
  uniform sampler2D marketDamageAlbedo;
  uniform sampler2D marketDamageNormal;

  float marketDamageBlend() {
    vec3 p = marketSurfacePosition;
    vec2 wall = vec2(p.x + p.z, p.y);
    float flaking = marketSurfaceNoise(wall * vec2(.52, .78));
    float chips = marketSurfaceNoise(wall * 3.36 + p.xz * .19);
    float exposed = smoothstep(.40, .73, .79 * flaking + .21 * chips);
    float lowerFacade = 1.0 - smoothstep(.52, 4.6, p.y);
    return marketSurfaceVertical * exposed * mix(.40, .84, lowerFacade);
  }
`;

function addPlasterDamage(material, shader) {
  shader.uniforms.marketDamageAlbedo = { value: material.plasterDamageAlbedo };
  shader.uniforms.marketDamageNormal = { value: material.plasterDamageNormal };
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <map_fragment>', THREE.ShaderChunk.map_fragment.replace(
      'diffuseColor *= sampledDiffuseColor;',
      `vec2 damageUV = vMapUv * 1.053 + vec2(.13, .37);
       float exposedMasonry = marketDamageBlend();
       vec3 damagedSurface = texture2D(marketDamageAlbedo, damageUV).rgb;
       sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, damagedSurface * 1.29, exposedMasonry);
       diffuseColor *= sampledDiffuseColor;`,
    ))
    .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace(
      'mapN.xy *= normalScale;',
      `vec3 damageNormal = texture2D(marketDamageNormal, damageUV).xyz * 2.0 - 1.0;
       mapN.xy *= normalScale;
       damageNormal.xy *= 0.71;
       mapN = normalize(mix(mapN, damageNormal, exposedMasonry));`,
    ));
}

function addWeathering(material, kind) {
  const treatment = weathering[kind];
  if (!treatment) return;
  material.customProgramCacheKey = () => `marketline-surface-${kind}`;
  material.onBeforeCompile = shader => {
    shader.vertexShader = surfaceVaryings + shader.vertexShader.replace(
      '#include <project_vertex>',
      /* glsl */ `
        #include <project_vertex>
        marketSurfacePosition = (modelMatrix * vec4( transformed, 1.0 )).xyz;
        marketSurfaceVertical = 1.0 - abs( normalize( mat3( modelMatrix ) * normal ).y );
      `,
    );
    shader.fragmentShader = surfaceVaryings + surfaceNoise + (kind === 'plaster' ? damagedPlaster : '') + shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>\n{ ${treatment} }`,
    );
    if (kind === 'plaster') addPlasterDamage(material, shader);
  };
}

function loadTexture(kind, channel, colorSpace, anisotropy) {
  const path = `./assets/world-textures/${kind}-${channel}.webp`;
  const url = textures[path];
  if (!url) throw new Error(`Missing map texture ${path}`);
  let complete;
  textureLoads.push(new Promise(resolve => { complete = resolve; }));
  const texture = loader.load(url, () => complete(), undefined, () => complete(path));
  texture.name = `${kind}-${channel}`;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = colorSpace;
  texture.anisotropy = anisotropy;
  return texture;
}

export function createScannedMaterial(kind) {
  const scan = scans[kind];
  if (!scan) return null;
  const orm = loadTexture(kind, 'orm', THREE.NoColorSpace, 4);
  const material = new THREE.MeshStandardMaterial({
    name: `Marketline ${kind}`,
    vertexColors: true,
    map: loadTexture(kind, 'albedo', THREE.SRGBColorSpace, 8),
    normalMap: loadTexture(kind, 'normal', THREE.NoColorSpace, 8),
    normalScale: new THREE.Vector2(scan.normal, scan.normal),
    aoMap: orm,
    aoMapIntensity: scan.occlusion,
    roughnessMap: orm,
    roughness: scan.roughness,
    metalnessMap: scan.metalness ? orm : null,
    metalness: scan.metalness ?? 0,
  });
  if (kind === 'plaster') {
    material.plasterDamageAlbedo = loadTexture('plaster-damage', 'albedo', THREE.SRGBColorSpace, 8);
    material.plasterDamageNormal = loadTexture('plaster-damage', 'normal', THREE.NoColorSpace, 8);
  }
  addWeathering(material, kind);
  return material;
}

export async function waitForWorldMaterials() {
  const paths = (await Promise.all(textureLoads)).filter(Boolean);
  if (paths.length) throw new Error(`Could not decode map textures: ${paths.join(', ')}`);
}
