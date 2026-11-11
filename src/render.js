import * as THREE from 'three';
import * as S from './shaders.js';

const SUN = new THREE.Vector3(-.61, .79, -.39).normalize();
const CASCADE_DISTANCES = [19, 47, 89, 162];
const PRESETS = {
  Low:    { scale: .67, floor: .5,  shadows: 512,  cascades: 2, octaves: 3, ao: 0, bloom: 0,   density: .45 },
  Medium: { scale: .79, floor: .58, shadows: 768,  cascades: 3, octaves: 4, ao: 3, bloom: .7,  density: .7 },
  High:   { scale: .9,  floor: .63, shadows: 1024, cascades: 4, octaves: 5, ao: 4, bloom: .86, density: 1 },
  Ultra:  { scale: 1,   floor: .73, shadows: 1536, cascades: 4, octaves: 5, ao: 6, bloom: 1,   density: 1 },
};

function skyEnvironment(renderer) {
  const width = 256, height = 128;
  const data = new Float32Array(width * height * 4);
  const direction = new THREE.Vector3();
  for (let y = 0; y < height; y++) {
    const elevation = ((y + .5) / height - .5) * Math.PI;
    const up = Math.sin(elevation);
    const horizontal = Math.cos(elevation);
    for (let x = 0; x < width; x++) {
      const phi = ((x + .5) / width - .5) * 2 * Math.PI;
      direction.set(Math.cos(phi) * horizontal, up, Math.sin(phi) * horizontal);
      const facing = Math.max(0, direction.dot(SUN));
      const halo = facing ** 42 * .75 + facing ** 8 * .18;
      const horizon = Math.exp(-Math.abs(up) * 5.8);
      const bounce = Math.max(0, -up);
      const archWarmth = (.5 + .5 * Math.sin(phi * 2. + .6)) * Math.exp(-Math.abs(up - .08) * 9.);
      const base = (y * width + x) * 4;
      if (up >= 0) {
        data[base] = .13 + horizon * .52 + halo + archWarmth * .14;
        data[base + 1] = .34 + horizon * .39 + halo * .86 + archWarmth * .09;
        data[base + 2] = .78 + horizon * .06 + halo * .64;
      } else {
        // Warm sandstone & bazaar bounce light from ground and surrounding walls
        const plaza = .22 + .12 * Math.cos(phi * 3.);
        data[base] = (.24 + horizon * .18) * (1. - bounce * .35) + plaza * .12;
        data[base + 1] = (.18 + horizon * .16) * (1. - bounce * .38) + plaza * .08;
        data[base + 2] = (.12 + horizon * .14) * (1. - bounce * .42) + plaza * .05;
      }
      data[base + 3] = 1;
    }
  }
  const source = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  source.mapping = THREE.EquirectangularReflectionMapping;
  source.needsUpdate = true;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const result = pmrem.fromEquirectangular(source);
  source.dispose();
  pmrem.dispose();
  return result;
}

const shadowVertex = /* glsl */ `
varying vec3 mlWorld;
varying vec3 mlWorldNormal;
varying float mlZ;
`;
const shadowCoords = /* glsl */ `
vec4 mlPoint = vec4(transformed, 1.);
vec3 mlNorm = vec3(normal);
#ifdef USE_BATCHING
  mlPoint = batchingMatrix * mlPoint;
  mlNorm = mat3(batchingMatrix) * mlNorm;
#endif
#ifdef USE_INSTANCING
  mlPoint = instanceMatrix * mlPoint;
  mlNorm = mat3(instanceMatrix) * mlNorm;
#endif
mlWorld = (modelMatrix * mlPoint).xyz;
mlWorldNormal = normalize(mat3(modelMatrix) * mlNorm);
mlZ = -mvPosition.z;
`;

const shadowFragment = /* glsl */ `
uniform highp sampler2DArray mlAtlas;
uniform mat4 mlMatrix[4];
uniform int mlCount;
uniform float mlTexel;
uniform float mlTime;
varying vec3 mlWorld;
varying vec3 mlWorldNormal;
varying float mlZ;

float mlHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * .1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float mlNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3. - 2. * f);
  return mix(mix(mlHash(i), mlHash(i + vec2(1., 0.)), f.x),
             mix(mlHash(i + vec2(0., 1.)), mlHash(i + vec2(1., 1.)), f.x), f.y);
}

const vec2 mlPoisson[8] = vec2[8](
  vec2(-.613, .354), vec2(.178, -.741), vec2(-.752, -.412), vec2(.692, .481),
  vec2(-.152, .812), vec2(.784, -.215), vec2(-.341, -.124), vec2(.245, .289)
);

float mlSingle(int cascade, vec3 world, float rot) {
  vec4 proj = mlMatrix[cascade] * vec4(world, 1.);
  vec3 p = proj.xyz * .5 + .5;
  if (any(lessThan(p, vec3(.001))) || any(greaterThan(p, vec3(.999)))) return 1.;
  float c = cos(rot), s = sin(rot);
  mat2 basis = mat2(c, -s, s, c);
  float radius = mlTexel * (1.28 + float(cascade) * .28);
  float bias = .00034 + float(cascade) * .00017;
  float visibility = 0.;
  for (int i = 0; i < 8; i++) {
    vec2 offset = basis * mlPoisson[i] * radius;
    float z = unpackRGBAToDepth(texture(mlAtlas, vec3(p.xy + offset, float(cascade))));
    visibility += step(p.z - bias, z);
  }
  return visibility * .125;
}

float mlShadow(vec3 world) {
  int k = mlZ < 19. ? 0 : mlZ < 47. ? 1 : mlZ < 89. ? 2 : 3;
  if (mlCount == 2) k = mlZ < 19. ? 0 : 1;
  if (mlCount == 3) k = min(k, 2);
  float rot = mlHash(floor(gl_FragCoord.xy) + vec2(float(k) * 17.3, 9.1)) * 6.283185;
  float a = mlSingle(k, world, rot);
  float end = k == 0 ? 19. : k == 1 ? 47. : k == 2 ? 89. : 162.;
  float weight = smoothstep(end - 4.5, end, mlZ);
  if (k < mlCount - 1 && weight > .0) a = mix(a, mlSingle(k + 1, world, rot), weight);
  float field = sin(world.x * .024 + world.z * .017 - mlTime * .041) * sin(world.z * .031 + mlTime * .027);
  return mix(.095, 1., a) * (1. - .125 * smoothstep(.1, .91, field));
}
`;

function screenMaterial(fragmentShader, uniforms) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: S.screenVertex,
    fragmentShader: 'in vec2 uvScreen;\n' + fragmentShader,
    uniforms: Object.fromEntries(Object.entries(uniforms).map(([key, value]) => [key, { value }])),
    depthTest: false, depthWrite: false, toneMapped: false, blending: THREE.NoBlending,
  });
}

function lutTexture() {
  const size = 33, data = new Uint8Array(size ** 3 * 4);
  for (let b = 0, i = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++, i += 4) {
        const rgb = [r / 32, g / 32, b / 32];
        const lum = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
        const mid = 4 * lum * (1 - lum);
        const saturation = 1.065 + .06 * mid;
        const shift = [mid * .016, mid * .007, -mid * .007];
        for (let j = 0; j < 3; j++) {
          const c = (rgb[j] - lum) * saturation + lum + shift[j];
          data[i + j] = Math.round(255 * THREE.MathUtils.clamp(c, 0, 1));
        }
        data[i + 3] = 255;
      }
    }
  }
  const texture = new THREE.Data3DTexture(data, size, size, size);
  texture.format = THREE.RGBAFormat;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

class SunShadows {
  constructor(renderer) {
    this.renderer = renderer;
    this.cameras = CASCADE_DISTANCES.map(() => {
      const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, .5, 320);
      camera.layers.set(2);
      return camera;
    });
    this.matrices = this.cameras.map(() => new THREE.Matrix4());
    this.material = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
    this.uniforms = {
      mlAtlas: { value: null }, mlMatrix: { value: this.matrices }, mlCount: { value: 4 },
      mlTexel: { value: 1 / 1024 }, mlTime: { value: 0 },
    };
    this.targets = new Set();
    this.center = new THREE.Vector3();
    this.facing = new THREE.Vector3();
    this.axisX = new THREE.Vector3(0, 1, 0).cross(SUN).normalize();
    this.axisY = new THREE.Vector3().crossVectors(SUN, this.axisX).normalize();
    this.extents = [17, 38, 69, 120];
  }

  configure(preset) {
    if (this.target?.width === preset.shadows && this.count === preset.cascades) return;
    this.target?.dispose();
    this.count = preset.cascades;
    this.target = new THREE.WebGLArrayRenderTarget(preset.shadows, preset.shadows, 4, {
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false,
    });
    this.uniforms.mlAtlas.value = this.target.texture;
    this.uniforms.mlCount.value = this.count;
    this.uniforms.mlTexel.value = 1 / preset.shadows;
    this.dirty = true;
  }

  register(scene) {
    scene.traverse(object => {
      if (!object.isMesh) return;
      if (object.castShadow) object.layers.enable(2);
      if (!object.receiveShadow) return;
      for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
        if (this.targets.has(material) || (!material.isMeshStandardMaterial && !material.isMeshPhysicalMaterial)) continue;
        this.targets.add(material);
        const before = material.onBeforeCompile.bind(material);
        const oldKey = material.customProgramCacheKey();
        material.onBeforeCompile = (shader, renderer) => {
          before(shader, renderer);
          Object.assign(shader.uniforms, this.uniforms);
          shader.vertexShader = shadowVertex + shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n' + shadowCoords);
          shader.fragmentShader = shader.fragmentShader.replace('#include <packing>', '#include <packing>\n' + shadowFragment)
            .replace('#include <color_fragment>', `#include <color_fragment>
              {
                float macroA = mlNoise(mlWorld.xz * .13 + vec2(mlWorld.y * .19, -mlWorld.y * .14));
                float macroB = mlNoise(mlWorld.xz * .85 - vec2(mlWorld.y * .67, mlWorld.x * .31));
                float groundAO = mix(mix(.77, 1., smoothstep(.0, .48, mlWorld.y)), 1., smoothstep(.45, .85, abs(mlWorldNormal.y)));
                float soffitAO = mix(.82, 1., smoothstep(-.85, -.08, mlWorldNormal.y));
                float sunBleach = 1. + (.045 * macroA - .022) + (.032 * macroB - .016);
                diffuseColor.rgb *= groundAO * soffitAO * sunBleach;
              }`)
            .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
              {
                float microVar = mlNoise(mlWorld.xz * 1.45 + mlWorld.y * .95) - .5;
                roughnessFactor = clamp(roughnessFactor + microVar * .09, .08, .99);
                if (mlWorld.y < .035 && mlWorldNormal.y > .82) {
                  float puddle = smoothstep(.58, .79, mlNoise(mlWorld.xz * .21 + vec2(3.7, -6.2)))
                    * smoothstep(5.8, 1.4, abs(mlWorld.x));
                  roughnessFactor = mix(roughnessFactor, .16, puddle * .68);
                  diffuseColor.rgb *= 1. - puddle * .22;
                }
              }`)
            .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace(
              'getDirectionalLightInfo( directionalLight, directLight );',
              'getDirectionalLightInfo( directionalLight, directLight );\n directLight.color *= mlShadow(mlWorld);',
            ));
        };
        material.customProgramCacheKey = () => oldKey + ':marketline-sun-array';
        material.needsUpdate = true;
      }
    });
  }

  draw(scene, view, frame, time) {
    this.uniforms.mlTime.value = time;
    const r = this.renderer;
    const previousOverride = scene.overrideMaterial;
    scene.overrideMaterial = this.material;
    view.getWorldDirection(this.facing);
    this.facing.y *= .18;
    for (let i = 0; i < this.count; i++) {
      if (!this.dirty && (i === 1 && frame % 2 !== 0 || i === 2 && frame % 4 !== 1 || i === 3 && frame % 8 !== 2)) continue;
      const camera = this.cameras[i];
      let extent = this.extents[i], distance = CASCADE_DISTANCES[i];
      if (i === 1 && this.count === 2 || i === 2 && this.count === 3) {
        extent = i === 1 ? 87 : 102;
        distance = 130;
      }
      const texel = 2 * extent / this.target.width;
      const center = this.center.copy(view.position).addScaledVector(this.facing, distance * .38);
      const x = center.dot(this.axisX), y = center.dot(this.axisY);
      center.addScaledVector(this.axisX, Math.round(x / texel) * texel - x);
      center.addScaledVector(this.axisY, Math.round(y / texel) * texel - y);
      camera.position.copy(center).addScaledVector(SUN, 134);
      camera.lookAt(center);
      camera.left = camera.bottom = -extent;
      camera.right = camera.top = extent;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      this.matrices[i].multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      r.setRenderTarget(this.target, i);
      r.setClearColor(0xffffff, 1);
      r.clear();
      r.render(scene, camera);
    }
    scene.overrideMaterial = previousOverride;
    this.dirty = false;
  }

  dispose() {
    this.target?.dispose();
    this.material.dispose();
  }
}

function halton(index, base) {
  let fraction = 1, value = 0;
  while (index > 0) {
    fraction /= base;
    value += fraction * (index % base);
    index = Math.floor(index / base);
  }
  return value;
}

export class RenderGraph {
  constructor(canvas, scene, camera, weaponScene, settings, fixed = false) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('This game needs a browser with hardware-accelerated WebGL2.');
    this.gl = gl;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpu = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    this.renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: false, alpha: false });
    this.renderer.autoClear = false;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;
    this.scene = scene;
    this.camera = camera;
    this.weaponScene = weaponScene;
    this.weaponCamera = new THREE.PerspectiveCamera(57, 1, .015, 14);
    this.settings = settings;
    this.fixed = fixed;
    this.frame = 0;
    this.jitterIndex = 0;
    this.gasVector = new THREE.Vector3();
    this.index = 0;
    this.valid = 0;
    this.hdr = Boolean(gl.getExtension('EXT_color_buffer_float'));
    this.type = this.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.lowPrecision = this.hdr ? 0 : 1;
    this.prevVP = new THREE.Matrix4();
    this.inverseVP = new THREE.Matrix4();
    this.vp = new THREE.Matrix4();
    this.texel = new THREE.Vector2();
    this.aoTexel = new THREE.Vector2();
    this.tileTexel = new THREE.Vector2();
    this.weaponSunVector = new THREE.Vector3();
    this.inverseCamera = new THREE.Quaternion();
    this.size = [0, 0];
    this.targets = [];
    this.debug = 0;
    this.timing = { calls: 0, triangles: 0, scale: 1 };
    this.grade = lutTexture();
    this.shadows = new SunShadows(this.renderer);
    this.environment = this.hdr ? skyEnvironment(this.renderer) : null;
    if (this.environment) {
      scene.environment = weaponScene.environment = this.environment.texture;
      scene.environmentIntensity = .19;
      weaponScene.environmentIntensity = .34;
    }
    this.motionScene = new THREE.Scene();
    this.motionMeshes = [];

    this.sun = new THREE.DirectionalLight(0xffedce, 3.55);
    this.sun.position.copy(SUN).multiplyScalar(85);
    this.skyLight = new THREE.HemisphereLight(0xc3dfff, 0x937857, 1.56);
    scene.fog = new THREE.FogExp2(0xa9b7c0, .0064);
    scene.add(this.sun, this.skyLight);
    this.weaponSun = new THREE.DirectionalLight(0xffefd7, 2.65);
    this.weaponSky = new THREE.HemisphereLight(0xc6defc, 0x9d7e62, 1.38);
    this.weaponSun.castShadow = true;
    this.weaponSun.target.position.set(0, -.15, -.51);
    this.weaponSun.shadow.camera.left = this.weaponSun.shadow.camera.bottom = -.66;
    this.weaponSun.shadow.camera.right = this.weaponSun.shadow.camera.top = .66;
    this.weaponSun.shadow.camera.near = 3.1;
    this.weaponSun.shadow.camera.far = 6.9;
    this.weaponSun.shadow.camera.updateProjectionMatrix();
    this.weaponSun.shadow.mapSize.set(512, 512);
    this.weaponSun.shadow.normalBias = .0024;
    this.weaponSun.shadow.bias = -.00015;
    this.weaponFlash = new THREE.PointLight(0xffa055, 0, 1.5, 2);
    this.weaponFlash.position.set(.22, -.10, -.8);
    weaponScene.add(this.weaponSun, this.weaponSun.target, this.weaponSky, this.weaponFlash);

    this.screen = new THREE.Scene();
    this.screenCamera = new THREE.Camera();
    const triangle = new THREE.BufferGeometry();
    triangle.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.triangle = new THREE.Mesh(triangle);
    this.triangle.frustumCulled = false;
    this.screen.add(this.triangle);
    this.sky = screenMaterial(S.sky, {
      inverseVP: this.inverseVP, eye: camera.position, sun: SUN, time: 0, cloudOctaves: 5,
    });
    this.geometry = screenMaterial(S.geometryBuffers, {
      sceneDepth: null, inverseVP: this.inverseVP, previousVP: this.prevVP, view: camera.matrixWorldInverse,
      texel: this.texel, lowPrecision: this.lowPrecision,
    });
    this.motion = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: S.motionVertex, fragmentShader: S.motionFragment,
      uniforms: {
        previousVP: { value: this.prevVP }, previousModel: { value: new THREE.Matrix4() }, deforming: { value: 0 },
        previousSkin: { value: null }, hasPreviousSkin: { value: false },
        sceneDepth: { value: null }, texel: { value: this.texel }, lowPrecision: { value: this.lowPrecision },
      },
      depthTest: false, depthWrite: false, toneMapped: false, blending: THREE.NoBlending,
    });
    this.motion.defaultAttributeValues.previousPosition = [0, 0, 0];
    this.ao = screenMaterial(S.ao, {
      depthNormal: null, velocity: null, previousAO: null, inverseProjection: camera.projectionMatrixInverse,
      texel: this.texel, valid: 0, frame: 0, taps: 4, lowPrecision: this.lowPrecision,
    });
    this.temporal = screenMaterial(S.temporal, {
      currentColor: null, history: null, depthNormal: null, velocity: null, ao: null,
      mlAtlas: null, mlMatrix0: this.shadows.matrices[0], mlMatrix1: this.shadows.matrices[1],
      inverseVP: this.inverseVP, eye: camera.position, sun: SUN, frame: 0,
      texel: this.texel, aoTexel: this.aoTexel, valid: 0, applyAO: 1, lowPrecision: this.lowPrecision,
    });
    this.bloom = screenMaterial(S.bloom, { image: null, hands: null, texel: new THREE.Vector2(), first: 1 });
    this.exposure = screenMaterial(S.exposure, { image: null, previousExposure: null, delta: .016, valid: 0 });
    this.tileVelocity = screenMaterial(S.tileVelocity, { velocity: null, texel: this.texel });
    this.composite = screenMaterial(S.composite, {
      image: null, hands: null, bloom0: null, bloom1: null, bloom2: null, exposure: null, depthNormal: null,
      velocity: null, tiles: null, aoDebug: null, grade: this.grade, texel: this.texel, tileTexel: this.tileTexel,
      time: 0, damage: 0, critical: 0, heat: 1, blur: .15, bloomAmount: 1,
      vignette: 1, chromatic: 0, gas: this.gasVector, lowPrecision: this.lowPrecision, debug: 0, toneMappingExposure: 1,
    });
    this.configure(settings);
  }

  makeTarget(w, h, { depth = false, count = 1, nearest = false, type = this.type } = {}) {
    const target = new THREE.WebGLRenderTarget(w, h, {
      type, depthBuffer: depth, stencilBuffer: false, count,
      minFilter: nearest ? THREE.NearestFilter : THREE.LinearFilter,
      magFilter: nearest ? THREE.NearestFilter : THREE.LinearFilter,
    });
    this.targets.push(target);
    return target;
  }

  configure(settings) {
    this.settings = settings;
    const next = PRESETS[settings.quality] || PRESETS.High;
    if (next !== this.preset) {
      this.preset = next;
      this.scale = next.scale;
      this.shadows.configure(next);
      this.resize(true);
    }
  }

  resize(force = false) {
    const width = Math.max(2, innerWidth), height = Math.max(2, innerHeight);
    const ratio = Math.min(devicePixelRatio, 1.5);
    if (!force && width === this.size[0] && height === this.size[1] && ratio === this.ratio) return;
    this.size = [width, height];
    this.ratio = ratio;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = this.weaponCamera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.weaponCamera.updateProjectionMatrix();
    this.allocate();
  }

  allocate() {
    for (const target of this.targets) target.dispose();
    this.targets.length = 0;
    const canvas = this.renderer.domElement;
    const w = Math.max(2, Math.round(canvas.width * this.scale));
    const h = Math.max(2, Math.round(canvas.height * this.scale));
    const aw = Math.ceil(w / 2), ah = Math.ceil(h / 2);
    this.texel.set(1 / w, 1 / h);
    this.aoTexel.set(1 / aw, 1 / ah);
    this.sceneColor = this.makeTarget(w, h, { depth: true });
    this.sceneColor.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    this.viewColor = this.makeTarget(w, h, { depth: true });
    if (this.preset.ao >= 4) this.viewColor.samples = Math.min(4, this.renderer.capabilities.maxSamples);
    this.buffers = this.makeTarget(w, h, { count: 2, nearest: true });
    this.aoHistory = [this.makeTarget(aw, ah), this.makeTarget(aw, ah)];
    this.history = [this.makeTarget(w, h), this.makeTarget(w, h)];
    this.exposureHistory = [this.makeTarget(1, 1), this.makeTarget(1, 1)];
    this.blooms = [4, 8, 16].map(step => this.makeTarget(Math.ceil(w / step), Math.ceil(h / step)));
    this.tiles = this.makeTarget(Math.ceil(w / 15), Math.ceil(h / 15), { nearest: true });
    this.tileTexel.set(1 / this.tiles.width, 1 / this.tiles.height);
    this.valid = 0;
    this.shadows.dirty = true;
  }

  register() { this.shadows.register(this.scene); }

  trackMotion(root, active = () => true) {
    root.traverse(source => {
      if (!source.isMesh || source.isInstancedMesh || !source.geometry.attributes.normal || source.material.transparent) return;
      const proxy = source.isSkinnedMesh
        ? new THREE.SkinnedMesh(source.geometry, this.motion)
        : new THREE.Mesh(source.geometry, this.motion);
      let previousSkin = null;
      if (source.isSkinnedMesh) {
        proxy.skeleton = source.skeleton;
        proxy.bindMatrix.copy(source.bindMatrix);
        proxy.frustumCulled = false;
        const boneCount = source.skeleton.bones.length;
        previousSkin = new THREE.DataTexture(new Float32Array(boneCount * 16), 4, boneCount, THREE.RGBAFormat, THREE.FloatType);
        previousSkin.needsUpdate = true;
      }
      proxy.matrixAutoUpdate = false;
      const previous = new THREE.Matrix4();
      const entry = { source, proxy, previous, previousSkin, skinReady: false, root, active };
      proxy.onBeforeRender = () => {
        this.motion.uniforms.previousModel.value.copy(this.valid ? previous : proxy.matrix);
        this.motion.uniforms.deforming.value = Number(proxy.geometry.hasAttribute('previousPosition'));
        this.motion.uniforms.previousSkin.value = previousSkin;
        this.motion.uniforms.hasPreviousSkin.value = Boolean(this.valid && entry.skinReady);
        this.motion.uniformsNeedUpdate = true;
      };
      this.motionScene.add(proxy);
      this.motionMeshes.push(entry);
    });
  }

  drawMotion() {
    this.motion.uniforms.sceneDepth.value = this.sceneColor.depthTexture;
    for (const { source, proxy, root, active } of this.motionMeshes) {
      proxy.visible = active();
      for (let current = source; current; current = current.parent) {
        if (!current.visible) { proxy.visible = false; break; }
        if (current === root) break;
      }
      const priorPositions = source.geometry.getAttribute('previousPosition');
      if (priorPositions && (!this.valid || proxy.geometry !== source.geometry)) {
        priorPositions.array.set(source.geometry.attributes.position.array);
        priorPositions.needsUpdate = true;
      }
      proxy.geometry = source.geometry;
      proxy.matrix.copy(source.matrixWorld);
      proxy.matrixWorldNeedsUpdate = true;
    }
    this.renderer.render(this.motionScene, this.camera);
    for (const entry of this.motionMeshes) {
      const { proxy, previous, previousSkin } = entry;
      previous.copy(proxy.matrix);
      if (previousSkin && proxy.visible) {
        const data = previousSkin.image.data;
        data.set(proxy.skeleton.boneMatrices.subarray(0, data.length));
        previousSkin.needsUpdate = true;
        entry.skinReady = true;
      } else if (previousSkin) entry.skinReady = false;
      const priorPositions = proxy.geometry.getAttribute('previousPosition');
      if (!priorPositions || !proxy.visible) continue;
      priorPositions.array.set(proxy.geometry.attributes.position.array);
      priorPositions.needsUpdate = true;
    }
  }

  invalidate() {
    this.valid = 0;
    this.shadows.dirty = true;
  }

  pass(material, target, uniforms) {
    for (const key in uniforms) material.uniforms[key].value = uniforms[key];
    this.triangle.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.screen, this.screenCamera);
  }

  render(time, dt, {
    health = 100, hurt = 0, flash = 0, weapon = true, light = 1, moving = true,
    particles, gas, gasStrength = 0,
  } = {}) {
    this.resize();
    const { renderer: r, scene, camera, weaponCamera, weaponScene, preset } = this;
    this.frame++;
    r.info.reset();
    camera.updateProjectionMatrix();
    if (moving && preset.ao) {
      const i = (++this.jitterIndex % 16) + 1;
      camera.projectionMatrix.elements[8] += (halton(i, 2) - .5) * this.texel.x * 1.6;
      camera.projectionMatrix.elements[9] += (halton(i, 3) - .5) * this.texel.y * 1.6;
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    }
    camera.updateMatrixWorld();
    this.vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.inverseVP.copy(this.vp).invert();
    if (!this.valid) this.prevVP.copy(this.vp);

    if (moving || this.shadows.dirty) this.shadows.draw(scene, camera, this.frame, time);
    r.setRenderTarget(this.sceneColor);
    r.clearDepth();
    this.pass(this.sky, this.sceneColor, { time, cloudOctaves: preset.octaves });
    r.render(scene, camera);

    r.setRenderTarget(this.viewColor);
    r.setClearColor(0x000000, 0);
    r.clear();
    if (weapon) {
      this.inverseCamera.copy(camera.quaternion).invert();
      this.weaponSunVector.copy(SUN).applyQuaternion(this.inverseCamera);
      this.weaponSun.position.copy(this.weaponSunVector).multiplyScalar(5).add(this.weaponSun.target.position);
      this.weaponSun.intensity = 2.65 * light;
      this.weaponFlash.intensity = flash * 1.8;
      r.render(weaponScene, weaponCamera);
    }

    this.pass(this.geometry, this.buffers, { sceneDepth: this.sceneColor.depthTexture });
    if (preset.ao >= 4 && moving) this.drawMotion();
    const [depthNormal, velocity] = this.buffers.textures;
    if (particles && moving) {
      particles.uniforms.depthNormal.value = depthNormal;
      particles.uniforms.depthTexel.value.copy(this.texel);
      particles.uniforms.lowPrecision.value = this.lowPrecision;
      const layers = camera.layers.mask;
      camera.layers.set(3);
      r.setRenderTarget(this.sceneColor);
      r.render(scene, camera);
      camera.layers.mask = layers;
    }
    const next = 1 - this.index;
    if (preset.ao) this.pass(this.ao, this.aoHistory[next], {
      depthNormal, velocity, previousAO: this.aoHistory[this.index].texture,
      valid: this.valid, frame: this.frame % 25, taps: preset.ao,
    });
    this.pass(this.temporal, this.history[next], {
      currentColor: this.sceneColor.texture, history: this.history[this.index].texture,
      depthNormal, velocity, ao: this.aoHistory[next].texture,
      mlAtlas: this.shadows.uniforms.mlAtlas.value, frame: this.frame % 32,
      applyAO: Number(Boolean(preset.ao)), valid: this.valid && preset.ao ? 1 : 0,
    });
    const image = this.history[next].texture;
    const hands = this.viewColor.texture;
    const bloomAmount = this.hdr ? preset.bloom : 0;
    if (bloomAmount) {
      let from = this.sceneColor;
      for (let i = 0; i < this.blooms.length; i++) {
        this.bloom.uniforms.texel.value.set(1 / from.width, 1 / from.height);
        this.pass(this.bloom, this.blooms[i], { image: from.texture, hands, first: Number(i === 0) });
        from = this.blooms[i];
      }
    }
    this.pass(this.exposure, this.exposureHistory[next], {
      image, previousExposure: this.exposureHistory[this.index].texture, delta: dt, valid: this.valid,
    });
    const blur = this.settings.blur === 'High' ? .47 : this.settings.blur === 'Low' ? .17 : 0;
    if (blur) this.pass(this.tileVelocity, this.tiles, { velocity });
    this.gasVector.set(0, 0, 0);
    if (gas) {
      this.gasVector.copy(gas).project(weaponCamera);
      this.gasVector.set(this.gasVector.x * .5 + .5, this.gasVector.y * .5 + .5, gasStrength);
    }
    this.pass(this.composite, null, {
      image, hands, bloom0: this.blooms[0].texture, bloom1: this.blooms[1].texture, bloom2: this.blooms[2].texture,
      exposure: this.exposureHistory[next].texture, depthNormal, velocity, tiles: this.tiles.texture,
      aoDebug: this.aoHistory[next].texture, time, damage: hurt, critical: Math.max(0, 1 - health / 40), blur, bloomAmount, heat: Number(preset.ao > 0),
      vignette: Number(this.settings.vignette), chromatic: Number(this.settings.chromatic), debug: this.debug,
    });

    this.index = next;
    this.valid = 1;
    this.prevVP.copy(this.vp);
    this.timing.calls = r.info.render.calls;
    this.timing.triangles = r.info.render.triangles;
    this.timing.scale = this.scale;
    if (!this.fixed && moving && this.settings.dynamic) this.adapt(dt);
  }

  adapt(dt) {
    if (dt >= .13) return;
    this.average = (this.average ?? dt) * .978 + dt * .022;
    if (this.frame < 90 || this.frame % 48 !== 0) return;
    const { floor, scale } = this.preset;
    const next = Math.max(floor, Math.min(scale, this.scale + (this.average > .023 ? -.055 : this.average < .016 ? .025 : 0)));
    if (Math.abs(next - this.scale) > .005) {
      this.scale = next;
      this.allocate();
    }
  }

  dispose() {
    for (const target of this.targets) target.dispose();
    this.shadows.dispose();
    for (const { previousSkin } of this.motionMeshes) previousSkin?.dispose();
    this.motion.dispose();
    this.environment?.dispose();
    this.weaponSun.shadow.dispose();
    for (const pass of [this.sky, this.geometry, this.ao, this.temporal, this.bloom, this.exposure, this.tileVelocity, this.composite]) pass.dispose();
    this.triangle.geometry.dispose();
    this.triangle.material.dispose();
    this.grade.dispose();
    this.renderer.dispose();
  }
}
