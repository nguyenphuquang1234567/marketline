import { streetWetnessGLSL } from './street-surface.js';

const roadReceiver = /* glsl */ `
${streetWetnessGLSL}

float roadReflectionWeight(vec3 point, vec3 normal, vec3 towardEye) {
  // Visible paving is just below y=0; keep wetness off the raised kerbs,
  // objects, and walls even where their footprints overlap a puddle.
  if (normal.y < .90 || point.y < -.065 || point.y > .032) return 0.;
  float wet = streetWetness(point.xz);
  float grazing = pow(1. - clamp(towardEye.y, 0., 1.), 5.);
  return wet * sqrt(wet) * (.018 + .68 * grazing);
}
`;

export const roadReflection = /* glsl */ `
uniform sampler2D sceneColor;
uniform sampler2D depthNormal;
uniform sampler2D skyPhoto;
uniform mat4 projection;
uniform mat4 inverseProjection;
uniform mat4 cameraWorld;
uniform mat4 view;
uniform vec3 eye;
uniform int reflectionSteps;
out vec4 pixel;
${roadReceiver}

vec3 roadDecodeNormal(vec2 encoded) {
  vec2 f = encoded * 2. - 1.;
  vec3 n = vec3(f, 1. - abs(f.x) - abs(f.y));
  n.xy += vec2(n.x >= 0. ? -1. : 1., n.y >= 0. ? -1. : 1.) * max(-n.z, 0.);
  return normalize(n);
}

vec2 reflectionUV(vec3 point) {
  vec4 clip = projection * vec4(point, 1.);
  return clip.xy / max(.001, clip.w) * .5 + .5;
}

bool onScreen(vec2 uv) {
  return all(greaterThan(uv, vec2(.003))) && all(lessThan(uv, vec2(.997)));
}

vec3 reflectedSky(vec3 direction) {
  vec2 uv = vec2(atan(direction.z, direction.x) / 6.2831853 + .5,
                 asin(clamp(direction.y, -1., 1.)) / 3.14159265 + .5);
  vec3 radiance = texture(skyPhoto, uv).rgb;
  float luminance = dot(radiance, vec3(.2126, .7152, .0722));
  return mix(vec3(luminance), radiance, .68) * .94;
}

void main() {
  pixel = vec4(0.);
  vec4 surface = texture(depthNormal, uvScreen);
  if (surface.a < .5 || surface.b > 58.) return;
  vec3 worldNormal = mat3(cameraWorld) * roadDecodeNormal(surface.rg);
  if (worldNormal.y < .90) return;

  vec4 ray = inverseProjection * vec4(uvScreen * 2. - 1., 1., 1.);
  vec3 viewPoint = ray.xyz * surface.b / max(.001, -ray.z);
  vec3 world = (cameraWorld * vec4(viewPoint, 1.)).xyz;
  vec3 towardEye = normalize(eye - world);
  float weight = roadReflectionWeight(world, worldNormal, towardEye) * (1. - smoothstep(38., 58., surface.b));
  if (weight < .004) return;

  // The film is smoother than its stone substrate. Bound fine angular breakup
  // in world space to prevent the reflected scene from vibrating at each stone.
  vec3 filmNormal = normalize(vec3(sin(world.x * 2.35 + world.z * 1.9) * .009, 1.,
    cos(world.z * 3.1 - world.x * 1.7) * .008));
  vec3 direction = reflect(-towardEye, filmNormal);
  vec3 viewDirection = mat3(view) * direction;
  vec3 start = viewPoint + mat3(view) * vec3(0., .044, 0.);
  vec3 sky = reflectedSky(direction);
  vec3 reflection = sky;
  float confidence = 0.;
  float prior = 0.;
  bool wasBehind = false;
  // Use short strides at the start and longer strides for far silhouettes.
  // Require a front-to-back depth crossing, then refine it on the same ray.
  for (int i = 1; i <= 20; i++) {
    if (i > reflectionSteps) break;
    float progress = float(i) / float(reflectionSteps);
    float travel = .11 + 27. * progress * progress;
    vec3 hit = start + viewDirection * travel;
    vec2 uv = reflectionUV(hit);
    if (hit.z > -.075 || !onScreen(uv)) break;
    vec4 sampleDepth = texture(depthNormal, uv);
    float penetration = -hit.z - sampleDepth.b;
    bool behind = sampleDepth.a > .5 && penetration > 0.;
    if (behind && !wasBehind) {
      float front = prior, back = travel;
      for (int j = 0; j < 4; j++) {
        float middle = .5 * (front + back);
        vec3 p = start + viewDirection * middle;
        vec4 d = texture(depthNormal, reflectionUV(p));
        if (d.a > .5 && -p.z > d.b) back = middle;
        else front = middle;
      }
      hit = start + viewDirection * back;
      uv = reflectionUV(hit);
      sampleDepth = texture(depthNormal, uv);
      penetration = -hit.z - sampleDepth.b;
      float thickness = .16 + sampleDepth.b * .004;
      vec3 sampledNormal = roadDecodeNormal(sampleDepth.rg);
      float hitY = (cameraWorld * vec4(hit, 1.)).y;
      if (sampleDepth.a > .5 && penetration < thickness && hitY > .055
        && dot(sampledNormal, viewDirection) < -.06) {
        vec2 edge = min(uv, 1. - uv);
        confidence = smoothstep(.008, .105, min(edge.x, edge.y))
          * (1. - smoothstep(.035, thickness, penetration)) * (1. - smoothstep(19., 27., back));
        reflection = texture(sceneColor, uv).rgb;
        float brightest = max(reflection.r, max(reflection.g, reflection.b));
        reflection /= 1. + .22 * max(0., brightest - 1.5);
        break;
      }
    }
    wasBehind = behind;
    prior = travel;
  }

  // Standard paving already reflects the environment probe. Keep this
  // low-confidence sky fill small and let traced structures carry the film.
  float skyWeight = (1. - confidence) * .34;
  pixel = vec4((sky * skyWeight + reflection * confidence) * weight,
    (skyWeight + confidence) * weight);
}
`;

export const roadReflectionUniforms = /* glsl */ `
uniform sampler2D reflectedRoad;
uniform float applyReflection;
${roadReceiver}
`;

export const blendRoadReflection = /* glsl */ `
  vec4 reflected = vec4(0.);
  if (applyReflection > .5 && d.a > .5 && linZ < 58.) {
    vec4 sampleRoad = texture(reflectedRoad, uvScreen);
    if (sampleRoad.a > .002) {
      vec4 ray = inverseVP * vec4(uvScreen * 2. - 1., 1., 1.);
      vec3 world = eye + (ray.xyz - eye * ray.w) * linZ;
      vec3 normal = mat3(cameraWorld) * decodeNormal(d.rg);
      float coverage = roadReflectionWeight(world, normal, normalize(eye - world));
      // Confirm the full-resolution receiver at thin geometry and edges.
      reflected = sampleRoad * min(1., coverage / sampleRoad.a);
      src = src * (1. - reflected.a) + reflected.rgb;
    }
  }
`;
