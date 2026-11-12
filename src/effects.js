import * as THREE from 'three';

const BUDGET = 420;
const COLORS = {
  plaster: 0xcfc2a5, concrete: 0xb5ab94, asphalt: 0xa29b88, brick: 0xc97753,
  metal: 0xffaa55, wood: 0xb98b5a, fabric: 0xcbb495, sandbag: 0xb7a484,
  dirt: 0xb39766, glass: 0xc2e2e7, tile: 0xd1c8b0,
};
const UP = new THREE.Vector3(0, 1, 0);
const FRONT = new THREE.Vector3(0, 0, 1);
const HIDDEN = new THREE.Vector3(0, -100, 0);

const vert = /* glsl */ `
attribute vec4 tint;
attribute vec2 properties;
uniform float pointScale;
varying vec4 vTint;
varying float kind;
void main() {
  vec4 view = modelViewMatrix * vec4(position,1.);
  gl_Position = projectionMatrix * view;
  gl_PointSize = clamp(properties.x * pointScale / max(.12,-view.z),1.,190.);
  vTint=tint;
  kind=properties.y;
}`;

const frag = /* glsl */ `
varying vec4 vTint;
varying float kind;
uniform sampler2D depthNormal;
uniform vec2 depthTexel;
uniform float lowPrecision;
void main() {
  vec2 p = gl_PointCoord*2.-1.;
  float radius=length(p);
  float angle=atan(p.y,p.x);
  float edge=radius+(.086*sin(angle*5.+kind)+.059*sin(angle*9.+kind*2.))*smoothstep(.1,1.,radius);
  float soft=exp(-radius*radius*3.)*(1.-smoothstep(.55,1.,edge));
  float hard=1.-smoothstep(.57,.84,radius);
  float alpha=mix(soft,hard,step(1.5,kind))*vTint.a;
  vec4 geometry=texture2D(depthNormal,gl_FragCoord.xy*depthTexel);
  float floorDepth=lowPrecision>.5?exp2(clamp(geometry.b,0.,1.)*8.)-1.:geometry.b;
  float distance=1./gl_FragCoord.w;
  if(geometry.a>.5) alpha*=smoothstep(0.,mix(.38,.08,step(1.5,kind)),floorDepth-distance);
  if(alpha<.008) discard;
  gl_FragColor=vec4(vTint.rgb*(1.+.16*(1.-radius)),alpha);
}`;

export function randomFor(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

export class Effects {
  constructor(scene, physics, seed) {
    this.physics = physics;
    this.random = randomFor(seed);
    this.dot = new THREE.Object3D();
    this.vector = new THREE.Vector3();
    this.normal = new THREE.Vector3();
    this.color = new THREE.Color();
    this.data = Array.from({ length: BUDGET }, () => ({
      p: new THREE.Vector3(), v: new THREE.Vector3(), color: new THREE.Color(), age: 0, life: 0,
    }));
    this.cursor = 0;
    this.xyz = new Float32Array(BUDGET * 3);
    this.rgba = new Float32Array(BUDGET * 4);
    this.properties = new Float32Array(BUDGET * 2);
    this.geometry = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(this.xyz, 3).setUsage(THREE.DynamicDrawUsage);
    this.colorAttr = new THREE.BufferAttribute(this.rgba, 4).setUsage(THREE.DynamicDrawUsage);
    this.pointAttr = new THREE.BufferAttribute(this.properties, 2).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.positionAttr);
    this.geometry.setAttribute('tint', this.colorAttr);
    this.geometry.setAttribute('properties', this.pointAttr);
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, uniforms: {
        pointScale: { value: 700 }, depthNormal: { value: null },
        depthTexel: { value: new THREE.Vector2() }, lowPrecision: { value: 0 },
      },
      transparent: true, depthWrite: false, toneMapped: false,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.layers.set(3);
    this.points.renderOrder = 8;
    scene.add(this.points);

    const casingGeometry = new THREE.CylinderGeometry(.016, .016, .048, 7);
    const casingMaterial = new THREE.MeshStandardMaterial({ color: 0xab7935, roughness: .32, metalness: .54 });
    this.casings = new THREE.InstancedMesh(casingGeometry, casingMaterial, 45);
    this.casings.frustumCulled = false;
    this.casings.count = 0;
    this.shells = Array.from({ length: 45 }, () => this.body());
    this.shellCursor = 0;
    scene.add(this.casings);

    const grenadeGeometry = new THREE.IcosahedronGeometry(.11, 1);
    this.grenades = Array.from({ length: 6 }, () => {
      const body = this.body();
      body.mesh = new THREE.Mesh(grenadeGeometry, new THREE.MeshStandardMaterial({ color: 0x4d5146, roughness: .75 }));
      body.mesh.visible = false;
      scene.add(body.mesh);
      return body;
    });
    this.grenadeCursor = 0;
    this.smokes = Array.from({ length: 5 }, () => ({ p: new THREE.Vector3(), life: 0, emit: 0 }));
    this.smokeCursor = 0;
    this.tracers = this.linePool(scene);
    this.lineCursor = 0;

    const markGeo = new THREE.PlaneGeometry(1, 1);
    const markCanvas = document.createElement('canvas');
    markCanvas.width = markCanvas.height = 128;
    const ctx = markCanvas.getContext('2d');
    const gradient = ctx.createRadialGradient(64, 64, 2, 64, 64, 60);
    gradient.addColorStop(0, '#0f0c09');
    gradient.addColorStop(.16, '#1f1812');
    gradient.addColorStop(.32, '#473728d8');
    gradient.addColorStop(.52, '#7d685266');
    gradient.addColorStop(.82, '#69584824');
    gradient.addColorStop(1, '#69584800');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    // Spalling plaster rim & radial fracture cracks (Saltline-style decal synthesis)
    const dRand = randomFor(seed ^ 0x41c64e6d);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + (dRand() - .5) * .28;
      let rx = 64 + Math.cos(a) * 9;
      let ry = 64 + Math.sin(a) * 9;
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      const segs = 3 + Math.floor(dRand() * 3);
      for (let s = 0; s < segs; s++) {
        const dist = 8 + dRand() * 9;
        const jitter = a + (dRand() - .5) * .55;
        rx += Math.cos(jitter) * dist;
        ry += Math.sin(jitter) * dist;
        ctx.lineTo(rx, ry);
      }
      ctx.strokeStyle = i % 3 === 0 ? 'rgba(225,205,175,0.34)' : 'rgba(26,20,14,0.62)';
      ctx.lineWidth = .9 + dRand() * 1.1;
      ctx.stroke();
    }
    const map = new THREE.CanvasTexture(markCanvas);
    map.colorSpace = THREE.SRGBColorSpace;
    this.markMaterial = new THREE.MeshBasicMaterial({
      map, transparent: true, opacity: .83, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
    });
    this.marks = Array.from({ length: 104 }, () => {
      const mesh = new THREE.Mesh(markGeo, this.markMaterial);
      mesh.visible = false;
      scene.add(mesh);
      return mesh;
    });
    this.markCursor = 0;

    this.flashes = Array.from({ length: 3 }, () => {
      const light = new THREE.PointLight(0xffaa66, 0, 6, 2);
      scene.add(light);
      return { light, timer: 0 };
    });
    this.flashCursor = 0;
    this.dust = 0;
    this.active = 0;
    this.bodies = 0;
    this.detail = 1;
  }

  body() {
    return { p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, spin: 0, angle: 0, hits: 0 };
  }

  linePool(scene) {
    return Array.from({ length: 18 }, () => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const material = new THREE.LineBasicMaterial({
        color: new THREE.Color().setRGB(3.2, 1.65, .48), transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Line(geometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      return { mesh, life: 0 };
    });
  }

  emit(p, v, color, life, size, kind, alpha) {
    const q = this.data[this.cursor++ % BUDGET];
    q.p.copy(p);
    q.v.copy(v);
    q.color.set(color);
    q.life = life;
    q.age = 0;
    q.size = size;
    q.kind = kind;
    q.alpha = alpha;
  }

  flash(position, direction, player) {
    const flash = this.flashes[this.flashCursor++ % this.flashes.length];
    flash.light.position.copy(position);
    flash.timer = .046;
    flash.light.intensity = player ? 12 : 7;
    for (let i = 0; i < 3; i++) {
      this.vector.copy(direction).multiplyScalar(1.2 + this.random() * .7);
      this.vector.y += .24 + this.random() * .18;
      this.emit(position, this.vector, 0x9e9b92, .48 + this.random() * .33, .09, 0, .26);
    }
    if (!player) {
      this.vector.set(0, .1, 0);
      this.color.setRGB(4.5, 2.7, .9);
      this.emit(position, this.vector, this.color, .041, .21, 2, .97);
    }
  }

  tracer(from, to) {
    const t = this.tracers[this.lineCursor++ % this.tracers.length];
    const attr = t.mesh.geometry.attributes.position;
    attr.setXYZ(0, from.x, from.y, from.z);
    attr.setXYZ(1, to.x, to.y, to.z);
    attr.needsUpdate = true;
    t.life = .062;
    t.mesh.material.opacity = .74;
    t.mesh.visible = true;
  }

  impact(position, normal, surface, decal = true) {
    const color = COLORS[surface] || COLORS.concrete;
    const metal = surface === 'metal';
    for (let i = 0, count = Math.ceil((metal ? 12 : 9) * this.detail); i < count; i++) {
      this.vector.set(this.random() - .5, this.random() - .35, this.random() - .5)
        .addScaledVector(normal, .62).multiplyScalar(metal ? 13 : i < 4 ? 4.5 : 1.2);
      this.color.set(color).multiplyScalar(metal ? 3.2 : 1);
      this.emit(position, this.vector, this.color, .16 + this.random() * (metal ? .22 : .52),
        metal ? .018 : i < 4 ? .034 : .15, metal || i < 4 ? 2 : 0, metal ? .95 : i < 4 ? .85 : .46);
    }
    if (!decal) return;
    const mark = this.marks[this.markCursor++ % this.marks.length];
    mark.position.copy(position).addScaledVector(normal, .009);
    mark.quaternion.setFromUnitVectors(FRONT, normal);
    mark.rotateZ(this.random() * 6.283);
    mark.scale.setScalar((metal ? .073 : .13) * (.75 + this.random() * .65));
    mark.userData.baseScale = mark.scale.x;
    mark.userData.life = 1;
    mark.visible = true;
  }

  casing(position, direction) {
    const b = this.shells[this.shellCursor++ % this.shells.length];
    b.p.copy(position);
    b.v.copy(direction);
    b.v.y += .5 + this.random() * .72;
    b.life = 2.1;
    b.spin = 9 + this.random() * 11;
    b.hits = 0;
  }

  throw(position, direction, type) {
    const b = this.grenades[this.grenadeCursor++ % this.grenades.length];
    b.p.copy(position);
    b.v.copy(direction).multiplyScalar(13.5);
    b.v.y += 4.2;
    b.life = type === 'frag' ? 1.78 : 1.42;
    b.type = type;
    b.hits = 0;
    b.spin = 7 + this.random() * 7;
    b.mesh.material.color.setHex(type === 'frag' ? 0x77724c : 0x52635a);
    b.mesh.position.copy(position);
    b.mesh.visible = true;
  }

  moveBody(b, dt, radius, bounce) {
    if (b.v.lengthSq() < .006 && b.hits > 0) return;
    b.v.y -= 9.81 * dt;
    this.vector.copy(b.v).multiplyScalar(dt);
    const hit = this.physics.sphereCast(b.p, this.vector, radius);
    if (!hit) {
      b.p.add(this.vector);
      b.angle += b.spin * dt;
      return;
    }
    const velocity = b.v.dot(hit.normal);
    b.p.copy(hit.point).addScaledVector(hit.normal, .004);
    if (velocity < 0) b.v.addScaledVector(hit.normal, -velocity * (1 + bounce)).multiplyScalar(.69);
    if (hit.normal.y > .65 && (b.v.lengthSq() < .3 || b.hits > 8)) b.v.set(0, 0, 0);
    b.spin *= .65;
    b.hits++;
  }

  smoke(position) {
    const s = this.smokes[this.smokeCursor++ % this.smokes.length];
    s.p.copy(position);
    s.life = 9;
    s.emit = 0;
  }

  smokeBlocks(a, b) {
    this.vector.subVectors(b, a);
    const length = this.vector.lengthSq();
    if (length < 1e-5) return false;
    for (const s of this.smokes) {
      if (s.life < .9 || s.life > 8.5) continue;
      const t = THREE.MathUtils.clamp(this.normal.subVectors(s.p, a).dot(this.vector) / length, 0, 1);
      this.normal.copy(a).addScaledVector(this.vector, t);
      if (this.normal.distanceToSquared(s.p) < 7.3) return true;
    }
    return false;
  }

  explosion(p) {
    for (let i = 0, count = Math.ceil(30 * this.detail); i < count; i++) {
      this.vector.set(this.random() - .5, this.random() * .62, this.random() - .5).multiplyScalar(i < 12 ? 14 : 5);
      this.emit(p, this.vector, i < 12 ? 0xffb169 : 0x8d7862, i < 12 ? .33 : 1.45, i < 12 ? .06 : .55, i < 12 ? 2 : 0, .86);
    }
    const flash = this.flashes[this.flashCursor++ % this.flashes.length];
    flash.light.position.copy(p).addScaledVector(UP, .25);
    flash.light.intensity = 55;
    flash.timer = .12;
  }

  step(dt, player, onBlast) {
    for (const b of this.shells) {
      if (b.life <= 0) continue;
      b.life -= dt;
      this.moveBody(b, dt, .018, .51);
    }
    for (const b of this.grenades) {
      if (b.life <= 0) continue;
      b.life -= dt;
      if (b.life <= 0) {
        b.mesh.visible = false;
        if (b.type === 'frag') this.explosion(b.p);
        else this.smoke(b.p);
        onBlast(b.p, b.type);
        continue;
      }
      this.moveBody(b, dt, .106, .38);
    }
    for (const s of this.smokes) {
      if (s.life <= 0) continue;
      s.life -= dt;
      s.emit -= dt;
      if (s.emit > 0) continue;
      s.emit += .12;
      for (let i = 0, count = Math.ceil(5 * this.detail); i < count; i++) {
        this.normal.copy(s.p).addScaledVector(UP, .2 + this.random() * .5);
        this.normal.x += (this.random() - .5) * 2.5;
        this.normal.z += (this.random() - .5) * 2.5;
        this.vector.set(this.random() - .42, .13 + this.random() * .37, this.random() - .47);
        this.emit(this.normal, this.vector, 0xb8b7a9, 2.3 + this.random() * 1.45, .92 + this.random() * .48, 0, Math.min(.75, .19 + s.life * .07));
      }
    }
    this.dust -= dt;
    if (this.dust <= 0) {
      this.dust = .054 / this.detail;
      this.normal.copy(player.position);
      this.normal.x += (this.random() - .5) * 31;
      this.normal.y += .2 + this.random() * 3.4;
      this.normal.z += (this.random() - .5) * 33;
      this.vector.set(.29 + this.random() * .25, this.random() * .13, -.16);
      this.emit(this.normal, this.vector, 0xdbd2b4, 4.5 + this.random() * 3, .024 + this.random() * .02, 1, .49);
    }
    for (const q of this.data) {
      if (q.age >= q.life) continue;
      q.age += dt;
      if (q.kind === 2) q.v.y -= dt * 8;
      else q.v.x += dt * .09;
      q.p.addScaledVector(q.v, dt);
    }
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.mesh.visible = t.life > 0;
      t.mesh.material.opacity = Math.min(.75, Math.max(0, t.life * 14));
    }
    for (const f of this.flashes) {
      if (f.timer <= 0) continue;
      f.timer -= dt;
      f.light.intensity = f.timer > 0 ? f.light.intensity * Math.pow(.46, dt * 60) : 0;
    }
    for (const mark of this.marks) {
      if (!mark.visible) continue;
      mark.userData.life -= dt / 43;
      const fade = THREE.MathUtils.clamp((37 - mark.position.distanceTo(player.position)) / 8, 0, 1)
        * THREE.MathUtils.clamp(mark.userData.life * 7, 0, 1);
      mark.scale.setScalar(Math.max(.0001, mark.userData.baseScale * fade));
      if (mark.userData.life < 0) mark.visible = false;
    }
  }

  render(height, fov) {
    this.material.uniforms.pointScale.value = height / (2 * Math.tan(fov * Math.PI / 360));
    let n = 0;
    for (const q of this.data) {
      if (q.age >= q.life) continue;
      const k = q.age / q.life;
      const xyz = n * 3;
      this.xyz[xyz] = q.p.x;
      this.xyz[xyz + 1] = q.p.y;
      this.xyz[xyz + 2] = q.p.z;
      const alpha = q.alpha * Math.min(1, .22 + k * 9) * (1 - k) ** (q.kind === 2 ? 1.3 : .8);
      const rgba = n * 4;
      this.rgba[rgba] = q.color.r;
      this.rgba[rgba + 1] = q.color.g;
      this.rgba[rgba + 2] = q.color.b;
      this.rgba[rgba + 3] = alpha;
      this.properties[n * 2] = q.size * (q.kind === 0 ? 1 + k * 2.9 : 1);
      this.properties[n * 2 + 1] = q.kind;
      n++;
    }
    this.active = n;
    this.geometry.setDrawRange(0, n);
    this.positionAttr.needsUpdate = this.colorAttr.needsUpdate = this.pointAttr.needsUpdate = true;
    n = 0;
    for (const b of this.shells) {
      if (b.life <= 0) continue;
      this.dot.position.copy(b.p);
      this.dot.rotation.set(b.angle, .4 + b.angle * .7, b.angle * 1.4);
      this.dot.updateMatrix();
      this.casings.setMatrixAt(n++, this.dot.matrix);
    }
    this.casings.count = n;
    this.casings.instanceMatrix.needsUpdate = true;
    for (const b of this.grenades) {
      if (b.life <= 0) continue;
      b.mesh.position.copy(b.p);
      b.mesh.rotation.set(b.angle, b.angle * .72, 0);
      n++;
    }
    this.bodies = n;
  }

  reset() {
    for (const q of this.data) q.life = 0;
    for (const b of this.shells) b.life = 0;
    for (const b of this.grenades) { b.life = 0; b.mesh.visible = false; b.mesh.position.copy(HIDDEN); }
    for (const s of this.smokes) s.life = 0;
    for (const t of this.tracers) { t.life = 0; t.mesh.visible = false; }
    for (const f of this.flashes) { f.timer = 0; f.light.intensity = 0; }
    for (const mark of this.marks) mark.visible = false;
  }
}
