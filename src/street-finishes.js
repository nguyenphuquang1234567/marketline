import * as THREE from 'three';

const finishNoise = /* glsl */ `
varying vec3 streetPosition;
float streetHash(vec3 p) {
  p = fract(p * .1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float streetNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3. - 2. * f);
  return mix(
    mix(mix(streetHash(i), streetHash(i + vec3(1,0,0)), f.x),
        mix(streetHash(i + vec3(0,1,0)), streetHash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(streetHash(i + vec3(0,0,1)), streetHash(i + vec3(1,0,1)), f.x),
        mix(streetHash(i + vec3(0,1,1)), streetHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
`;

function paintedSteel(material, name, corrosion, coat, burnt = false) {
  material.customProgramCacheKey = () => 'marketline-steel-' + name;
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec3 streetPosition;\n' + shader.vertexShader.replace(
      '#include <project_vertex>', '#include <project_vertex>\nstreetPosition = (modelMatrix * vec4(transformed, 1.)).xyz;',
    );
    shader.fragmentShader = finishNoise + shader.fragmentShader
      .replace('#include <color_fragment>', /* glsl */ `
        #include <color_fragment>
        vec3 p = streetPosition;
        float fleck = streetNoise(p * 82.);
        float runoff = streetNoise(p * vec3(18., 2.8, 18.));
        float variation = streetNoise(p * 6. + vec3(5., 0., 0.));
        float wash = smoothstep(.38, .81, runoff * .65 + variation * .35);
        float dust = wash * mix(.28, .91, 1. - smoothstep(.16, .96, p.y));
        float chip = smoothstep(.66, .80, fleck * .44 + runoff * .30 + variation * .26);
        chip = min(1., chip * ${corrosion.toFixed(3)}) * (1. - smoothstep(9., 20., length(vViewPosition)));
        diffuseColor.rgb *= .80 + .29 * variation + .07 * fleck - .20 * wash;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.20, .142, .088), dust * .44);
        vec3 oxide = mix(vec3(.05, .032, .023), vec3(.21, .095, .043), fleck);
        diffuseColor.rgb = mix(diffuseColor.rgb, oxide, chip * .86);
        float scorch = 0.;
        ${burnt ? `
          float broad = streetNoise(p * vec3(1.9, 3.5, 2.0) + vec3(7., .3, 0.));
          float carbon = .78 * broad + .15 * runoff + .07 * variation;
          float plume = smoothstep(.45, .74, carbon);
          float blister = smoothstep(.42, .58, carbon) - smoothstep(.57, .70, carbon);
          scorch = max(plume, blister * .24);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.15, .089, .044), blister * .44);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.018, .017, .014) * (.8 + fleck * .6), plume * .92);
        ` : ''}
      `)
      .replace('#include <roughnessmap_fragment>', /* glsl */ `
        #include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, .86, clamp(dust * .62 + wash * .13 + chip + scorch * .74, 0., 1.));
      `)
      .replace('#include <metalnessmap_fragment>', /* glsl */ `
        #include <metalnessmap_fragment>
        metalnessFactor *= 1. - min(.8, chip + dust * .4 + scorch * .5);
      `)
      .replace('#include <normal_fragment_maps>', /* glsl */ `
        #include <normal_fragment_maps>
        vec3 dpdx = dFdx(-vViewPosition);
        vec3 dpdy = dFdy(-vViewPosition);
        vec3 ry = cross(dpdy, normal), rx = cross(normal, dpdx);
        float det = dot(dpdx, ry);
        float relief = ((fleck - .5) * .00032 - chip * .00075) * (1. - smoothstep(7., 17., length(vViewPosition)));
        normal = normalize(max(abs(det), 1e-9) * normal - sign(det) * (dFdx(relief) * ry + dFdy(relief) * rx));
      `)
      .replace('#include <lights_physical_fragment>', /* glsl */ `
        #include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
          material.clearcoat *= ${coat.toFixed(3)} * (1. - min(.86, dust + chip));
          material.clearcoatRoughness = mix(material.clearcoatRoughness, .58, dust);
        #endif
      `);
  };
  return material;
}

const labelRows = [
  ['plate0', '#cfc5a8', '#322f26', 'MR · 1842', 'AL MARFA'],
  ['plate1', '#cfc5a8', '#322f26', 'MR · 2716', 'AL MARFA'],
  ['plate2', '#cfc5a8', '#322f26', 'MR · 3041', 'AL MARFA'],
  ['plate3', '#cfc5a8', '#322f26', 'MR · 1319', 'AL MARFA'],
  ['delivery', '#455b56', '#e5d7b7', 'AL MARFA', 'COOPÉRATIVE DU MARCHÉ'],
  ['fuel', '#b7a481', '#493b2c', 'CARBURANT', 'INFLAMMABLE  ·  UN 1203'],
  ['cargo', '#c3ad80', '#493829', '↑    ↑', 'GARDER AU SEC'],
  ['meter', '#b9ac89', '#4a3d2e', '⚡  230 V', 'POSTE 04'],
  ['label', '#c8bba0', '#544132', 'POIDS NET', '25 KG  ·  LOT 07'],
  ['scale', '#d0c19d', '#3b3329'],
];

const labelColumns = 3;
const labelWidth = 256;
const labelHeight = 128;
const atlasWidth = labelColumns * labelWidth;
const atlasHeight = Math.ceil(labelRows.length / labelColumns) * labelHeight;

function labelAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = atlasWidth;
  canvas.height = atlasHeight;
  const ctx = canvas.getContext('2d');
  ctx.textAlign = 'center';
  let seed = 153;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (const [i, [, bg, ink, headline, subhead]] of labelRows.entries()) {
    const x = (i % labelColumns) * labelWidth;
    const y = Math.floor(i / labelColumns) * labelHeight;
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, 256, 128);
    if (headline) {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 12, y + 12, 232, 104);
      ctx.fillStyle = ink;
      ctx.font = 'bold 36px sans-serif';
      ctx.fillText(headline, x + 128, y + 62);
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText(subhead, x + 128, y + 92);
    } else {
      ctx.save();
      ctx.translate(x + 128, y + 64);
      ctx.scale(2, 1);
      ctx.strokeStyle = ink;
      ctx.fillStyle = ink;
      ctx.font = 'bold 10px sans-serif';
      for (let tick = 0; tick <= 25; tick++) {
        const angle = -Math.PI * .81 + tick / 25 * Math.PI * 1.62;
        const major = tick % 5 === 0;
        const dx = Math.sin(angle), dy = -Math.cos(angle);
        ctx.lineWidth = major ? 1.8 : .9;
        ctx.beginPath();
        ctx.moveTo(dx * (major ? 44 : 48), dy * (major ? 44 : 48));
        ctx.lineTo(dx * 53, dy * 53);
        ctx.stroke();
        if (major) ctx.fillText(tick / 5, dx * 37, dy * 37 + 3.2);
      }
      ctx.fillText('kg', 0, 26);
      ctx.strokeStyle = '#9c422a';
      ctx.lineWidth = 2.7;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-26, 37);
      ctx.stroke();
      ctx.restore();
    }
    for (let dot = 0; dot < 570; dot++) {
      ctx.fillStyle = dot % 4 === 0 ? 'rgba(45,31,19,.21)' : 'rgba(225,204,164,.23)';
      ctx.fillRect(x + random() * 253, y + random() * 125, 1 + random() * 2.4, 1 + random() * 2.1);
    }
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return map;
}

export function streetLabelUV(geometry, name) {
  const i = labelRows.findIndex(row => row[0] === name);
  const u = ((i % labelColumns) * labelWidth + 3) / atlasWidth;
  const v = 1 - (Math.floor(i / labelColumns) * labelHeight + labelHeight - 3) / atlasHeight;
  const uv = geometry.getAttribute('uv');
  for (let j = 0; j < uv.count; j++) {
    uv.setXY(j, u + uv.getX(j) * (labelWidth - 6) / atlasWidth, v + uv.getY(j) * (labelHeight - 6) / atlasHeight);
  }
  return geometry;
}

function sandbagFabric(cloth) {
  const material = cloth.clone();
  material.normalScale.setScalar(.76);
  material.customProgramCacheKey = () => 'marketline-sandbag';
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec3 streetPosition;\n' + shader.vertexShader.replace(
      '#include <project_vertex>', '#include <project_vertex>\nstreetPosition = (modelMatrix * vec4(transformed, 1.)).xyz;',
    );
    shader.fragmentShader = finishNoise + shader.fragmentShader.replace('#include <color_fragment>', /* glsl */ `
      #include <color_fragment>
      float soiling = smoothstep(.37, .76, streetNoise(streetPosition * 9.));
      float foldShade = streetNoise(streetPosition * vec3(21., 29., 21.));
      diffuseColor.rgb *= mix(vec3(1.02, .98, .94), vec3(.58, .46, .34), soiling * .7);
      diffuseColor.rgb *= mix(.88, 1.13, foldShade);
    `);
  };
  return material;
}

function truckGlazing() {
  const material = new THREE.MeshPhysicalMaterial({
    vertexColors: true, roughness: .24, metalness: .12, clearcoat: .85,
    clearcoatRoughness: .18, transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
  });
  material.customProgramCacheKey = () => 'marketline-cab-glazing';
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec2 cabUV;\n' + shader.vertexShader.replace(
      '#include <uv_vertex>', '#include <uv_vertex>\ncabUV = uv;',
    );
    shader.fragmentShader = 'varying vec2 cabUV;\n' + shader.fragmentShader.replace(
      '#include <opaque_fragment>', /* glsl */ `
        float reflection = pow(1. - abs(dot(normal, normalize(vViewPosition))), 3.);
        vec2 edge = min(cabUV, 1. - cabUV);
        float dirt = (1. - smoothstep(0., .17, min(edge.x, edge.y))) * .20;
        diffuseColor.a = .32 + .42 * reflection + dirt;
        #include <opaque_fragment>
      `,
    );
  };
  return material;
}

export function createStreetMaterials(materials) {
  materials.sandbag = sandbagFabric(materials.cloth);
  paintedSteel(materials.enamel, 'vehicle', .87, .88);
  materials.coatedSteel = paintedSteel(new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: .52, metalness: .27,
  }), 'painted', 1.48, 0);
  materials.burntSteel = paintedSteel(new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: .57, metalness: .22,
  }), 'scorched', 1.35, 0, true);
  materials.cabinGlass = truckGlazing();
  materials.autoGlass.roughness = .21;
  materials.autoGlass.metalness = .56;
  materials.autoGlass.envMapIntensity = 1.2;
  materials.streetLabel = new THREE.MeshStandardMaterial({
    vertexColors: true, map: labelAtlas(), roughness: .83, metalness: 0,
  });
}
