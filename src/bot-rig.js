import {
  BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, DataTexture, Euler, LinearFilter, LinearMipmapLinearFilter, Matrix4, Mesh, MeshStandardMaterial, RepeatWrapping,
  Quaternion, SphereGeometry, Vector3, MathUtils,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addKit } from './operative-kit.js';
import { buildHead } from './operative-head.js';
import { OperativeUniform } from './operative-uniform.js';
import { angleDelta, BotGait } from './bot-gait.js';
import { BotPresentation } from './bot-presentation.js';

const UP = new Vector3(0, 1, 0);
const DOWN = new Vector3(0, -1, 0);
const PALETTES = [
  ['#515343', '#35413e', '#505547', '#333833'],
  ['#4f5141', '#59513c', '#6b614a', '#292b24'],
  ['#57594b', '#3c4136', '#575c4a', '#33372d'],
  ['#6d604d', '#433b35', '#59483c', '#282420'],
  ['#50463a', '#625845', '#73674e', '#32291e'],
  ['#6a5e4d', '#4a4339', '#635747', '#3a3025'],
  ['#585a4b', '#463731', '#6b4b3c', '#2e2420'],
  ['#535b43', '#354442', '#59604a', '#272f2a'],
];

const PELVIS = 0;
const NECK = 1;
const HEAD = 2;
const LEFT_HIP = 3;
const LEFT_KNEE = 4;
const LEFT_FOOT = 5;
const RIGHT_HIP = 6;
const RIGHT_KNEE = 7;
const RIGHT_FOOT = 8;
const LEFT_SHOULDER = 9;
const LEFT_ELBOW = 10;
const LEFT_HAND = 11;
const RIGHT_SHOULDER = 12;
const RIGHT_ELBOW = 13;
const RIGHT_HAND = 14;
const TORSO_JOINTS = [PELVIS, NECK, HEAD, LEFT_HIP, RIGHT_HIP, LEFT_SHOULDER, RIGHT_SHOULDER];
const TORSO_CONTACTS = [[.43, .155, .11], [.69, .145, .107], [.55, -.104, .11]];
const RAGDOLL_RADII = [.135, .13, .145, .106, .089, .130, .106, .089, .130, .085, .069, .062, .085, .069, .062];

function parts(detail) {
  const geometry = [];
  function add(shape, color = null, x = 0, y = 0, z = 0, mottled = false, band = null) {
    shape.translate(x, y, z);
    const coordinates = shape.getAttribute('position');
    const rgb = new Float32Array(coordinates.count * 3);
    const tint = new Color(color ?? '#ffffff');
    const bandTint = band ? new Color(band.color) : tint;
    for (let index = 0; index < coordinates.count; index += 1) {
      const offset = index * 3;
      const height = coordinates.getY(index);
      const vertexTint = band && height >= band.minY && height <= band.maxY ? bandTint : tint;
      const scale = mottled ? 1 + Math.sin(coordinates.getY(index) * 42 + coordinates.getZ(index) * 36) * 0.105
        + Math.cos(coordinates.getX(index) * 34 - coordinates.getY(index) * 24) * 0.075 : 1;
      rgb[offset] = vertexTint.r * scale;
      rgb[offset + 1] = vertexTint.g * scale;
      rgb[offset + 2] = vertexTint.b * scale;
    }
    if (color !== null || !shape.hasAttribute('color')) shape.setAttribute('color', new BufferAttribute(rgb, 3));
    if (!shape.hasAttribute('uv')) shape.setAttribute('uv', new BufferAttribute(new Float32Array(coordinates.count * 2), 2));
    if (shape.index) {
      geometry.push(shape.toNonIndexed());
      shape.dispose();
    } else {
      geometry.push(shape);
    }
  }
  return {
    geometry: add,
    box(w, h, d, x, y, z, color, radius = 0.009) {
      if (!detail && Math.max(w, h, d) < 0.07) return;
      const shape = radius && detail ? new RoundedBoxGeometry(w, h, d, 1, radius) : new BoxGeometry(w, h, d);
      add(shape, color, x, y, z);
    },
    round(w, h, d, x, y, z, color, band) {
      const shape = new SphereGeometry(1, detail ? 12 : 8, detail ? 8 : 5).scale(w / 2, h / 2, d / 2);
      add(shape, color, x, y, z, false, band);
    },
    garment(profile, color, phase, band) {
      const sections = detail ? 14 : 8;
      const positions = [];
      const uvs = [];
      const indices = [];
      for (let row = 0; row < profile.length; row += 1) {
        const [y, width, depth, forward = 0] = profile[row];
        for (let segment = 0; segment < sections; segment += 1) {
          const angle = segment * Math.PI * 2 / sections;
          const wrinkle = 1 + Math.sin(angle * 3 + phase + row * 0.88) * 0.045
            + Math.sin(angle * 2 - phase + row * 1.73) * 0.033;
          positions.push(Math.cos(angle) * width * wrinkle, y, Math.sin(angle) * depth * wrinkle + forward);
          uvs.push(segment / sections, row / (profile.length - 1));
          if (row === profile.length - 1) continue;
          const next = row * sections + (segment + 1) % sections;
          const current = row * sections + segment;
          indices.push(current, current + sections, next, next, current + sections, next + sections);
        }
      }
      const cap = positions.length / 3;
      const bottom = profile[0], top = profile.at(-1);
      positions.push(0, bottom[0], bottom[3] || 0, 0, top[0], top[3] || 0);
      uvs.push(.5, 0, .5, 1);
      for (let i = 0; i < sections; i++) {
        const next = (i + 1) % sections;
        const offset = (profile.length - 1) * sections;
        indices.push(cap, i, next, cap + 1, offset + next, offset + i);
      }
      const shape = new BufferGeometry();
      shape.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
      shape.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
      shape.setIndex(indices);
      shape.computeVertexNormals();
      add(shape, color, 0, 0, 0, true, band);
    },
    cylinder(top, bottom, h, x, y, z, color, alongZ = false) {
      const shape = new CylinderGeometry(top, bottom, h, detail ? 10 : 6);
      if (alongZ) shape.rotateX(Math.PI / 2);
      add(shape, color, x, y, z);
    },
    mesh(group, material) {
      const merged = mergeGeometries(geometry);
      for (const shape of geometry) shape.dispose();
      merged.computeBoundingSphere();
      const mesh = new Mesh(merged, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group?.add(mesh);
      return mesh;
    },
  };
}

function makeRifle(group, detail, metal) {
  const gun = parts(detail);
  gun.box(0.064, 0.094, 0.205, 0, 0.03, -0.044, '#292d2c');
  gun.box(0.058, 0.07, 0.24, 0, 0.043, -0.257, '#414241');
  gun.box(0.069, 0.042, 0.11, 0, 0.082, -0.035, '#161819');
  gun.box(0.046, 0.065, 0.058, 0, -0.04, 0.034, '#272724');
  gun.box(0.05, 0.135, 0.072, 0, -0.046, -0.098, '#373932');
  gun.box(0.048, 0.013, 0.079, 0, -0.113, -0.098, '#535650', 0);
  gun.box(0.051, 0.032, 0.16, 0, 0.027, 0.127, '#3b3d37');
  gun.box(0.047, 0.104, 0.054, 0, 0.028, 0.205, '#222624');
  gun.cylinder(0.011, 0.011, 0.15, 0, 0.042, -0.432, '#262b2c', true);
  gun.cylinder(0.016, 0.016, 0.045, 0, 0.042, -0.501, '#424744', true);
  gun.cylinder(0.021, 0.021, 0.076, 0, 0.121, -0.06, '#333b36', true);
  gun.cylinder(0.017, 0.017, 0.002, 0, 0.121, -0.099, '#4c7474', true);
  for (let index = 0; index < 6; index += 1) {
    gun.box(0.066, 0.009, 0.011, 0, 0.083, -0.174 - index * 0.034, '#676a61', 0);
    for (const side of [-1, 1]) {
      gun.box(0.0015, 0.013, 0.021, side * 0.03, 0.043, -0.175 - index * 0.033, '#242726', 0);
    }
  }
  return gun.mesh(group, metal);
}

function makeOperative(group, index, team, detail, clothMaterial, fabric, metal) {
  const [cloth, vest, gear, boot] = PALETTES[index];
  const insignia = team === 0 ? '#458bb3' : '#bc5343';
  const edging = team === 0 ? '#2e536b' : '#753e35';
  const torso = parts(detail);
  torso.garment([
    [-.098, .099, .059], [-.078, .142, .082], [-.045, .163, .099], [.014, .169, .107],
    [.11, .145, .106], [.18, .149, .103], [.239, .157, .108], [.327, .172, .117],
    [.407, .176, .112], [.453, .163, .102], [.486, .121, .081], [.515, .068, .068],
    [.569, .057, .059],
  ], cloth, index);
  // The roll collar bridges the head and shoulder seam and follows the shirt.
  torso.garment([
    [.484, .077, .075], [.512, .073, .072], [.546, .067, .066], [.579, .063, .064], [.591, .058, .061],
  ], vest, index + 4);
  addKit(torso, { detail, index, team, cloth, vest, gear, boot, insignia, edging });

  const head = parts(detail);
  buildHead(head, { detail, index, team, cloth, vest, gear, boot, insignia, edging });

  const limbs = [];
  for (const side of [-1, 1]) {
    const shoe = parts(detail);
    const shoeSections = [
      [-.216, .029, -.075, -.045], [-.204, .05, -.079, -.029], [-.171, .061, -.078, -.006],
      [-.117, .062, -.078, .022], [-.072, .057, -.078, .057], [-.023, .053, -.078, .071],
      [.025, .055, -.078, .067], [.052, .053, -.078, .05], [.068, .034, -.075, .018],
    ];
    shoe.geometry(bootLoft(shoeSections, detail ? 16 : 10), boot);
    const tread = shoeSections.map(([z, width]) => [z * 1.025, width * 1.055, -.086, -.061]);
    shoe.geometry(bootLoft(tread, detail ? 16 : 10), '#36372f');
    if (detail) {
      for (let lace = 0; lace < 5; lace++) {
        shoe.box(.058 - lace * .003, .006, .009, 0, .046 - lace * .011, -.075 - lace * .014, '#555246', .002);
      }
      for (const edge of [-1, 1]) {
        shoe.box(.006, .011, .108, edge * .053, -.051, -.057, '#5d5748', .002);
      }
    }
    const glove = parts(detail);
    glove.garment([
      [-.048, .021, .033, .001], [-.033, .031, .043, -.008], [-.007, .036, .044, -.011],
      [.022, .035, .043, -.012], [.034, .026, .036, -.004], [.043, .017, .025, -.002],
    ], boot, index + side);
    glove.round(.034, .057, .058, side * -.027, .006, -.022, gear);
    if (detail) {
      for (let knuckle = 0; knuckle < 4; knuckle++) {
        glove.round(.018, .02, .024, -.025 + knuckle * .016, .019 - Math.abs(knuckle - 1.5) * .004, -.043, boot);
      }
    }
    limbs.push({ shoe: shoe.mesh(group, clothMaterial), glove: glove.mesh(group, clothMaterial) });
  }
  const uniform = new OperativeUniform(group, detail, index, fabric, cloth, insignia);
  return { torso: torso.mesh(group, clothMaterial), head: head.mesh(group, clothMaterial), limbs, uniform, rifle: makeRifle(group, detail, metal) };
}

function bootLoft(sections, sides) {
  const positions = [], uvs = [], indices = [];
  for (let ring = 0; ring < sections.length; ring++) {
    const [z, width, bottom, top] = sections[ring];
    for (let i = 0; i < sides; i++) {
      const angle = i * 2 * Math.PI / sides;
      const cosine = Math.cos(angle), sine = Math.sin(angle);
      const x = Math.sign(cosine) * Math.abs(cosine) ** .68 * width;
      const y = (bottom + top) * .5 + Math.sign(sine) * Math.abs(sine) ** .71 * (top - bottom) * .5;
      positions.push(x, y, z);
      uvs.push(i / sides, ring / (sections.length - 1));
      if (ring < sections.length - 1) {
        const start = ring * sides;
        const next = (i + 1) % sides;
        indices.push(start + i, start + next, start + i + sides, start + next, start + next + sides, start + i + sides);
      }
    }
  }
  const cap = positions.length / 3;
  for (const [z, , bottom, top] of [sections[0], sections.at(-1)]) {
    positions.push(0, (bottom + top) * .5, z);
    uvs.push(.5, .5);
  }
  for (let i = 0; i < sides; i++) {
    const next = (i + 1) % sides, offset = (sections.length - 1) * sides;
    indices.push(cap, next, i, cap + 1, offset + i, offset + next);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function wovenFabric() {
  const size = 64, rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const crossing = ((x >> 2) + (y >> 2)) % 2;
      const warp = Math.cos(x * Math.PI * .5), weft = Math.cos(y * Math.PI * .5);
      const fibre = Math.imul(x + 53, y + 97) % 13 - 6;
      const shade = 235 + 7 * (crossing ? warp + weft * .42 : weft + warp * .42) + fibre;
      const i = (y * size + x) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = shade;
      rgba[i + 3] = 255;
    }
  }
  const texture = new DataTexture(rgba, size, size);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return new MeshStandardMaterial({ vertexColors: true, roughness: .91, map: texture, bumpMap: texture, bumpScale: .009 });
}

export class BotRig {
  constructor(group, index, team) {
    this.group = group;
    this.cloth = new MeshStandardMaterial({ vertexColors: true, roughness: 0.86 });
    this.fabric = wovenFabric();
    this.metal = new MeshStandardMaterial({ vertexColors: true, roughness: 0.52, metalness: 0.3 });
    this.skin = makeOperative(group, index, team, true, this.cloth, this.fabric, this.metal);
    const lowerDetail = makeOperative(null, index, team, false, this.cloth, this.fabric, this.metal);
    this.uniforms = [this.skin.uniform, lowerDetail.uniform];
    const skinnedMeshes = skin => [skin.torso, skin.head, skin.rifle, skin.uniform.mesh, ...skin.limbs.flatMap(Object.values)];
    const lowMeshes = skinnedMeshes(lowerDetail);
    this.geometry = skinnedMeshes(this.skin).map((mesh, part) => ({
      mesh, near: mesh.geometry, far: lowMeshes[part].geometry,
    }));
    this.presentation = new BotPresentation(this.geometry, this.skin.uniform.mesh);
    this.distant = false;
    this.joints = Array.from({ length: 15 }, () => new Vector3());
    this.previous = this.joints.map(() => new Vector3());
    this.constraints = [];
    this.limits = [];
    this.gait = new BotGait(index);
    this.feet = this.gait.feet;
    this.ready = false;
    this.bodyYaw = this.crouchPose = this.headScan = this.reloadPose = 0;
    this.reloadDuration = 0;
    this.pelvisHeight = .928;
    this.pelvisShift = 0;
    this.bodyBob = 0;
    this.travelLean = new Vector3();
    this.front = new Vector3();
    this.side = new Vector3();
    this.temp = new Vector3();
    this.axis = new Vector3();
    this.bend = new Vector3();
    this.bodyUp = new Vector3();
    this.bodySide = new Vector3();
    this.bodyBack = new Vector3();
    this.basis = new Matrix4();
    this.bodyRotation = new Quaternion();
    this.aim = new Quaternion();
    this.pitch = new Quaternion();
    this.headAim = new Quaternion();
    this.dropPoint = new Vector3();
    this.dropVelocity = new Vector3();
    this.dropTravel = new Vector3();
    this.dropRotation = new Quaternion();
    this.restRotation = new Quaternion();
    this.rifleSettled = false;
    this.footRotation = new Euler(0, 0, 0, 'YXZ');
    this.readyWeapon = .28;
    this.groundPoint = new Vector3();
    this.age = 0;
  }

  setDetail(distanceSquared) {
    const distant = distanceSquared > (this.distant ? 28 : 34) ** 2;
    if (distant === this.distant) return;
    this.distant = distant;
    for (const part of this.geometry) part.mesh.geometry = distant ? part.far : part.near;
  }

  place(out, bot, x, y, forward) {
    return out.copy(bot.position).addScaledVector(this.side, x).addScaledVector(this.front, forward).addScaledVector(UP, y);
  }

  midJoint(out, origin, end, pole, upper, lower) {
    const axis = this.axis.subVectors(end, origin);
    const distance = Math.min(upper + lower - 0.0001, Math.max(0.0001, axis.length()));
    axis.normalize();
    const offset = Math.min(upper, Math.max(-upper, (upper * upper - lower * lower + distance * distance) / (2 * distance)));
    const bend = this.bend.copy(pole).addScaledVector(axis, -pole.dot(axis)).normalize();
    return out.copy(origin).addScaledVector(axis, offset).addScaledVector(bend, Math.sqrt(upper * upper - offset * offset));
  }

  pose(bot, physics, dt) {
    this.group.visible = true;
    const reset = !this.ready;
    const joints = this.joints;
    const speed = Math.hypot(bot.velocity.x, bot.velocity.z);
    const drive = MathUtils.clamp(speed / 4.6, 0, 1);
    const crouchTarget = MathUtils.clamp((1.77 - bot.height) / .61, 0, 1);
    const aimReady = bot.visibleTarget || bot.state === 'engage' ? 1 : bot.state === 'cover' ? .66 : .28;
    if (!this.ready) {
      this.bodyYaw = bot.yaw;
      this.crouchPose = crouchTarget;
      this.readyWeapon = aimReady;
      this.reloadPose = 0;
      this.reloadDuration = 0;
      this.pelvisShift = this.bodyBob = this.headScan = 0;
      this.travelLean.set(bot.velocity.x * .023, 0, bot.velocity.z * .023);
      this.gait.reset(bot, physics, this.bodyYaw, this.readyWeapon, this.crouchPose);
    } else {
      this.bodyYaw += angleDelta(bot.yaw, this.bodyYaw) * (1 - Math.exp(-dt * (drive > .4 ? 15 : 11)));
      this.crouchPose += (crouchTarget - this.crouchPose) * (1 - Math.exp(-dt * 16));
      this.readyWeapon += (aimReady - this.readyWeapon) * (1 - Math.exp(-dt * 11));
    }
    const crouch = this.crouchPose;
    this.gait.update(dt, bot, physics, this.bodyYaw, this.readyWeapon, crouch, speed);
    this.pelvisShift += (this.gait.shift - this.pelvisShift) * (1 - Math.exp(-dt * 19));
    this.bodyBob += (this.gait.lift - this.bodyBob) * (1 - Math.exp(-dt * 23));
    this.side.set(Math.cos(this.bodyYaw), 0, -Math.sin(this.bodyYaw));
    this.front.set(-Math.sin(this.bodyYaw), 0, -Math.cos(this.bodyYaw));
    this.temp.set(bot.velocity.x * .024, 0, bot.velocity.z * .024);
    this.travelLean.lerp(this.temp, 1 - Math.exp(-dt * 10));

    const height = .928 - .278 * crouch - .055 * drive + this.bodyBob;
    const pelvis = joints[PELVIS];
    this.place(pelvis, bot, this.pelvisShift, height, .015 - crouch * .047);
    let reachHeight = height;
    for (let i = 0; i < 2; i++) {
      const foot = this.feet[i].position;
      const side = i ? .105 : -.105;
      const dx = pelvis.x + side * this.side.x - foot.x;
      const dz = pelvis.z + side * this.side.z - foot.z;
      const rise = Math.sqrt(Math.max(.10, .874 ** 2 - dx * dx - dz * dz));
      reachHeight = Math.min(reachHeight, foot.y - bot.position.y + rise);
    }
    if (!this.ready) this.pelvisHeight = reachHeight;
    else this.pelvisHeight += (reachHeight - this.pelvisHeight) * (1 - Math.exp(-dt * 21));
    pelvis.y = bot.position.y + Math.min(this.pelvisHeight, reachHeight + .012);
    const settle = pelvis.y - bot.position.y - (.928 - .278 * crouch);
    const breathing = Math.sin(bot.clock * 3.3) * (.0065 - drive * .0035);
    const lean = crouch * .085;
    this.place(joints[NECK], bot, -this.pelvisShift * .6, 1.485 - .526 * crouch + settle * .83 + breathing, lean);
    this.place(joints[HEAD], bot, -this.pelvisShift * .34, 1.644 - .58 * crouch + settle * .69 + breathing * .54, lean + .03);
    joints[NECK].add(this.travelLean);
    joints[HEAD].addScaledVector(this.travelLean, .94);

    for (let index = 0; index < 2; index++) {
      const side = index ? 1 : -1;
      const hip = joints[index ? RIGHT_HIP : LEFT_HIP];
      const knee = joints[index ? RIGHT_KNEE : LEFT_KNEE];
      const foot = joints[index ? RIGHT_FOOT : LEFT_FOOT];
      hip.copy(pelvis).addScaledVector(this.side, side * .105);
      foot.copy(this.feet[index].position);
      const footTurn = MathUtils.clamp(angleDelta(this.feet[index].yaw, this.bodyYaw), -.78, .78);
      const kneeYaw = this.bodyYaw + footTurn * .58 - side * crouch * .13;
      this.temp.set(-Math.sin(kneeYaw), 0, -Math.cos(kneeYaw));
      this.midJoint(knee, hip, foot, this.temp, .455, .432);
    }

    if (bot.reloading) this.reloadDuration = Math.max(this.reloadDuration, bot.reloading);
    else if (this.reloadPose < .01) this.reloadDuration = 0;
    const reloadTarget = MathUtils.clamp(bot.reloading / .24 || 0, 0, 1);
    this.reloadPose += (reloadTarget - this.reloadPose) * (1 - Math.exp(-dt * 14));
    this.aim.setFromAxisAngle(UP, bot.yaw + this.pelvisShift * .54);
    const riflePitch = bot.pitch + bot.kick * .064 - (1 - this.readyWeapon) * .17 - this.reloadPose * .15;
    this.pitch.setFromAxisAngle(this.temp.set(1, 0, 0), riflePitch);
    this.aim.multiply(this.pitch);
    const wantedScan = bot.visibleTarget ? 0 : Math.sin(bot.clock * 2.4 + (bot.phase || 0)) * (.10 + drive * .03);
    this.headScan += (wantedScan - this.headScan) * (1 - Math.exp(-dt * 10));
    this.headAim.setFromAxisAngle(UP, bot.yaw + this.headScan);
    this.pitch.setFromAxisAngle(this.temp.set(1, 0, 0), MathUtils.clamp(bot.pitch * .69, -.28, .34) + breathing);
    this.headAim.multiply(this.pitch);

    const gunHeight = 1.222 + .122 * this.readyWeapon - .515 * crouch + settle * .79 + breathing - this.reloadPose * .102;
    this.place(joints[RIGHT_HAND], bot, .153 - this.pelvisShift, gunHeight, .175 + lean * .53 - bot.kick * .03);
    joints[RIGHT_HAND].addScaledVector(this.travelLean, .53);
    const reloadTravel = this.reloadDuration > 0 ? Math.sin(Math.PI * MathUtils.clamp(bot.reloading / this.reloadDuration || 0, 0, 1)) : 0;
    this.temp.set(
      MathUtils.lerp(-.058, -.031, this.reloadPose),
      MathUtils.lerp(.018, -.094 - reloadTravel * .048, this.reloadPose),
      MathUtils.lerp(-.275, -.101, this.reloadPose),
    ).applyQuaternion(this.aim);
    joints[LEFT_HAND].copy(joints[RIGHT_HAND]).add(this.temp);

    for (let index = 0; index < 2; index++) {
      const side = index ? 1 : -1;
      const shoulder = joints[index ? RIGHT_SHOULDER : LEFT_SHOULDER];
      const elbow = joints[index ? RIGHT_ELBOW : LEFT_ELBOW];
      const hand = joints[index ? RIGHT_HAND : LEFT_HAND];
      shoulder.copy(joints[NECK]).addScaledVector(this.side, side * .167)
        .addScaledVector(this.front, side * -.035 * this.readyWeapon);
      shoulder.y -= .102;
      this.temp.copy(this.side).multiplyScalar(side * .42).addScaledVector(DOWN, .85);
      this.midJoint(elbow, shoulder, hand, this.temp, .281, .258);
    }
    this.ready = true;
    this.applyPose(false);
    this.presentation.save(reset);
    return this.gait.landed;
  }

  orient(out, upper, lower, front) {
    const axis = this.bodyUp.subVectors(upper, lower).normalize();
    const side = this.bodySide.crossVectors(front, axis);
    if (side.lengthSq() < 1e-8) side.copy(this.side);
    else side.normalize();
    const back = this.bodyBack.crossVectors(side, axis);
    this.basis.makeBasis(side, axis, back);
    return out.setFromRotationMatrix(this.basis);
  }

  applyPose(fallen) {
    const joints = this.joints;
    const skin = this.skin;
    if (fallen) this.side.subVectors(joints[RIGHT_SHOULDER], joints[LEFT_SHOULDER]).normalize();
    this.bodyUp.subVectors(joints[NECK], joints[PELVIS]).normalize();
    this.bodyBack.crossVectors(this.side, this.bodyUp).normalize();
    this.bodySide.crossVectors(this.bodyUp, this.bodyBack).normalize();
    this.basis.makeBasis(this.bodySide, this.bodyUp, this.bodyBack);
    this.bodyRotation.setFromRotationMatrix(this.basis);
    if (fallen) this.front.copy(this.bodyBack).negate();
    skin.torso.position.copy(joints[PELVIS]);
    skin.torso.quaternion.copy(this.bodyRotation);
    skin.torso.scale.y = MathUtils.clamp(joints[PELVIS].distanceTo(joints[NECK]) / 0.55, 0.75, 1.1);
    skin.head.position.copy(joints[HEAD]);
    skin.head.quaternion.copy(fallen ? this.bodyRotation : this.headAim);
    this.uniforms[Number(this.distant)].deform(joints, this.side, this.front, skin.uniform.mesh);
    for (let index = 0; index < 2; index += 1) {
      const limb = skin.limbs[index];
      const knee = joints[index ? RIGHT_KNEE : LEFT_KNEE];
      const foot = joints[index ? RIGHT_FOOT : LEFT_FOOT];
      limb.shoe.position.copy(foot);
      if (fallen) {
        this.orient(limb.shoe.quaternion, knee, foot, this.front);
      } else {
        const { roll, yaw } = this.feet[index];
        this.footRotation.set(roll, yaw, 0, 'YXZ');
        limb.shoe.quaternion.setFromEuler(this.footRotation);
      }

      const elbow = joints[index ? RIGHT_ELBOW : LEFT_ELBOW];
      const hand = joints[index ? RIGHT_HAND : LEFT_HAND];
      limb.glove.position.copy(hand);
      if (fallen) this.orient(limb.glove.quaternion, elbow, hand, this.front);
      else limb.glove.quaternion.copy(this.aim);
    }
    skin.rifle.position.copy(fallen ? this.dropPoint : joints[RIGHT_HAND]);
    skin.rifle.quaternion.copy(fallen ? this.dropRotation : this.aim);
  }

  muzzle(out) {
    const rifle = this.skin.rifle;
    return out.set(0, 0.042, -0.525).applyQuaternion(rifle.quaternion).add(rifle.position);
  }

  fall(direction, velocity) {
    this.age = 0.0001;
    const impulse = this.temp.copy(direction).multiplyScalar(2.7).addScaledVector(velocity, 0.65);
    impulse.y += 0.65;
    this.dropPoint.copy(this.skin.rifle.position);
    this.dropVelocity.copy(impulse).multiplyScalar(.61).addScaledVector(this.front, .45);
    this.dropRotation.copy(this.skin.rifle.quaternion);
    const yaw = Math.atan2(-this.front.x, -this.front.z) + .55;
    this.footRotation.set(0, yaw, Math.PI * .48, 'YXZ');
    this.restRotation.setFromEuler(this.footRotation);
    this.rifleSettled = false;
    for (let index = 0; index < this.joints.length; index += 1) {
      this.previous[index].copy(this.joints[index]).addScaledVector(impulse, -1 / 120);
    }
    const links = [
      [PELVIS, NECK], [NECK, HEAD], [PELVIS, LEFT_HIP], [PELVIS, RIGHT_HIP], [LEFT_HIP, RIGHT_HIP],
      [LEFT_HIP, NECK], [RIGHT_HIP, NECK],
      [LEFT_HIP, LEFT_KNEE], [LEFT_KNEE, LEFT_FOOT], [RIGHT_HIP, RIGHT_KNEE], [RIGHT_KNEE, RIGHT_FOOT],
      [NECK, LEFT_SHOULDER], [NECK, RIGHT_SHOULDER], [LEFT_SHOULDER, RIGHT_SHOULDER],
      [PELVIS, LEFT_SHOULDER], [PELVIS, RIGHT_SHOULDER],
      [LEFT_SHOULDER, LEFT_ELBOW], [LEFT_ELBOW, LEFT_HAND],
      [RIGHT_SHOULDER, RIGHT_ELBOW], [RIGHT_ELBOW, RIGHT_HAND],
    ];
    this.constraints = links.map(([first, second]) => [first, second, this.joints[first].distanceTo(this.joints[second])]);
    this.limits = [
      [LEFT_HIP, LEFT_FOOT, 0.29, 0.875], [RIGHT_HIP, RIGHT_FOOT, 0.29, 0.875],
      [LEFT_SHOULDER, LEFT_HAND, 0.14, 0.537], [RIGHT_SHOULDER, RIGHT_HAND, 0.14, 0.537],
      [LEFT_HIP, RIGHT_KNEE, 0.2, 0.72], [RIGHT_HIP, LEFT_KNEE, 0.2, 0.72],
    ];
  }

  solveDistance(first, second, min, max = min) {
    const a = this.joints[first];
    const b = this.joints[second];
    const difference = this.temp.subVectors(b, a);
    const length = difference.length();
    if (length < 1e-7 || (length >= min && length <= max)) return;
    difference.multiplyScalar((length - MathUtils.clamp(length, min, max)) / (length * 2));
    a.add(difference);
    b.sub(difference);
  }

  tumbleRifle(physics, dt) {
    this.dropRotation.slerp(this.restRotation, 1 - Math.exp(-dt * (this.rifleSettled ? 19 : 6.8)));
    if (this.rifleSettled) return;
    this.dropVelocity.y -= dt * 11;
    this.dropTravel.copy(this.dropVelocity).multiplyScalar(dt);
    const hit = physics.sphereCast(this.dropPoint, this.dropTravel, .088);
    this.dropPoint.addScaledVector(this.dropTravel, hit ? hit.fraction : 1);
    if (!hit) return;
    this.dropPoint.addScaledVector(hit.normal, .002);
    this.dropVelocity.addScaledVector(hit.normal, -1.25 * Math.min(0, this.dropVelocity.dot(hit.normal))).multiplyScalar(.48);
    if (hit.normal.y > .6 && this.dropVelocity.lengthSq() < .21) this.rifleSettled = true;
  }

  resolveTorsoContact(physics) {
    const joints = this.joints;
    const pelvis = joints[PELVIS], neck = joints[NECK];
    this.bodyUp.subVectors(neck, pelvis).normalize();
    this.bodyBack.subVectors(joints[RIGHT_SHOULDER], joints[LEFT_SHOULDER]).cross(this.bodyUp).normalize();
    for (const [height, depth, radius] of TORSO_CONTACTS) {
      const base = this.groundPoint.lerpVectors(pelvis, neck, height)
        .addScaledVector(this.bodyBack, depth).addScaledVector(DOWN, radius);
      const hit = physics.overlapCapsule(base, radius, radius * 2);
      if (!hit) continue;
      for (const index of TORSO_JOINTS) joints[index].addScaledVector(hit.normal, (hit.depth + .001) * .78);
    }
  }

  tumble(physics, dt) {
    this.age += dt;
    if (this.age > 5.5) {
      this.group.visible = false;
      return;
    }
    if (this.age > 2.3) return;
    this.tumbleRifle(physics, dt);
    for (let index = 0; index < this.joints.length; index += 1) {
      const point = this.joints[index];
      const old = this.previous[index];
      const movement = this.temp.subVectors(point, old).multiplyScalar(0.985);
      old.copy(point);
      movement.y -= 12 * dt * dt;
      const radius = RAGDOLL_RADII[index];
      const hit = physics.sphereCast(point, movement, radius);
      point.addScaledVector(movement, hit ? hit.fraction : 1);
      if (hit) {
        point.addScaledVector(hit.normal, 0.004);
        old.lerp(point, 0.58);
      }
    }
    for (let iteration = 0; iteration < 5; iteration += 1) {
      for (const [a, b, length] of this.constraints) this.solveDistance(a, b, length);
      for (const [a, b, min, max] of this.limits) this.solveDistance(a, b, min, max);
      this.resolveTorsoContact(physics);
      for (let index = 0; index < this.joints.length; index += 1) {
        const point = this.joints[index];
        const radius = RAGDOLL_RADII[index];
        const base = this.groundPoint.copy(point).addScaledVector(DOWN, radius);
        const overlap = physics.overlapCapsule(base, radius, radius * 2);
        if (overlap) point.addScaledVector(overlap.normal, overlap.depth + 0.001);
      }
    }
    this.applyPose(true);
  }

  dispose() {
    for (const part of this.geometry) {
      part.near.dispose();
      part.far.dispose();
    }
    this.cloth.dispose();
    this.fabric.map.dispose();
    this.fabric.dispose();
    this.metal.dispose();
    this.group.removeFromParent();
  }
}
