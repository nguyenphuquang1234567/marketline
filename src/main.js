import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import soldierURL from './assets/soldier-rig.glb?url&inline';
import { soldierVariants } from './soldier-model.js';
import { buildWorld } from './world.js';
import { StaticBVH, CharacterController } from './physics.js';
import { RigidWorld } from './rigid-world.js';
import { makeLooseProps } from './props.js';
import { BotSystem } from './bots.js';
import { BotRig } from './bot-rig.js';
import { WeaponView } from './weapon.js';
import { SynthAudio } from './audio.js';
import { Interface, loadSettings } from './ui.js';
import { Effects, randomFor } from './effects.js';
import { RenderGraph } from './render.js';
import { loadMarketSky, MARKET_SUN } from './market-sky.js';
import { loadMarketProps } from './market-props.js';
import { waitForWorldMaterials } from './world-materials.js';
import { DebugView, DEBUG_NAMES } from './debug.js';

const parameters = new URLSearchParams(location.search);
const QA = parameters.has('qa');
const SEED = (Number(parameters.get('seed')) || 2324) >>> 0;
const STEP = 1 / 120;
const ROUND = 600;
const WIN = 30;
const UP = new THREE.Vector3(0, 1, 0);
const DEG = Math.PI / 180;
const clamp = THREE.MathUtils.clamp;
const wrapAngle = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const canvas = document.querySelector('#view');

const penetration = {
  wood: [.34, .48], metal: [.135, .35], plaster: [.23, .51],
  glass: [.19, .63], fabric: [.16, .76],
};

function hitSphere(origin, direction, x, y, z, radius) {
  const ox = x - origin.x, oy = y - origin.y, oz = z - origin.z;
  const along = ox * direction.x + oy * direction.y + oz * direction.z;
  const near = radius * radius - (ox * ox + oy * oy + oz * oz - along * along);
  return near < 0 || along < 0 ? Infinity : Math.max(.0001, along - Math.sqrt(near));
}

class Marketline {
  constructor() {
    this.settings = loadSettings();
    if (QA) this.settings.quality = parameters.get('quality') || this.settings.quality;
    this.audio = new SynthAudio(SEED ^ 0x5812);
    this.ui = new Interface(this.settings, {
      deploy: () => this.deploy(),
      restart: () => this.deploy(true),
      changed: () => this.applySettings(),
      fullscreen: () => this.fullscreen(),
      hover: () => this.audio.cue('hover'),
    });
    this.scene = new THREE.Scene();
    this.weaponScene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, 1, .045, 190);
    this.camera.rotation.order = 'YXZ';
    this.keys = new Set();
    this.pressed = new Set();
    this.elapsed = 0;
    this.scores = [0, 0];
    this.cameraPos = new THREE.Vector3();
    this.previousPos = new THREE.Vector3();
    this.viewAngles = new THREE.Euler(0, 0, 0, 'YXZ');
    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.wish = new THREE.Vector3();
    this.eye = new THREE.Vector3();
    this.aim = new THREE.Vector3();
    this.eject = new THREE.Vector3();
    this.shotMuzzle = new THREE.Vector3();
    this.shotEnd = new THREE.Vector3();
    this.shotStart = new THREE.Vector3();
    this.shotDirection = new THREE.Vector3();
    this.traceStart = new THREE.Vector3();
    this.traceDirection = new THREE.Vector3();
    this.soundRay = new THREE.Vector3();
    this.deathDirection = new THREE.Vector3();
    this.deathBoom = new THREE.Vector3();
    this.propImpulse = new THREE.Vector3();
    this.gasPosition = new THREE.Vector3();
    this.markerWorld = new THREE.Vector3();
    this.markerRay = new THREE.Vector3();
    this.frames = [];
    this.errors = [];
    this.random = randomFor(SEED);
    this.mouseX = this.mouseY = this.trigger = this.adsButton = this.click = 0;
    this.accumulator = this.time = 0;
    this.lastFrame = 0;
    this.phase('loading');
  }

  async boot() {
    await this.paint();
    this.ui.progress('Building Al Marfa');
    await this.paint();
    this.world = buildWorld(this.scene, SEED);
    this.physics = new StaticBVH(this.world.colliders);
    this.rigid = new RigidWorld(this.physics);
    this.props = makeLooseProps(this.scene, this.rigid, this.physics, randomFor(SEED ^ 0xb124));
    this.rigid.reset();
    this.controller = new CharacterController(this.physics, this.world.spawns[0][0]);
    this.player = { id: 'player', name: 'YOU', team: 0, position: this.controller.position };
    this.weapon = new WeaponView(this.weaponScene, SEED);
    const corpse = new THREE.Group();
    const [soldier, skyPhoto] = await Promise.all([
      new GLTFLoader().loadAsync(soldierURL),
      loadMarketSky(),
      loadMarketProps(this.scene, this.world.assetPlacements),
      waitForWorldMaterials(),
    ]);
    this.soldiers = soldierVariants(soldier);
    this.playerRig = new BotRig(corpse, 7, 0, this.soldiers.templates[0]);
    corpse.visible = false;
    this.scene.add(corpse);
    this.effects = new Effects(this.scene, this.physics, SEED ^ 0x2718);
    this.ui.progress('Preparing squads');
    await this.paint();
    this.botSystem = new BotSystem({
      scene: this.scene, physics: this.physics, world: this.world, seed: SEED, soldier: this.soldiers.templates,
      onFire: (bot, start, direction) => this.botFire(bot, start, direction),
      onStep: (bot, surface) => this.botStep(bot, surface),
      isObscured: (a, b) => this.effects.smokeBlocks(a, b),
    });
    this.bots = this.botSystem.bots;
    this.actors = [this.player, ...this.bots];
    this.ui.buildMap(this.world);
    this.reset();
    this.setLandmark('spawn');
    this.ui.progress('Warming renderer');
    await this.paint();
    this.renderer = new RenderGraph(canvas, this.scene, this.camera, this.weaponScene, this.settings, skyPhoto, QA);
    this.renderer.register();
    this.diagnostics = new DebugView(this.scene, this.physics, this.botSystem.nav);
    this.debugMode = 0;
    for (const bot of this.bots) this.renderer.trackMotion(bot.group);
    this.renderer.trackMotion(corpse);
    for (const body of this.props) this.renderer.trackMotion(body.mesh, () => !body.sleeping);
    this.applySettings();
    this.installInput();
    this.draw(0, 0, false);
    this.phase('ready');
    this.frame = this.frame.bind(this);
    this.animation = requestAnimationFrame(this.frame);
    window.addEventListener('pagehide', event => { if (!event.persisted) this.dispose(); });
    if (QA) this.installHarness();
  }

  paint() { return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); }

  phase(value, details) {
    this.state = value;
    this.ui.phase(value, details);
  }

  reset() {
    this.random = randomFor(SEED);
    this.elapsed = 0;
    this.scores.fill(0);
    this.accumulator = 0;
    this.ui.feed.length = 0;
    this.ui.drawFeed();
    this.ui.hitUntil = this.ui.killUntil = this.ui.damageUntil = 0;
    this.botSystem.reset();
    for (const bot of this.bots) {
      bot.spawnShieldUntil = 0;
      bot.revealedUntil = 0;
    }
    this.effects.reset();
    this.rigid.reset();
    for (const body of this.props) body.contactUntil = 0;
    this.spawnPlayer(true);
  }

  spawnPlayer(initial) {
    const feet = initial ? this.world.spawns[0][0] : this.bestSpawn(this.player);
    this.controller.teleport(feet);
    Object.assign(this.player, {
      health: 100, alive: true, height: this.controller.height, ammo: 30, reserve: 120,
      smoke: 1, frag: 1, auto: true, spawnShieldUntil: this.elapsed + 2,
    });
    this.weapon.reset();
    this.playerRig.group.visible = false;
    this.gasTimer = this.damageKick = 0;
    this.yaw = 0;
    this.pitch = .016;
    this.kick = this.kickSide = this.landing = this.hurt = this.shotChain = this.fireAt = 0;
    this.reloadPending = false;
    this.lastDamage = this.elapsed;
    this.footDistance = 0;
    this.deathAge = 0;
    this.shots = 0;
    this.eyeHeight = this.controller.height - .11;
    this.previousEye = this.eyeHeight;
    this.previousPos.copy(this.controller.position);
    this.cameraPos.copy(this.controller.position).addScaledVector(UP, this.eyeHeight);
    this.cameraFov = this.settings.fov;
    this.updateCamera(1);
    this.renderer?.invalidate();
  }

  setLandmark(name) {
    const mark = this.world.landmarks[name];
    this.eye.copy(mark.position).addScaledVector(UP, -1.66);
    this.controller.teleport(this.eye);
    this.previousPos.copy(this.controller.position);
    this.yaw = mark.yaw;
    this.pitch = mark.pitch;
    this.updateCamera(1);
    this.renderer?.invalidate();
  }

  bestSpawn(actor) {
    let best = -Infinity, choice;
    for (const spawn of this.world.spawns[actor.team]) {
      const eye = this.eye.copy(spawn).addScaledVector(UP, 1.4);
      let nearest = 110, occupied = 0, exposed = 0;
      for (const other of this.actors) {
        if (!other.alive || actor === other) continue;
        const d = spawn.distanceTo(other.position);
        if (other.team === actor.team) {
          occupied += Math.max(0, 4.8 - d) * 4;
          continue;
        }
        nearest = Math.min(nearest, d);
        if (d < 41 && !this.physics.segmentCast(eye, this.eject.copy(other.position).addScaledVector(UP, 1.4))) exposed++;
      }
      const rating = Math.min(nearest, 56) - occupied - exposed * 13 - (nearest < 9 ? 40 : 0) + this.random() * 2.7;
      if (rating > best) { best = rating; choice = spawn; }
    }
    return choice;
  }

  applySettings() {
    this.audio.volume(this.settings.volume);
    this.renderer?.configure(this.settings);
    if (this.renderer) this.effects.detail = this.renderer.preset.density;
  }

  fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen()?.catch(() => {});
    else document.documentElement.requestFullscreen?.()?.catch(() => {});
  }

  async requestMouse() {
    if (!canvas.requestPointerLock) { this.fallbackLook = true; return; }
    try {
      await canvas.requestPointerLock({ unadjustedMovement: true });
    } catch {
      try { await canvas.requestPointerLock(); }
      catch { this.fallbackLook = true; }
    }
  }

  deploy(restart = false) {
    if (this.state === 'loading' || this.state === 'error') return;
    if (this.state === 'end' || this.state === 'ready' || restart) this.reset();
    this.audio.unlock().catch(() => {});
    this.audio.pause(false);
    this.audio.cue(this.state === 'pause' && !restart ? 'click' : 'start');
    this.phase(this.player.alive ? 'play' : 'dead');
    this.requestMouse();
    this.lastFrame = 0;
  }

  pause() {
    if (this.state !== 'play' && this.state !== 'dead') return;
    this.phase('pause');
    this.clearInput();
    this.audio.pause(true);
    if (document.pointerLockElement) document.exitPointerLock();
  }

  clearInput() {
    this.keys.clear();
    this.pressed.clear();
    this.mouseX = this.mouseY = this.trigger = this.adsButton = this.click = 0;
  }

  installInput() {
    const live = () => this.state === 'play' || this.state === 'dead';
    document.addEventListener('keydown', event => {
      if (this.ui.tryBind(event.code)) { event.preventDefault(); return; }
      if (event.code === 'Escape' && live()) { this.pause(); return; }
      if (event.code === 'Backquote' && live() && !event.repeat) {
        this.debugMode = (this.debugMode + 1) % DEBUG_NAMES.length;
        this.renderer.debug = this.debugMode < 6 ? this.debugMode : 0;
        this.diagnostics.set(this.debugMode);
        this.ui.el.telemetry.hidden = this.debugMode === 0;
      }
      if (!live()) return;
      if (event.code === 'Tab') { event.preventDefault(); this.ui.el.telemetry.hidden = !this.ui.el.telemetry.hidden; }
      const crouchAlias = event.code === 'KeyC' && this.settings.keys.crouch === 'ControlLeft';
      if (!crouchAlias && !Object.values(this.settings.keys).includes(event.code)) return;
      event.preventDefault();
      if (!event.repeat) this.pressed.add(event.code);
      this.keys.add(event.code);
    });
    document.addEventListener('keyup', event => this.keys.delete(event.code));
    document.addEventListener('mousemove', event => {
      if (!live() || document.pointerLockElement !== canvas && !(this.fallbackLook && (event.buttons & 3))) return;
      this.mouseX += Number.isFinite(event.movementX) ? event.movementX : 0;
      this.mouseY += Number.isFinite(event.movementY) ? event.movementY : 0;
    });
    canvas.addEventListener('mousedown', event => {
      if (!live()) return;
      if (document.pointerLockElement !== canvas && !this.fallbackLook) this.requestMouse();
      if (event.button === 0) { this.trigger = 1; this.click = 1; }
      if (event.button === 2) this.adsButton = 1;
      event.preventDefault();
    });
    document.addEventListener('mouseup', event => {
      if (event.button === 0) this.trigger = 0;
      if (event.button === 2) this.adsButton = 0;
    });
    canvas.addEventListener('contextmenu', event => event.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === canvas) { this.locked = true; this.fallbackLook = false; return; }
      if (this.locked && live()) this.pause();
      this.locked = false;
    });
    document.addEventListener('pointerlockerror', () => {
      if (live() && !document.pointerLockElement) this.fallbackLook = true;
    });
    window.addEventListener('blur', () => { this.clearInput(); if (!QA) this.pause(); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && !QA) this.pause();
      this.lastFrame = 0;
    });
    window.addEventListener('resize', () => { this.needsRender = true; });
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      this.errors.push('WebGL context lost');
      this.lostContext = true;
      this.pause();
      this.phase('error', 'The graphics context was interrupted. Waiting for the browser to restore it.');
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.lostContext = false;
      this.renderer.invalidate();
      this.phase('pause');
      this.needsRender = true;
    });
  }

  action(name) { return this.keys.has(this.settings.keys[name]); }
  edge(name) { return this.pressed.delete(this.settings.keys[name]); }

  look(dt) {
    const x = this.mouseX, y = this.mouseY;
    const sensitivity = this.settings.sensitivity * .00208
      * (1 - this.weapon.ads * (1 - this.settings.ads));
    this.yaw = wrapAngle(this.yaw + x * sensitivity);
    this.pitch = clamp(this.pitch + y * sensitivity * (this.settings.invert ? 1 : -1), -1.44, 1.44);
    this.mouseX = this.mouseY = 0;
    this.swayX = (this.swayX || 0) * Math.exp(-dt * 28) + x;
    this.swayY = (this.swayY || 0) * Math.exp(-dt * 28) + y;
  }

  updateCamera(alpha) {
    const height = THREE.MathUtils.lerp(this.previousEye, this.eyeHeight, alpha);
    const shake = this.settings.shake ? 1 : 0;
    this.cameraPos.lerpVectors(this.previousPos, this.controller.position, alpha);
    const fall = this.player.alive ? 0 : THREE.MathUtils.smootherstep(this.deathAge, 0, .67);
    this.camera.position.copy(this.cameraPos);
    this.camera.position.y += THREE.MathUtils.lerp(height, .37, fall) - this.landing * shake;
    if (fall) {
      const boom = this.deathBoom.set(-Math.sin(this.yaw) * 1.55, .58, Math.cos(this.yaw) * 1.55).multiplyScalar(fall);
      const hit = this.physics.sphereCast(this.camera.position, boom, .16);
      this.camera.position.addScaledVector(boom, hit ? Math.max(0, hit.fraction - .07) : 1);
    }
    this.viewAngles.set(this.pitch + this.kick - fall * .43, -this.yaw - this.kickSide - this.damageKick * shake, fall * -.22, 'YXZ');
    this.camera.quaternion.setFromEuler(this.viewAngles);
    this.camera.updateMatrixWorld();
    this.camera.fov = this.cameraFov;
  }

  playerStep(dt) {
    const p = this.player;
    const c = this.controller;
    this.previousPos.copy(c.position);
    this.previousEye = this.eyeHeight;
    if (!p.alive) {
      this.deathAge += dt;
      this.playerRig.tumble(this.physics, dt);
      this.playerRig.group.visible = this.deathAge > .31;
      if (this.deathAge >= 3.5) { this.spawnPlayer(false); this.phase('play'); }
      return;
    }
    const forward = Number(this.action('forward')) - Number(this.action('back'));
    const strafe = Number(this.action('right')) - Number(this.action('left'));
    const crouch = this.action('crouch') || this.keys.has('KeyC') && this.settings.keys.crouch === 'ControlLeft';
    const sprint = this.action('sprint') && forward > .5 && !crouch && !this.adsButton && !this.reloadPending && !this.trigger;
    const ads = Boolean(this.adsButton) && !sprint;
    this.forward.set(Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, Math.sin(this.yaw));
    this.wish.copy(this.forward).multiplyScalar(forward).addScaledVector(this.right, strafe).clampLength(0, 1);
    const jump = this.edge('jump');
    const wasMantling = c.mantleTime > 0;
    c.step(dt, { wish: this.wish, speed: crouch ? 2.4 : ads ? 3.45 : sprint ? 7.65 : 5.25, crouch, jump, mantle: jump });
    if (c.mantleTime > 0 && !wasMantling) this.audio.mechanical('mantle');
    if (c.landed > 2.5) {
      this.landing = Math.min(.12, c.landed * .014);
      this.audio.footstep(c.surface, undefined, Math.min(1.8, c.landed / 5));
    }
    p.height = c.height;
    const speed = Math.hypot(c.velocity.x, c.velocity.z);
    if (speed > 1.1 && c.grounded) {
      for (const body of this.props) {
        if (this.elapsed < (body.contactUntil || 0) || Math.abs(body.position.y - c.position.y) > .42
          || body.position.distanceToSquared(c.position) > .55 ** 2) continue;
        this.propImpulse.copy(c.velocity).setY(.65).multiplyScalar(.22 / body.invMass);
        this.rigid.impulse(body, this.propImpulse, body.position);
        body.contactUntil = this.elapsed + .27;
      }
    }
    this.footDistance += c.grounded ? speed * dt : 0;
    if (this.footDistance >= (sprint ? 1.83 : 1.52)) {
      this.footDistance = 0;
      this.audio.footstep(c.surface, undefined, crouch ? .34 : sprint ? .94 : .67);
      this.botSystem.hear(p.position, 0, crouch ? 4.2 : sprint ? 13 : 9);
    }
    this.eyeHeight += (c.height - .11 - this.eyeHeight) * (1 - Math.exp(-dt * 22));
    this.eye.copy(c.position).addScaledVector(UP, this.eyeHeight);
    const cp = Math.cos(this.pitch + this.kick);
    const aimYaw = this.yaw + this.kickSide + this.damageKick * Number(this.settings.shake);
    this.aim.set(Math.sin(aimYaw) * cp, Math.sin(this.pitch + this.kick), -Math.cos(aimYaw) * cp);
    const wall = this.physics.raycast(this.eye, this.aim, 1.03);
    const blocked = wall ? clamp(1 - (wall.distance - .28) / .75, 0, 1) : 0;

    if (this.edge('reload')) this.startReload();
    if (this.edge('inspect')) { this.weapon.inspect(); this.audio.mechanical('inspect'); }
    if (this.edge('mode')) { p.auto = !p.auto; this.audio.mechanical('selector'); }
    if (this.edge('tactical')) this.throwItem('smoke');
    if (this.edge('grenade')) this.throwItem('frag');

    this.fireAt = Math.max(0, this.fireAt - dt);
    if (this.fireAt <= 0 && !this.reloadPending && (this.click || this.trigger && p.auto)) {
      if (p.ammo > 0) this.playerFire(speed, ads, crouch);
      else {
        if (this.click) this.audio.mechanical('empty');
        this.startReload();
        this.fireAt = .13;
      }
      this.click = 0;
    } else if (this.reloadPending || this.fireAt > 0 && !p.auto) this.click = 0;

    this.weapon.update(dt, {
      ads, crouch, sprint, speed, strafe, grounded: c.grounded, blocked,
      mouseX: this.swayX || 0, mouseY: this.swayY || 0, active: true, brightness: this.light || 1,
    });
    if (this.reloadPending && this.weapon.reloadProgress >= 1) {
      const moved = Math.min(30 - p.ammo, p.reserve);
      p.ammo += moved;
      p.reserve -= moved;
      this.reloadPending = false;
    }
    for (const sound of this.weapon.events) this.audio.mechanical(sound);
    this.weapon.events.length = 0;
    this.kick *= Math.exp(-dt * 9.5);
    this.kickSide *= Math.exp(-dt * 11);
    this.damageKick *= Math.exp(-dt * 12);
    this.gasTimer = Math.max(0, this.gasTimer - dt);
    this.shotChain *= Math.exp(-dt * (this.trigger ? 1.8 : 5.8));
    this.hurt *= Math.exp(-dt * 4.8);
    this.landing *= Math.exp(-dt * 13);
    this.cameraFov += (this.settings.fov + Number(sprint) * 5 - this.weapon.ads * 20 + this.kick * 9 - this.cameraFov)
      * (1 - Math.exp(-dt * 14));
    if (p.health < 100 && this.elapsed - this.lastDamage > 5.4) p.health = Math.min(100, p.health + dt * 11.5);
    this.spread = speed * .34 + this.shotChain * 1.7;
  }

  startReload() {
    if (this.reloadPending || this.player.ammo === 30 || this.player.reserve === 0) return;
    this.reloadPending = true;
    this.weapon.reload(this.player.ammo === 0);
    this.audio.mechanical('handling');
  }

  throwItem(type) {
    const p = this.player;
    if (!p[type]) return;
    p[type]--;
    this.audio.mechanical('throw');
    const start = this.traceStart.copy(this.eye).addScaledVector(this.aim, .12).addScaledVector(UP, -.15);
    this.effects.throw(start, this.aim, type);
    this.botSystem.hear(start, p.team, 13);
  }

  playerFire(speed, ads, crouch) {
    const p = this.player;
    p.ammo--;
    p.spawnShieldUntil = 0;
    this.shots++;
    this.fireAt = .089;
    this.shotChain = Math.min(4.7, this.shotChain + .54);
    const spread = (.0028 + speed * .00083 + this.shotChain * .0019) * (ads ? .52 : 1) * (crouch ? .67 : 1);
    const azimuth = this.random() * Math.PI * 2, variance = Math.sqrt(this.random()) * spread;
    this.shotDirection.copy(this.aim).addScaledVector(this.right, Math.cos(azimuth) * variance)
      .addScaledVector(UP, Math.sin(azimuth) * variance).normalize();
    this.shotStart.copy(this.eye);
    this.weapon.muzzlePosition(this.shotMuzzle).applyQuaternion(this.camera.quaternion).add(this.eye);
    if (this.physics.segmentCast(this.eye, this.shotMuzzle)) this.shotMuzzle.copy(this.eye);
    this.weapon.ejectPosition(this.eject).applyQuaternion(this.camera.quaternion).add(this.eye);
    this.effects.casing(this.eject, this.traceDirection.copy(this.right).multiplyScalar(2.8).addScaledVector(this.aim, -.59));
    this.weapon.fire();
    this.gasTimer = .115;
    this.audio.gun();
    this.effects.flash(this.shotMuzzle, this.shotDirection, true);
    this.botSystem.hear(this.eye, p.team, 47);
    this.bullet(p, this.shotStart, this.shotDirection, this.shotMuzzle, this.shots % 4 === 0, 1, 0);
    this.kick = Math.min(.092, this.kick + (ads ? .009 : .015) + this.random() * .0055);
    this.kickSide += (Math.sin(this.shots * .78) * .68 + (this.random() - .5) * .37) * .008;
  }

  botFire(bot, origin, direction) {
    if (this.state !== 'play' && this.state !== 'dead') return;
    bot.spawnShieldUntil = 0;
    const distance = origin.distanceTo(this.camera.position);
    if (distance < 102) this.audio.gun(origin, this.occluded(origin));
    this.effects.flash(origin, direction, false);
    if (distance < 38) {
      this.effects.casing(origin, this.eject.set(direction.z, .3, -direction.x).multiplyScalar(1.7));
    }
    if (distance < 30 && !this.occluded(origin)) bot.revealedUntil = this.elapsed + 1.3;
    this.bullet(bot, origin, direction, origin, this.random() < .27, .67, 0);
  }

  botStep(bot, surface) {
    if (bot.position.distanceToSquared(this.camera.position) < 35 * 35) {
      this.audio.footstep(surface, bot.position, .66, this.occluded(bot.position));
    }
  }

  occluded(source) {
    const ray = this.soundRay.subVectors(source, this.camera.position);
    const distance = ray.length();
    return distance > .16 && Boolean(this.physics.raycast(this.camera.position, ray.multiplyScalar(1 / distance), distance - .16));
  }

  actorHit(shooter, origin, direction, limit, includeProtected = false) {
    let nearest = limit, target = null, zone = '';
    for (const actor of this.actors) {
      if (actor.team === shooter.team || !actor.alive || (!includeProtected && this.elapsed < actor.spawnShieldUntil)) continue;
      const { x, y, z } = actor.position;
      const h = actor.height;
      const head = hitSphere(origin, direction, x, y + h * .925, z, .168);
      const chest = hitSphere(origin, direction, x, y + h * .701, z, .304);
      const waist = hitSphere(origin, direction, x, y + h * .49, z, .24);
      const upperLegs = hitSphere(origin, direction, x, y + h * .32, z, .22);
      const boots = hitSphere(origin, direction, x, y + h * .15, z, .17);
      const d = Math.min(head, chest, waist, upperLegs, boots);
      if (d >= nearest) continue;
      nearest = d;
      target = actor;
      zone = d === head ? 'head' : d === upperLegs || d === boots ? 'limb' : 'body';
    }
    return target ? { distance: nearest, target, zone } : null;
  }

  bullet(shooter, origin, direction, muzzle, tracer, energy, depth, ignore = null) {
    const fixedHit = this.physics.raycast(origin, direction, 144, ignore);
    const surface = this.rigid.raycast(origin, direction, fixedHit?.distance ?? 144) ?? fixedHit;
    const actor = this.actorHit(shooter, origin, direction, surface?.distance ?? 144);
    const distance = actor?.distance ?? surface?.distance ?? 144;
    const end = this.shotEnd.copy(origin).addScaledVector(direction, distance);
    if (tracer) this.effects.tracer(muzzle, end);
    if (shooter.team === 1 && !actor && this.player.alive && depth === 0) {
      const relative = this.eject.subVectors(this.camera.position, origin);
      const point = relative.dot(direction);
      if (point > 1 && point < distance && relative.lengthSq() - point * point < 2.6) {
        this.audio.whiz(relative.copy(origin).addScaledVector(direction, point));
      }
    }
    if (actor) {
      const falloff = 1 - clamp((distance - 19) * .0034, 0, .26);
      const damage = (actor.zone === 'head' ? 108 : actor.zone === 'limb' ? 23 : 34) * energy * falloff;
      this.damage(shooter, actor.target, damage, actor.zone === 'head', direction);
      return;
    }
    if (!surface) return;
    this.effects.impact(surface.point, surface.normal, surface.surface, !surface.body);
    if (surface.body) {
      const energyScale = surface.surface === 'metal' ? 1.0 : 1.7;
      this.rigid.impulse(surface.body, this.propImpulse.copy(direction).multiplyScalar(energy * energyScale).addScaledVector(UP, .13), surface.point);
    }
    const soundDistance = this.camera.position.distanceTo(surface.point);
    if (soundDistance < 55) this.audio.impact(surface.surface, surface.point, this.occluded(surface.point));
    if (depth || surface.normal.lengthSq() < .9) return;

    const material = penetration[surface.surface];
    if (material && surface.exitDistance - surface.distance < material[0] && surface.exitDistance > surface.distance) {
      const exit = origin.clone().addScaledVector(direction, surface.exitDistance + .02);
      this.bullet(shooter, exit, direction, exit, false, energy * material[1], 1, surface.collider);
    } else if ((surface.surface === 'metal' || surface.surface === 'concrete')
      && Math.abs(direction.dot(surface.normal)) < .21 && this.random() < .37) {
      const ricochet = direction.clone().reflect(surface.normal).normalize();
      const start = surface.point.clone().addScaledVector(surface.normal, .021);
      this.bullet(shooter, start, ricochet, start, true, energy * .27, 1, surface.collider);
    }
  }

  damage(shooter, target, value, head, direction) {
    if (this.state === 'end' || !target.alive || this.elapsed < target.spawnShieldUntil) return;
    target.health = Math.max(0, target.health - value);
    const killed = target.health <= 0;
    if (target === this.player) {
      this.lastDamage = this.elapsed;
      this.hurt = Math.min(1, this.hurt + value * .014 + .21);
      this.damageKick += (this.random() - .5) * .034;
      this.ui.hurt(wrapAngle(Math.atan2(-direction.x, direction.z) - this.yaw), this.elapsed);
      this.audio.cue('damage');
    } else {
      this.botSystem.hit(target, value, direction);
      if (shooter === this.player) target.revealedUntil = this.elapsed + 1.4;
    }
    if (shooter === this.player && target !== shooter) {
      this.ui.hit(killed ? 'kill' : head ? 'head' : 'body', this.elapsed);
      this.audio.cue(killed ? 'kill' : head ? 'head' : 'hit');
    }
    if (!killed) return;
    if (target === this.player) {
      target.alive = false;
      this.deathDirection.copy(direction).normalize();
      this.playerRig.ready = false;
      this.playerRig.pose({
        position: target.position, height: target.height, controller: this.controller, velocity: this.controller.velocity,
        yaw: -this.yaw, pitch: this.pitch, kick: this.kick, clock: this.elapsed,
      }, this.physics, STEP);
      this.playerRig.fall(this.deathDirection, this.controller.velocity);
      this.playerRig.group.visible = false;
      this.deathAge = 0;
      this.phase('dead');
    } else {
      this.botSystem.kill(target, direction);
      target.respawnAt = this.elapsed + 4.5;
    }
    if (shooter !== target) {
      this.scores[shooter.team]++;
      this.ui.elimination(shooter, target, head, this.elapsed, this.player);
      if (this.scores[shooter.team] >= WIN) this.end();
    }
  }

  blast(position, type) {
    this.audio.blast(position, this.occluded(position), type === 'smoke');
    this.botSystem.hear(position, 0, type === 'smoke' ? 20 : 57);
    if (type !== 'frag') return;
    for (const body of this.props) {
      const force = this.propImpulse.subVectors(body.position, position);
      const distance = force.length();
      if (distance >= 6 || this.physics.segmentCast(position, body.position)) continue;
      force.normalize().addScaledVector(UP, .51).multiplyScalar((1 - distance / 6) * 4 / Math.sqrt(body.invMass));
      this.rigid.impulse(body, force);
    }
    for (const actor of this.actors) {
      if (!actor.alive || actor.team === 0 && actor !== this.player) continue;
      const center = this.eject.copy(actor.position).addScaledVector(UP, actor.height * .54);
      const distance = center.distanceTo(position);
      if (distance >= 7 || this.physics.segmentCast(position, center)) continue;
      const strength = 103 * (1 - distance / 8.1) ** 1.27;
      this.damage(this.player, actor, strength, false, this.traceDirection.subVectors(center, position).normalize());
    }
  }

  end() {
    if (this.state === 'end') return;
    const [blue, red] = this.scores;
    const title = blue > red ? 'VICTORY' : red > blue ? 'DEFEAT' : 'DRAW';
    this.phase('end', { title, detail: 'Final score  ' + blue + ' — ' + red });
    this.audio.cue('end');
    this.clearInput();
    if (document.pointerLockElement) document.exitPointerLock();
    this.needsRender = true;
  }

  step(dt) {
    this.elapsed += dt;
    this.playerStep(dt);
    this.botSystem.step(dt, this.player, this.elapsed, ({ Recruit: 'easy', Regular: 'normal', Veteran: 'hard' })[this.settings.difficulty]);
    this.effects.step(dt, this.player, (position, type) => this.blast(position, type));
    this.rigid.step(dt);
    for (const bot of this.bots) {
      if (bot.alive || this.elapsed < bot.respawnAt) continue;
      this.botSystem.respawn(bot, this.bestSpawn(bot));
      bot.spawnShieldUntil = this.elapsed + 1.6;
      bot.revealedUntil = 0;
    }
    if (this.elapsed >= ROUND) this.end();
  }

  updateTeamMarkers() {
    const origin = this.camera.position;
    const view = this.camera.getWorldDirection(this.forward);
    const maxDistance = 48;
    let aimed = null;
    if (this.player.alive) {
      const solid = this.physics.raycast(origin, view, maxDistance);
      const prop = this.rigid.raycast(origin, view, solid?.distance ?? maxDistance);
      aimed = this.actorHit(this.player, origin, view, prop?.distance ?? solid?.distance ?? maxDistance, true)?.target;
    }
    let hostile = false;
    for (const bot of this.bots) {
      const friendly = bot.team === this.player.team;
      if (this.player.alive && bot.alive && (friendly || bot === aimed)) {
        const head = this.markerWorld.copy(bot.position).addScaledVector(UP, bot.height * .93);
        const ray = this.markerRay.subVectors(head, origin);
        const distance = ray.length();
        if (distance < maxDistance && ray.dot(view) > .05) {
          if (!friendly) head.copy(origin).addScaledVector(view, distance);
          const targetVisible = !this.effects.smokeBlocks(origin, head)
            && (!friendly || !this.physics.raycast(origin, ray.multiplyScalar(1 / distance), distance - .08));
          if (targetVisible) {
            const at = this.markerWorld.copy(bot.position).addScaledVector(UP, bot.height + .19).project(this.camera);
            if (Math.abs(at.x) < .97 && Math.abs(at.y) < .95) {
              this.ui.teamMarker(bot, friendly, (at.x + 1) * 50, (1 - at.y) * 50, distance);
              hostile ||= !friendly;
              continue;
            }
          }
        }
      }
      this.ui.teamMarker(bot, friendly);
    }
    this.ui.hostileAim(hostile);
  }

  draw(dt, alpha, moving) {
    this.updateCamera(alpha);
    this.world.update(this.time);
    this.effects.render(this.renderer.sceneColor.height, this.camera.fov);
    if (moving) {
      this.camera.getWorldDirection(this.forward);
      this.audio.listener(this.camera.position, this.forward, UP, this.player.health);
      if (!this.spaceProbe || this.elapsed >= this.spaceProbe || this.elapsed < this.spaceProbe - .7) {
        this.spaceProbe = this.elapsed + .47;
        let open = 0;
        for (let i = 0; i < 7; i++) {
          const angle = i * Math.PI * 2 / 7;
          const direction = this.soundRay.set(Math.sin(angle), i === 0 ? 1 : .15, Math.cos(angle)).normalize();
          const obstruction = this.physics.raycast(this.camera.position, direction, 9);
          open += obstruction ? obstruction.distance / 9 : 1;
          this.diagnostics.audioRay(i, this.camera.position, direction, obstruction);
        }
        this.audio.setSpace(open / 7);
        this.light = this.physics.raycast(this.camera.position, MARKET_SUN, 25) ? .55 : 1;
      }
    }
    const interpolating = moving && !this.qaScene;
    if (interpolating) this.botSystem.present(alpha);
    try {
      this.renderer.render(this.time, dt, {
        health: this.player.health, hurt: this.hurt, flash: this.weapon.flashActive ? 1 : 0,
        weapon: (moving || this.qaScene) && this.player.alive, light: this.light || 1, moving,
        particles: this.effects.material,
        gas: this.gasTimer > 0 && this.player.alive ? this.weapon.muzzlePosition(this.gasPosition) : null,
        gasStrength: this.gasTimer * 7,
      });
    } finally {
      if (interpolating) this.botSystem.restorePresentation();
    }
    if (!moving && !this.qaScene) return;
    this.updateTeamMarkers();
    const status = !this.player.alive ? 'REDEPLOYING IN ' + Math.max(1, Math.ceil(3.5 - this.deathAge))
      : this.reloadPending ? 'RELOADING' : this.player.ammo === 0 ? 'MAGAZINE EMPTY'
      : this.player.health < 99.5 && this.elapsed - this.lastDamage > 5.4 ? 'RECOVERING' : '';
    this.ui.frame({
      player: this.player, bots: this.bots, elapsed: this.elapsed, remaining: Math.max(0, Math.ceil(ROUND - this.elapsed)),
      scores: this.scores, yaw: this.yaw, ads: this.weapon.ads, spread: this.spread || 0, status,
    });
    if (!this.ui.el.telemetry.hidden && this.renderer.frame % 8 === 0) {
      const stats = this.stats();
      this.ui.el.telemetry.textContent = ['FRAME / ' + (dt * 1000).toFixed(1) + ' ms',
        'DRAWS / ' + stats.calls, 'TRIS / ' + stats.triangles.toLocaleString(),
        'MODE / ' + DEBUG_NAMES[this.debugMode],
      ].join('\n');
    }
  }

  frame(now) {
    this.animation = requestAnimationFrame(this.frame);
    if (this.lostContext || this.state === 'error') return;
    if (!this.lastFrame) this.lastFrame = now - 16.67;
    const wallDt = (now - this.lastFrame) / 1000;
    if (wallDt <= 0) return;
    const moving = this.state === 'play' || this.state === 'dead';
    if (this.qaScene && !this.needsRender) return;
    if (!moving && !this.needsRender && wallDt < (this.state === 'ready' ? .095 : .25)) return;
    this.lastFrame = now;
    const dt = Math.min(wallDt, .1);
    if (!this.qaScene) this.time += dt;
    if (moving && !this.qaScene) {
      this.look(dt);
      this.accumulator += dt;
      for (let i = 0; this.accumulator >= STEP && i < 12; i++) {
        if (this.state === 'end') break;
        this.step(STEP);
        this.accumulator -= STEP;
      }
      if (this.state === 'end') this.accumulator = 0;
      this.frames.push(wallDt * 1000);
      if (this.frames.length > 640) this.frames.shift();
    }
    this.draw(dt, clamp(this.accumulator / STEP, 0, 1), moving);
    this.needsRender = false;
  }

  stats() {
    const samples = this.frames.slice().sort((a, b) => a - b);
    return {
      ...this.renderer.timing,
      count: samples.length, avg: samples.reduce((a, b) => a + b, 0) / (samples.length || 1),
      p95: samples[Math.max(0, Math.ceil(samples.length * .95) - 1)] || 0, worst: samples.at(-1) || 0,
      particles: this.effects.active, rigidBodies: this.effects.bodies + this.rigid.activeCount,
      looseProps: this.props.length, audioVoices: this.audio.voices,
      hdr: this.renderer.hdr, scale: this.renderer.scale, gpu: this.renderer.gpu,
      finite: this.actors.every(a => a.position.toArray().every(Number.isFinite)),
      errors: [...this.errors],
    };
  }

  dispose() {
    cancelAnimationFrame(this.animation);
    this.audio.dispose();
    this.debugMode = 0;
    this.diagnostics.dispose();
    this.botSystem.dispose();
    this.world.dispose();
    this.weapon.dispose();
    this.playerRig.dispose();
    this.soldiers.dispose();
    const geometries = new Set(), materials = new Set(), textures = new Set();
    this.scene.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!material) continue;
        materials.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      }
    });
    for (const texture of textures) texture.dispose();
    for (const material of materials) material.dispose();
    for (const geometry of geometries) geometry.dispose();
    this.renderer.dispose();
  }

  installHarness() {
    window.__marketline = {
      stats: () => this.stats(),
      clearStats: () => { this.frames.length = 0; },
      snapshot: () => ({
        state: this.state, position: this.player.position.toArray(), ammo: this.player.ammo,
        reserve: this.player.reserve, ads: this.weapon.ads, health: this.player.health, alive: this.player.alive,
        time: this.elapsed, score: this.scores.slice(), pointerLock: document.pointerLockElement === canvas,
        bots: this.bots.map(b => ({ state: b.state, position: b.position.toArray(), health: b.health, alive: b.alive })),
      }),
      stage: name => this.stage(name),
      encounter: () => {
        this.setLandmark('market');
        const enemy = this.bots.find(b => b.team === 1);
        this.botSystem.respawn(enemy, new THREE.Vector3(-.1, 0, 22.3));
        enemy.spawnShieldUntil = 0;
        enemy.shootAt = 999;
        this.pitch = -.029;
        this.yaw = Math.atan2(enemy.position.x - this.player.position.x, this.player.position.z - enemy.position.z);
      },
      hurt: amount => {
        this.player.spawnShieldUntil = 0;
        this.damage(this.bots.at(-1), this.player, amount, false, new THREE.Vector3(0, 0, 1));
      },
      finish: () => { this.elapsed = ROUND - .05; },
      playOut: () => {
        this.qaScene = false;
        this.reset();
        this.phase('play');
        for (let i = 0; i <= Math.ceil(ROUND / STEP) && this.state !== 'end'; i++) this.step(STEP);
        return { state: this.state, scores: this.scores.slice(), elapsed: this.elapsed };
      },
      profileSetup: () => {
        this.qaScene = false;
        this.reset();
        this.phase('play');
        this.setLandmark('market');
        const enemy = this.bots.find(b => b.team === 1);
        this.botSystem.respawn(enemy, new THREE.Vector3(-.1, 0, 22.3));
        this.botSystem.respawn(this.bots[0], new THREE.Vector3(-4.1, 0, 29.2));
        this.pitch = -.029;
        this.trigger = 1;
      },
      leaveStage: () => {
        this.qaScene = false;
        this.reset();
        this.phase('play');
      },
    };
  }

  stage(name) {
    this.qaScene = true;
    this.phase('play');
    this.reset();
    this.elapsed = this.time = 13.2;
    this.setLandmark(['spawn', 'market', 'arch', 'plaza', 'alley'].includes(name) ? name : 'market');
    if (name === 'ads') {
      for (let i = 0; i < 35; i++) this.weapon.update(.016, { ads: true });
      this.cameraFov = this.settings.fov - 20 * this.weapon.ads;
    }
    if (name === 'muzzle') { this.weapon.fire(); this.weapon.update(.003); this.gasTimer = .1; }
    if (name === 'impact') {
      const from = this.camera.position;
      const direction = new THREE.Vector3(1.93, .64, 28.1).sub(from).normalize();
      this.yaw = Math.atan2(direction.x, -direction.z);
      this.pitch = Math.asin(direction.y) * .6;
      const hit = this.physics.raycast(from, direction, 60);
      if (hit) {
        this.effects.impact(hit.point, hit.normal, hit.surface);
        this.effects.step(.052, this.player, () => {});
      }
    }
    if (name === 'low-health') {
      this.player.spawnShieldUntil = 0;
      this.damage(this.bots.at(-1), this.player, 80, false, new THREE.Vector3(.3, 0, 1).normalize());
    }
    if (name === 'operative-front' || name === 'operative-crouch') {
      const bot = this.bots.find(bot => bot.team === 1);
      const crouched = name === 'operative-crouch';
      this.botSystem.respawn(bot, new THREE.Vector3(-2.16, 0, 30.65));
      bot.height = crouched ? 1.16 : 1.77;
      bot.yaw = Math.PI + (crouched ? .9 : .25);
      bot.state = 'engage';
      bot.visibleTarget = this.player;
      bot.rig.ready = false;
      bot.rig.pose(bot, this.physics, 1 / 60);
      this.yaw = -.053;
      this.pitch = crouched ? -.225 : -.136;
      this.cameraFov = 49;
    }
    if (name === 'encounter' || name === 'team-cover') {
      const enemy = this.bots.find(b => b.team === 1);
      const covered = name === 'team-cover';
      this.botSystem.respawn(enemy, covered ? new THREE.Vector3(29.5, 0, 30.4) : new THREE.Vector3(.25, 0, 24.1));
      this.botSystem.respawn(this.bots[0], new THREE.Vector3(-4.1, 0, 29.2));
      const offset = this.markerRay.subVectors(enemy.position, this.player.position);
      this.yaw = Math.atan2(offset.x, -offset.z);
      this.pitch = Math.atan2(enemy.position.y + enemy.height * .71 - this.camera.position.y, Math.hypot(offset.x, offset.z));
      if (!covered) this.effects.flash(enemy.position.clone().addScaledVector(UP, 1.38), new THREE.Vector3(0, 0, 1), false);
    }
    this.renderer.jitterIndex = 0;
    for (let i = 0; i < 5; i++) this.draw(.016, 1, true);
  }
}

const game = new Marketline();
game.boot().catch(error => {
  console.error(error);
  game.phase('error', error.message);
});
