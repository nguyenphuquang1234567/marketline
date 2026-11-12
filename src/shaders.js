import { blendRoadReflection, roadReflectionUniforms } from './road-reflection.js';

export const screenVertex = /* glsl */ `
out vec2 uvScreen;
void main() {
  uvScreen = position.xy * .5 + .5;
  gl_Position = vec4(position.xy, 0., 1.);
}`;

export const sky = /* glsl */ `
uniform mat4 inverseVP;
uniform vec3 eye;
uniform vec3 sun;
uniform sampler2D skyPhoto;
out vec4 pixel;

void main() {
  vec4 farPoint = inverseVP * vec4(uvScreen * 2. - 1., 1., 1.);
  vec3 direction = normalize(farPoint.xyz / farPoint.w - eye);
  vec2 panoramaUV = vec2(
    atan(direction.z, direction.x) / 6.2831853 + .5,
    asin(clamp(direction.y, -1., 1.)) / 3.14159265 + .5
  );
  vec3 skyRadiance = texture(skyPhoto, panoramaUV).rgb * 2.38;
  float sunFacing = dot(direction, sun);
  float solarDisc = smoothstep(.999980, .999991, sunFacing);
  skyRadiance += solarDisc * vec3(6.5, 5.1, 3.65);
  pixel = vec4(skyRadiance, 1.);
}`;

export const geometryBuffers = /* glsl */ `
uniform sampler2D sceneDepth;
uniform mat4 inverseVP;
uniform mat4 previousVP;
uniform mat4 view;
uniform vec2 texel;
uniform float lowPrecision;
layout(location=0) out vec4 depthNormal;
layout(location=1) out vec4 velocity;
vec3 worldAt(vec2 at, float d) {
  vec4 p = inverseVP * vec4(at*2.-1.,d*2.-1.,1.);
  return p.xyz / p.w;
}
vec3 viewAt(vec2 at,float d) { return (view*vec4(worldAt(at,d),1.)).xyz; }
vec2 octEncode(vec3 n) {
  n /= max(.0001,abs(n.x)+abs(n.y)+abs(n.z));
  vec2 xy = n.xy;
  if(n.z<0.) xy = (1.-abs(xy.yx))*sign(xy+vec2(1.e-8));
  return xy*.5+.5;
}
void main() {
  vec2 uv = uvScreen;
  float d = texture(sceneDepth,uv).r;
  vec3 wp = worldAt(uv,d);
  vec3 p = (view * vec4(wp,1.)).xyz;
  vec4 prev = previousVP * vec4(wp,1.);
  vec2 previous = prev.xy / max(.0001,prev.w) * .5 + .5;
  vec3 n = vec3(0,0,1);
  if(d < .999999) {
    vec2 dx = vec2(texel.x,0),dy=vec2(0,texel.y);
    float a=texture(sceneDepth,uv+dx).r,b=texture(sceneDepth,uv-dx).r;
    float c=texture(sceneDepth,uv+dy).r,e=texture(sceneDepth,uv-dy).r;
    vec3 x=abs(a-d)<abs(b-d)?viewAt(uv+dx,a)-p:p-viewAt(uv-dx,b);
    vec3 y=abs(c-d)<abs(e-d)?viewAt(uv+dy,c)-p:p-viewAt(uv-dy,e);
    n=normalize(cross(x,y)+vec3(0.,0.,1.e-9));
  }
  float linearZ = max(.02,-p.z);
  float storedZ = mix(linearZ,log2(1.+linearZ)/8.,lowPrecision);
  depthNormal = vec4(octEncode(n),storedZ, d < .999999 ? 1. : 0.);
  velocity = vec4(clamp(.5 + (uv-previous)*.5,0.,1.),
    clamp(log2(1.+max(0.,prev.w))/8.,0.,1.),float(prev.w>0.));
}`;

const decodeOctahedralNormal = /* glsl */ `
vec3 decodeNormal(vec2 encoded) {
  vec2 f = encoded * 2. - 1.;
  vec3 n = vec3(f, 1. - abs(f.x) - abs(f.y));
  n.xy += vec2(n.x >= 0. ? -1. : 1., n.y >= 0. ? -1. : 1.) * max(-n.z, 0.);
  return normalize(n);
}
`;

export const ao = /* glsl */ `
uniform sampler2D depthNormal;
uniform sampler2D velocity;
uniform sampler2D previousAO;
uniform mat4 inverseProjection;
uniform vec2 texel;
uniform float valid;
uniform float frame;
uniform float lowPrecision;
uniform int taps;
out vec4 pixel;
float depth(vec4 v) { return lowPrecision>.5 ? exp2(clamp(v.b,0.,1.)*8.)-1. : v.b; }
${decodeOctahedralNormal}
vec3 reconstruct(vec2 uv,float z) {
  vec4 r=inverseProjection*vec4(uv*2.-1.,1.,1.);
  return r.xyz*z/max(-r.z,.001);
}
void main() {
  vec4 center=texture(depthNormal,uvScreen);
  float z=depth(center);
  float logDepth = log2(1. + z) / 8.;
  if (center.a < .5 || z > 90.) {
    pixel = vec4(1., logDepth, center.rg);
    return;
  }
  vec3 p = reconstruct(uvScreen, z), n = decodeNormal(center.rg);
  float noise = fract(dot(floor(gl_FragCoord.xy), vec2(.754877666, .569840296)));
  float rotation = noise * 6.283185 + frame * 2.399963;
  float contribution = 0.;
  // 0.82 m sampling radius projected using the actual camera FOV.
  float radius = min(.12, .41 / (z * inverseProjection[1][1]));
  float aspect = texel.x / texel.y;
  for (int i = 0; i < 6; i++) {
    if (i >= taps) break;
    float a = rotation + float(i) * 6.283185 / float(taps);
    vec2 dir = vec2(cos(a) * aspect, sin(a));
    float horizon = 0.;
    for (int k = 1; k <= 3; k++) {
      // Concentrate one sample at the contact edge and use two broader probes.
      float spread = k == 1 ? .22 : k == 2 ? .53 : 1.;
      vec2 sampleUV = uvScreen + dir * radius * spread;
      vec4 dd = texture(depthNormal, sampleUV);
      vec3 delta = reconstruct(sampleUV, depth(dd)) - p;
      float dist = length(delta);
      float elevation = max(dot(n, delta / max(dist, .001)) - .08, 0.);
      float proximity = .47 * (1. - smoothstep(.04, .34, dist))
                      + .78 * (1. - smoothstep(.15, 1.05, dist));
      horizon = max(horizon, dd.a * elevation * proximity);
    }
    contribution += horizon;
  }
  float coverage = smoothstep(1.2, 3.5, radius / texel.y);
  float value = 1. - min(.68, contribution / float(taps) * 1.32) * coverage;
  vec4 motion = texture(velocity, uvScreen);
  vec2 prevUV = uvScreen - (motion.rg - .5) * 2.;
  vec4 old = texture(previousAO, prevUV);
  float stable = valid * motion.a * step(length(clamp(prevUV, 0., 1.) - prevUV), .001)
    * step(abs(old.g - motion.b), .014);
  value = mix(value, clamp(old.r, value - .115, value + .115), stable * .62);
  pixel = vec4(value, logDepth, center.rg);
}`;

export const temporal = /* glsl */ `
uniform sampler2D currentColor;
uniform sampler2D history;
uniform sampler2D depthNormal;
uniform sampler2D velocity;
uniform sampler2D ao;
uniform highp sampler2DArray mlAtlas;
uniform mat4 mlMatrix0;
uniform mat4 mlMatrix1;
uniform mat4 inverseVP;
uniform mat4 cameraWorld;
uniform vec3 eye;
uniform vec3 sun;
uniform float frame;
uniform vec2 texel;
uniform vec2 aoTexel;
uniform float valid;
uniform float applyAO;
uniform float lowPrecision;
out vec4 pixel;
#include <packing>
${decodeOctahedralNormal}
${roadReflectionUniforms}
vec3 yCoCg(vec3 c){return vec3(dot(c,vec3(.25,.5,.25)),.5*(c.r-c.b),.5*c.g-.25*(c.r+c.b));}
vec3 rgb(vec3 c){return vec3(c.x+c.y-c.z,c.x+c.z,c.x-c.y-c.z);}
float depth(vec4 v) { return lowPrecision>.5 ? exp2(clamp(v.b,0.,1.)*8.)-1. : v.b; }
float shadowTap(vec3 world) {
  vec4 p0 = mlMatrix0 * vec4(world, 1.);
  vec3 u0 = p0.xyz * .5 + .5;
  if (all(greaterThan(u0, vec3(.002))) && all(lessThan(u0, vec3(.998)))) {
    float z0 = unpackRGBAToDepth(texture(mlAtlas, vec3(u0.xy, 0.)));
    return step(u0.z - .0006, z0);
  }
  vec4 p1 = mlMatrix1 * vec4(world, 1.);
  vec3 u1 = p1.xyz * .5 + .5;
  if (all(greaterThan(u1, vec3(.002))) && all(lessThan(u1, vec3(.998)))) {
    float z1 = unpackRGBAToDepth(texture(mlAtlas, vec3(u1.xy, 1.)));
    return step(u1.z - .0009, z1);
  }
  return 1.;
}
void main() {
  vec4 d=texture(depthNormal,uvScreen);
  float linZ=depth(d);
  float z=log2(1.+linZ)/8.;
  vec3 src=texture(currentColor,uvScreen).rgb;
  float contact = 1.;
  if (applyAO > .5) {
    vec4 farP = inverseVP * vec4(uvScreen * 2. - 1., 1., 1.);
    vec3 rayPerViewDepth = farP.xyz - eye * farP.w;
    vec3 rayDir = normalize(rayPerViewDepth);
    if (d.a > .5) {
      vec2 grid = uvScreen / aoTexel - .5;
      vec2 base = (floor(grid) + .5) * aoTexel;
      vec2 f = fract(grid);
      float visibility = 0., weights = 0.;
      for (int i = 0; i < 4; i++) {
        vec2 off = vec2(float(i & 1), float(i >> 1));
        vec4 sampleAO = texture(ao, base + off * aoTexel);
        float spatial = mix(1. - f.x, f.x, off.x) * mix(1. - f.y, f.y, off.y);
        float weight = spatial * exp2(-abs(sampleAO.g - z) * 275. - length(sampleAO.ba - d.rg) * 12.);
        visibility += sampleAO.r * weight;
        weights += weight;
      }
      float ambientVisibility = (visibility + .025) / (weights + .025);
      if (ambientVisibility < .998) {
        vec3 worldNormal = normalize(mat3(cameraWorld) * decodeNormal(d.rg));
        float facing = max(0., dot(worldNormal, sun));
        vec3 point = eye + rayPerViewDepth * linZ;
        float sunlit = facing * shadowTap(point + worldNormal * .038);
        // Estimate the fraction of lighting supplied by sky and ground bounce.
        // Keep sunlit paint and paving from acquiring dark contact halos.
        float ambientShare = .58 / (.58 + 2.25 * sunlit);
        float luminance = dot(src, vec3(.2126, .7152, .0722));
        float emissionProtection = 1. - .66 * smoothstep(.95, 1.85, luminance);
        contact = mix(1., ambientVisibility, ambientShare * emissionProtection);
        src *= contact;
      }
    }
    float marchDist = min(d.a > .5 ? linZ * length(rayPerViewDepth) : 42., 38.);
    float sunAlign = max(0., dot(rayDir, sun));
    float phase = .22 + .78 * pow(sunAlign, 4.5);
    float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy + vec2(frame * 5.17, frame * 3.83), vec2(.06711056, .00583715))));
    float shaft = 0.;
    for(int s=0; s<6; s++) {
      float t = ((float(s) + ign) / 6.) * marchDist;
      vec3 wp = eye + rayDir * t;
      float heightAtten = exp(-max(0., wp.y) * .11);
      shaft += shadowTap(wp) * heightAtten;
    }
    shaft = (shaft / 6.) * smoothstep(2.5, 28., marchDist) * phase;
    src += vec3(1.18, .96, .73) * shaft * .061;
  }
  ${blendRoadReflection}
  vec3 cur=yCoCg(src), lo=cur, hi=cur;
  for(int i=0;i<4;i++) {
    vec2 off=i==0?vec2(1,0):i==1?vec2(-1,0):i==2?vec2(0,1):vec2(0,-1);
    vec3 sampleColor=yCoCg(texture(currentColor,uvScreen+off*texel).rgb * contact * (1. - reflected.a) + reflected.rgb);
    lo=min(lo,sampleColor);hi=max(hi,sampleColor);
  }
  vec4 motion=texture(velocity,uvScreen);
  vec2 delta=(motion.rg-.5)*2.;
  vec2 prev=uvScreen-delta;
  vec4 old=texture(history,prev);
  vec3 oldColor=yCoCg(old.rgb);
  float reactive=max(smoothstep(.07,.33,abs(cur.x-oldColor.x)/(cur.x+.19)),smoothstep(1.6,3.,cur.x));
  float disoccluded=max(smoothstep(.006,.022,abs(old.a-motion.b)), step(.001,length(clamp(prev,0.,1.)-prev)));
  float weight=valid*motion.a*(1.-reactive)*(1.-disoccluded)*mix(.81,.41,smoothstep(.001,.038,length(delta)));
  vec3 clipped=clamp(oldColor,lo-vec3(.007),hi+vec3(.007));
  pixel=vec4(max(vec3(0),rgb(mix(cur,clipped,weight))),z);
}`;

export const bloom = /* glsl */ `
uniform sampler2D image;
uniform sampler2D hands;
uniform vec2 texel;
uniform float first;
out vec4 pixel;
vec3 value(vec2 p) {
  vec3 c=texture(image,p).rgb;
  if(first>.5) {
    vec4 w=texture(hands,p);
    c=w.rgb+c*(1.-w.a);
    float l=max(max(c.r,c.g),c.b);
    c*=smoothstep(1.3,2.5,l);
  }
  return c;
}
void main() {
  vec3 a=value(uvScreen+texel*vec2(-.7,-.7)), b=value(uvScreen+texel*vec2(.7,-.7));
  vec3 c=value(uvScreen+texel*vec2(-.7,.7)), d=value(uvScreen+texel*vec2(.7,.7));
  vec4 w=1./(1.+vec4(dot(a,vec3(.22,.70,.08)),dot(b,vec3(.22,.70,.08)),dot(c,vec3(.22,.70,.08)),dot(d,vec3(.22,.70,.08))));
  pixel=vec4((a*w.x+b*w.y+c*w.z+d*w.w)/dot(w,vec4(1)),1);
}`;

export const exposure = /* glsl */ `
uniform sampler2D image;
uniform sampler2D previousExposure;
uniform float delta;
uniform float valid;
out vec4 pixel;
void main() {
  float sum=0.,weight=0.;
  for(int x=0;x<8;x++) for(int y=0;y<6;y++) {
    vec2 p=(vec2(float(x),float(y))+.5)/vec2(8.,6.);
    vec3 c=texture(image,p).rgb;
    float w=1.4-clamp(length((p-vec2(.5,.46))*vec2(1.35,1.55)),0.,1.);
    sum+=log2(clamp(dot(c,vec3(.2126,.7152,.0722)),.018,2.))*w;
    weight+=w;
  }
  float goal=clamp(log2(.39)-sum/weight,-.58,.65);
  float prev=texture(previousExposure,vec2(.5)).r*2.-1.;
  float speed=goal>prev ? 1.28 : 2.7;
  float ev=mix(goal,mix(prev,goal,1.-exp(-delta*speed)),valid);
  pixel=vec4(ev*.5+.5,0.,0.,1.);
}`;

export const tileVelocity = /* glsl */ `
uniform sampler2D velocity;
uniform vec2 texel;
out vec4 pixel;
void main() {
  vec2 largest=vec2(0.);
  for(int x=-2;x<=2;x++) for(int y=-2;y<=2;y++) {
    vec2 v=texture(velocity,uvScreen+vec2(float(x),float(y))*texel*3.).rg-.5;
    if(dot(v,v)>dot(largest,largest)) largest=v;
  }
  pixel=vec4(largest+.5,0.,1.);
}`;

export const composite = /* glsl */ `
uniform sampler2D image;
uniform sampler2D hands;
uniform sampler2D bloom0;
uniform sampler2D bloom1;
uniform sampler2D bloom2;
uniform sampler2D exposure;
uniform sampler2D depthNormal;
uniform sampler2D velocity;
uniform sampler2D tiles;
uniform sampler2D aoDebug;
uniform sampler2D reflectionDebug;
uniform highp sampler3D grade;
uniform vec2 texel;
uniform vec2 tileTexel;
uniform float damage;
uniform float critical;
uniform float time;
uniform float blur;
uniform float bloomAmount;
uniform float vignette;
uniform float chromatic;
uniform float lowPrecision;
uniform float heat;
uniform vec3 gas;
uniform int debug;
out vec4 pixel;
#include <tonemapping_pars_fragment>
float depth(vec4 v) { return lowPrecision>.5 ? exp2(clamp(v.b,0.,1.)*8.)-1. : v.b; }
vec3 toSrgb(vec3 c){return mix(12.92*c,1.055*pow(max(c,0.),vec3(1./2.4))-.055,step(.0031308,c));}
void main() {
  vec2 uv=uvScreen;
  vec4 dn=texture(depthNormal,uv);
  vec4 motion=texture(velocity,uv);
  if(debug==1){pixel=vec4(dn.rg,.7*dn.a,1.);return;}
  if(debug==2){pixel=vec4(abs(motion.rg-.5)*13.,0.15,1.);return;}
  if(debug==3){float z=depth(dn);pixel=vec4(vec3(exp(-z*.032)),1.);return;}
  if(debug==4){float z=depth(dn);pixel=vec4(z<19.?vec3(.2,.7,.4):z<47.?vec3(.8,.59,.16):z<89.?vec3(.64,.25,.25):vec3(.2,.34,.62),1.);return;}
  if(debug==5){pixel=vec4(vec3(texture(aoDebug,uv).r),1.);return;}
  if(debug==10){pixel=vec4(toSrgb(texture(reflectionDebug,uv).rgb),1.);return;}
  float z=depth(dn);
  uv.x+=sin(uv.y*182.+time*3.+z*.068)*.00049*smoothstep(25.,77.,z)*smoothstep(.27,.5,uv.y)*(1.-smoothstep(.51,.68,uv.y))*dn.a*heat;
  if(gas.z>.005){
    vec2 diff=uv-gas.xy;
    float radial=length(diff*vec2(texel.y/texel.x,1.));
    float refraction=exp(-radial*radial*480.)*gas.z;
    uv+=sin(vec2(diff.y,diff.x)*164.+time*14.)*refraction*.00155;
  }
  vec3 c=texture(image,uv).rgb;
  if(blur<=.01 || length(motion.rg-.5)<=.0014){
    vec3 nN = texture(image, uv + vec2(0., -texel.y)).rgb;
    vec3 nS = texture(image, uv + vec2(0., texel.y)).rgb;
    vec3 nW = texture(image, uv + vec2(-texel.x, 0.)).rgb;
    vec3 nE = texture(image, uv + vec2(texel.x, 0.)).rgb;
    vec3 minC = min(c, min(min(nN, nS), min(nW, nE)));
    vec3 maxC = max(c, max(max(nN, nS), max(nW, nE)));
    vec3 contrast = clamp(min(minC, 2. - maxC) / max(maxC, vec3(.0001)), 0., 1.);
    vec3 wSharp = -sqrt(contrast) * .115;
    c = max(vec3(0.), (c + (nN + nS + nW + nE) * wSharp) / (1. + 4. * wSharp));
  }
  if(blur>.01 && length(motion.rg-.5)>.0014){
    vec2 v=(motion.rg-.5)*2.;
    vec2 maxV=vec2(0);
    for(int j=0;j<5;j++){
      vec2 off=j==0?vec2(0):j==1?vec2(1,0):j==2?vec2(-1,0):j==3?vec2(0,1):vec2(0,-1);
      vec2 t=(texture(tiles,uv+off*tileTexel).rg-.5)*2.;
      if(dot(t,t)>dot(maxV,maxV))maxV=t;
    }
    v=mix(v,maxV,.32);
    v*=min(1.,.036/max(length(v),.0001))*blur;
    float w=1.;
    for(int i=1;i<=4;i++) {
      vec2 p=uv-v*float(i)*.22;
      float k=exp(-abs(depth(texture(depthNormal,p))-z)*2./max(1.,z*.15));
      c+=texture(image,p).rgb*k;
      w+=k;
    }
    c/=w;
  }
  vec2 screen=uvScreen*2.-1.;
  float radial=dot(screen,screen);
  if(chromatic>.5){
    vec2 offset=screen*radial*.00092*(1.+damage);
    c.r=mix(c.r,texture(image,uv+offset).r,.52);
    c.b=mix(c.b,texture(image,uv-offset).b,.52);
  }
  vec4 weapon=texture(hands,uvScreen);
  float ev=texture(exposure,vec2(.5)).r*2.-1.;
  c=c*(1.-weapon.a)*exp2(ev)+weapon.rgb*exp2(ev*.42);
  if(bloomAmount>.0){
    c+=bloomAmount*(texture(bloom0,uvScreen).rgb*.26+texture(bloom1,uvScreen).rgb*.46+texture(bloom2,uvScreen).rgb*.60);
  }
  c=AgXToneMapping(max(c,vec3(0.)));
  c=texture(grade,clamp(c,0.,1.)*(32./33.)+(.5/33.)).rgb;
  float l=dot(c,vec3(.2126,.7152,.0722));
  c=mix(c,vec3(l),critical*.53+damage*.1);
  float edge=smoothstep(.17,1.83,radial);
  c*=1.-edge*(vignette*.12+critical*.29+damage*.075);
  c+=vec3(.23,.018,.011)*pow(edge,1.65)*(damage+critical*.35);
  float grain=fract(52.9829189 * fract(dot(gl_FragCoord.xy+time,vec2(.06711056,.00583715))))-.5;
  pixel=vec4(toSrgb(c)+grain*.007,1.);
}`;

export const motionVertex = /* glsl */ `
#include <skinning_pars_vertex>
uniform mat4 previousVP;
uniform mat4 previousModel;
uniform float deforming;
in vec3 previousPosition;
out vec3 surfaceNormal;
out vec4 previousClip;
#ifdef USE_SKINNING
  uniform highp sampler2D previousSkin;
  uniform bool hasPreviousSkin;
  mat4 oldBone(float index) {
    int bone = int(index);
    return mat4(texelFetch(previousSkin, ivec2(0,bone), 0), texelFetch(previousSkin, ivec2(1,bone), 0),
      texelFetch(previousSkin, ivec2(2,bone), 0), texelFetch(previousSkin, ivec2(3,bone), 0));
  }
#endif
void main(){
  vec3 transformed = position;
  vec3 objectNormal = normal;
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <skinning_vertex>
  gl_Position=projectionMatrix*modelViewMatrix*vec4(transformed,1.);
  vec3 oldPosition=deforming>.5 ? previousPosition : transformed;
  previousClip=previousVP*previousModel*vec4(oldPosition,1.);
  #ifdef USE_SKINNING
    if (hasPreviousSkin) {
      vec4 vertex = bindMatrix * vec4(position,1.);
      vec4 oldWorld = oldBone(skinIndex.x)*vertex*skinWeight.x + oldBone(skinIndex.y)*vertex*skinWeight.y
        + oldBone(skinIndex.z)*vertex*skinWeight.z + oldBone(skinIndex.w)*vertex*skinWeight.w;
      previousClip = previousVP * oldWorld;
    }
  #endif
  surfaceNormal=normalMatrix*objectNormal;
}`;

export const motionFragment = /* glsl */ `
uniform sampler2D sceneDepth;
uniform vec2 texel;
uniform float lowPrecision;
in vec3 surfaceNormal;
in vec4 previousClip;
layout(location=0) out vec4 depthNormal;
layout(location=1) out vec4 velocity;
vec2 octEncode(vec3 n){
  n/=max(.0001,abs(n.x)+abs(n.y)+abs(n.z));
  if(n.z<0.)n.xy=(1.-abs(n.yx))*sign(n.xy+vec2(1.e-8));
  return n.xy*.5+.5;
}
void main(){
  vec2 uv=gl_FragCoord.xy*texel;
  if(abs(texture(sceneDepth,uv).r-gl_FragCoord.z)>.000025)discard;
  vec2 old=previousClip.xy/max(previousClip.w,.0001)*.5+.5;
  float z=1./gl_FragCoord.w;
  depthNormal=vec4(octEncode(normalize(surfaceNormal)),mix(z,log2(1.+z)/8.,lowPrecision),1.);
  velocity=vec4(clamp(.5+(uv-old)*.5,0.,1.),clamp(log2(1.+max(0.,previousClip.w))/8.,0.,1.),previousClip.w>0.? .69:0.);
}`;
