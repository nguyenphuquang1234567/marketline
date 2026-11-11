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
import { SoldierAnimator } from './soldier-animator.js';

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

function magazineParts(gun) {
  gun.box(0.046, 0.092, 0.066, 0, -0.068, -0.096, '#363931', 0.005);
  gun.box(0.046, 0.072, 0.064, 0, -0.132, -0.108, '#2e312a', 0.005);
  gun.box(0.050, 0.016, 0.070, 0, -0.168, -0.112, '#1c201f', 0.003);
}

function makeRifle(group, detail, metal, loaded = true) {
  const gun = parts(detail);
  // Upper and lower receiver with flared magwell, trigger guard, and brass deflector.
  gun.box(0.062, 0.056, 0.215, 0, 0.048, -0.038, '#2b302f', 0.006);
  gun.box(0.058, 0.046, 0.195, 0, 0.004, -0.025, '#202423', 0.005);
  gun.box(0.062, 0.058, 0.078, 0, -0.026, -0.095, '#262a29', 0.005);
  gun.box(0.066, 0.012, 0.084, 0, -0.052, -0.095, '#353a38', 0.002);
  gun.box(0.018, 0.008, 0.052, 0, -0.052, 0.002, '#1c201f', 0.002);
  gun.box(0.008, 0.022, 0.010, 0, -0.036, 0.010, '#474d4b', 0.001);

  // Free-float M-LOK handguard and barrel shroud.
  gun.box(0.054, 0.066, 0.255, 0, 0.044, -0.268, '#3d413b', 0.007);
  gun.box(0.038, 0.022, 0.248, 0, 0.012, -0.266, '#282c29', 0.004);
  // Angled foregrip (AFG) and rail covers.
  gun.box(0.042, 0.032, 0.092, 0, -0.002, -0.248, '#232623', 0.004);
  gun.box(0.036, 0.022, 0.034, 0, -0.016, -0.282, '#1b1e1c', 0.003);

  // Top picatinny rail and backup iron sights.
  gun.box(0.044, 0.012, 0.445, 0, 0.080, -0.165, '#1e2221', 0.002);
  gun.box(0.036, 0.022, 0.024, 0, 0.092, 0.042, '#252928', 0.002);
  gun.box(0.034, 0.024, 0.022, 0, 0.092, -0.372, '#252928', 0.002);

  // Pistol grip and curved 30-round STANAG/polymer magazine with Magpul floorplate.
  gun.box(0.042, 0.088, 0.054, 0, -0.048, 0.044, '#232521', 0.006);
  gun.box(0.044, 0.016, 0.058, 0, -0.090, 0.048, '#181a18', 0.003);
  if (loaded) magazineParts(gun);

  // Buffer tube and SOPMOD collapsible buttstock with cheek rest and rubber pad.
  gun.cylinder(0.018, 0.018, 0.165, 0, 0.038, 0.145, '#252928', true);
  gun.box(0.048, 0.048, 0.145, 0, 0.034, 0.162, '#363933', 0.006);
  gun.box(0.044, 0.112, 0.048, 0, 0.012, 0.214, '#292c28', 0.005);
  gun.box(0.048, 0.116, 0.018, 0, 0.010, 0.242, '#171918', 0.004);

  // Barrel, gas block, and multi-prong flash suppressor.
  gun.cylinder(0.011, 0.011, 0.155, 0, 0.042, -0.435, '#202526', true);
  gun.box(0.024, 0.032, 0.028, 0, 0.050, -0.398, '#2d3231', 0.003);
  gun.cylinder(0.015, 0.014, 0.048, 0, 0.042, -0.502, '#3c4240', true);

  // Riser mount and red-dot combat optic.
  gun.box(0.046, 0.024, 0.078, 0, 0.094, -0.058, '#202423', 0.003);
  gun.cylinder(0.022, 0.022, 0.082, 0, 0.122, -0.058, '#313835', true);
  gun.cylinder(0.018, 0.018, 0.003, 0, 0.122, -0.100, '#4f8280', true);
  gun.cylinder(0.018, 0.018, 0.003, 0, 0.122, -0.016, '#2b4747', true);

  if (detail) {
    // Top-mounted AN/PEQ-15 tactical laser module and handguard Picatinny/M-LOK slots.
    gun.box(0.048, 0.022, 0.068, 0, 0.094, -0.285, '#4a473b', 0.003);
    gun.cylinder(0.006, 0.006, 0.014, 0.012, 0.095, -0.322, '#1b1f1e', true);
    gun.box(0.010, 0.018, 0.056, 0.031, 0.048, -0.032, '#141717', 0.001);
    for (let index = 0; index < 8; index += 1) {
      const z = -0.135 - index * 0.030;
      gun.box(0.048, 0.006, 0.012, 0, 0.086, z, '#555952', 0);
      for (const side of [-1, 1]) {
        gun.box(0.003, 0.014, 0.020, side * 0.027, 0.044, z, '#1b1e1d', 0);
      }
    }
  }
  return gun.mesh(group, metal);
}

function makeOperative(group, index, team, detail, clothMaterial, fabric, metal) {
  const [cloth, vest, gear, boot] = PALETTES[index];
  const insignia = team === 0 ? '#458bb3' : '#bc5343';
  const edging = team === 0 ? '#2e536b' : '#753e35';
  const trouserColor = new Color(cloth).lerp(new Color(vest), 0.48).lerp(new Color(boot), 0.22).getHex();
  const torso = parts(detail);
  torso.garment([
    [-.098, .096, .058], [-.076, .136, .080], [-.042, .154, .094], [.018, .156, .098],
    [.072, .142, .092], [.135, .144, .096], [.215, .154, .104], [.315, .172, .115],
    [.405, .178, .112], [.455, .164, .102], [.488, .122, .082], [.518, .070, .068],
    [.569, .058, .060],
  ], cloth, index, { minY: -0.12, maxY: 0.058, color: trouserColor });
  // Structured combat shirt collar and quarter-zip placket.
  torso.garment([
    [.482, .080, .078], [.512, .075, .074], [.548, .069, .068], [.580, .064, .065], [.592, .059, .062],
  ], vest, index + 4);
  if (detail) {
    torso.box(0.016, 0.095, 0.012, 0, 0.515, -0.072, boot, 0.002);
  }
  addKit(torso, { detail, index, team, cloth, vest, gear, boot, insignia, edging });

  const head = parts(detail);
  buildHead(head, { detail, index, team, cloth, vest, gear, boot, insignia, edging });

  const limbs = [];
  for (const side of [-1, 1]) {
    const shoe = parts(detail);
    const shoeSections = [
      [-.216, .029, -.075, -.044], [-.202, .051, -.079, -.026], [-.168, .062, -.078, -.002],
      [-.114, .063, -.078, .028], [-.068, .058, -.078, .066], [-.020, .055, -.078, .092],
      [.028, .056, -.078, .088], [.054, .053, -.078, .062], [.068, .035, -.075, .022],
    ];
    shoe.geometry(bootLoft(shoeSections, detail ? 16 : 10), boot);
    const tread = shoeSections.map(([z, width]) => [z * 1.025, width * 1.06, -.086, -.058]);
    shoe.geometry(bootLoft(tread, detail ? 16 : 10), '#242520');
    // Molded toe cap, heel counter, and ankle cuff reinforcement.
    shoe.box(.084, .032, .058, 0, -.052, -.182, '#1d1e1a', .008);
    shoe.box(.082, .056, .048, 0, -.036, .042, '#1d1e1a', .008);
    if (detail) {
      for (let lace = 0; lace < 5; lace++) {
        shoe.box(.060 - lace * .003, .007, .010, 0, .052 - lace * .011, -.072 - lace * .014, '#5c584b', .002);
      }
      for (const edge of [-1, 1]) {
        shoe.box(.008, .036, .112, edge * .054, -.028, -.052, gear, .003);
      }
    }
    const glove = parts(detail);
    glove.garment([
      [-.052, .022, .034, .001], [-.035, .033, .045, -.008], [-.006, .038, .046, -.011],
      [.024, .037, .045, -.012], [.038, .029, .038, -.005], [.048, .020, .028, -.002],
    ], boot, index + side);
    // Molded knuckle armor plate and thumb support.
    glove.box(.064, .018, .042, 0, .022, -.012, gear, .005);
    glove.round(.036, .058, .060, side * -.028, .006, -.022, gear);
    if (detail) {
      for (let knuckle = 0; knuckle < 4; knuckle++) {
        const kx = -.025 + knuckle * .0165;
        const ky = .021 - Math.abs(knuckle - 1.5) * .0035;
        glove.round(.019, .022, .026, kx, ky, -.044, '#1b1d1a');
        glove.round(.016, .018, .028, kx, ky - .012, -.058, boot);
      }
    }
    limbs.push({ shoe: shoe.mesh(group, clothMaterial), glove: glove.mesh(group, clothMaterial) });
  }
  const uniform = new OperativeUniform(group, detail, index, fabric, cloth, insignia, vest, gear, boot);
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
  const size = 128, rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const crossing = ((x >> 2) + (y >> 2)) % 2;
      const ripstop = x % 16 === 0 || y % 16 === 0 ? 5 : 0;
      const warp = Math.cos(x * Math.PI * .5), weft = Math.cos(y * Math.PI * .5);
      const fibre = Math.imul(x + 53, y + 97) % 13 - 6;
      const shade = Math.min(255, Math.max(196, 234 + 7 * (crossing ? warp + weft * .42 : weft + warp * .42) + ripstop + fibre));
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
  return new MeshStandardMaterial({ vertexColors: true, roughness: .89, map: texture, bumpMap: texture, bumpScale: .011 });
}

export class BotRig {
  constructor(group, index, team, soldier) {
    this.group = group;
    this.metal = new MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.38 });
    this.soldier = soldier ? new SoldierAnimator(soldier, group) : null;
    this.shoeRotations = [new Quaternion(), new Quaternion()];
    if (this.soldier) {
      const rifle = makeRifle(group, true, this.metal, false);
      const magazine = parts(false);
      magazineParts(magazine);
      this.skin = { rifle, magazine: magazine.mesh(group, this.metal) };
      this.geometry = [{ mesh: rifle, near: rifle.geometry, far: makeRifle(null, false, this.metal, false).geometry }];
      this.presentation = new BotPresentation([...this.geometry, { mesh: this.skin.magazine }, ...this.soldier.parts]);
    } else {
      this.fabric = wovenFabric();
      this.cloth = new MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.84,
        map: this.fabric.map,
        bumpMap: this.fabric.map,
        bumpScale: 0.0065,
      });
      this.skin = makeOperative(group, index, team, true, this.cloth, this.fabric, this.metal);
      const lowerDetail = makeOperative(null, index, team, false, this.cloth, this.fabric, this.metal);
      this.uniforms = [this.skin.uniform, lowerDetail.uniform];
      const skinnedMeshes = skin => [skin.torso, skin.head, skin.rifle, skin.uniform.mesh, ...skin.limbs.flatMap(Object.values)];
      const lowMeshes = skinnedMeshes(lowerDetail);
      this.geometry = skinnedMeshes(this.skin).map((mesh, part) => ({
        mesh, near: mesh.geometry, far: lowMeshes[part].geometry,
      }));
      this.presentation = new BotPresentation(this.geometry, this.skin.uniform.mesh);
    }
    this.distant = false;
    this.joints = Array.from({ length: 15 }, () => new Vector3());
    this.previous = this.joints.map(() => new Vector3());
    this.constraints = [];
    this.limits = [];
    this.gait = new BotGait(index);
    this.feet = this.gait.feet;
    this.ready = false;
    this.bodyYaw = this.chestYaw = this.lookYaw = this.stepYaw = 0;
    this.crouchPose = this.headScan = this.reloadPose = this.carry = 0;
    this.reloadDuration = 0;
    this.pelvisHeight = .928;
    this.pelvisShift = 0;
    this.bodyBob = 0;
    this.travelLean = new Vector3();
    this.previousVelocity = new Vector3();
    this.acceleration = new Vector3();
    this.chestSide = new Vector3();
    this.chestFront = new Vector3();
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

  updatePosture(bot, physics, dt, speed, drive, crouchTarget, aimReady, reset) {
    const approach = (rate) => 1 - Math.exp(-dt * rate);
    const targetTravel = speed > .21 ? Math.atan2(-bot.velocity.x, -bot.velocity.z) : bot.yaw;
    const travelInfluence = MathUtils.smoothstep(speed, .35, 2.45) * (1 - aimReady * .49);
    const plannedYaw = bot.yaw + MathUtils.clamp(angleDelta(targetTravel, bot.yaw), -.72, .72) * travelInfluence;
    if (reset) {
      this.bodyYaw = this.chestYaw = this.lookYaw = bot.yaw;
      this.stepYaw = plannedYaw;
      this.crouchPose = crouchTarget;
      this.readyWeapon = aimReady;
      this.reloadPose = this.reloadDuration = this.carry = 0;
      this.pelvisShift = this.bodyBob = this.headScan = 0;
      this.previousVelocity.copy(bot.velocity);
      this.acceleration.set(0, 0, 0);
      this.travelLean.set(bot.velocity.x * .026, 0, bot.velocity.z * .026);
      this.gait.reset(bot, physics, this.stepYaw, this.readyWeapon, this.crouchPose);
    } else {
      this.lookYaw += angleDelta(bot.yaw, this.lookYaw) * approach(26);
      this.stepYaw += angleDelta(plannedYaw, this.stepYaw) * approach(16);
      this.crouchPose += (crouchTarget - this.crouchPose) * approach(13);
      this.readyWeapon += (aimReady - this.readyWeapon) * approach(10);
    }
    const crouch = this.crouchPose;
    this.gait.update(dt, bot, physics, this.stepYaw, this.readyWeapon, crouch, speed);
    this.pelvisShift += (this.gait.shift - this.pelvisShift) * approach(16);
    this.bodyBob += (this.gait.lift - this.bodyBob) * approach(22);

    const leftYaw = this.feet[0].yaw - .095;
    const stanceYaw = leftYaw + .5 * angleDelta(this.feet[1].yaw + .095, leftYaw);
    const stanceLag = MathUtils.clamp(angleDelta(this.stepYaw, stanceYaw), -.76, .76) * (.67 - drive * .38);
    const hipTarget = this.stepYaw - stanceLag + this.pelvisShift * 2.55;
    this.bodyYaw += angleDelta(hipTarget, this.bodyYaw) * approach(9.5 + drive * 3);
    const chestTarget = this.bodyYaw + angleDelta(this.lookYaw, this.bodyYaw) * (.56 + this.readyWeapon * .36)
      - this.pelvisShift * (2.8 - this.readyWeapon * 1.1);
    this.chestYaw += angleDelta(chestTarget, this.chestYaw) * approach(13);
    this.side.set(Math.cos(this.bodyYaw), 0, -Math.sin(this.bodyYaw));
    this.front.set(-Math.sin(this.bodyYaw), 0, -Math.cos(this.bodyYaw));
    this.chestSide.set(Math.cos(this.chestYaw), 0, -Math.sin(this.chestYaw));
    this.chestFront.set(-Math.sin(this.chestYaw), 0, -Math.cos(this.chestYaw));

    this.temp.subVectors(bot.velocity, this.previousVelocity).setY(0).multiplyScalar(1 / Math.max(dt, .001)).clampLength(0, 22);
    this.acceleration.lerp(this.temp, approach(13));
    this.previousVelocity.copy(bot.velocity);
    this.temp.set(bot.velocity.x * .032, 0, bot.velocity.z * .032)
      .addScaledVector(this.acceleration, .0046).clampLength(0, .205);
    this.travelLean.lerp(this.temp, approach(11));
    const carry = (1 - aimReady) * MathUtils.smoothstep(speed, 1.2, 3.75) * (1 - crouch * .45);
    this.carry += (carry - this.carry) * approach(8);
  }

  pose(bot, physics, dt) {
    this.group.visible = true;
    const reset = !this.ready;
    if (this.soldier) {
      const contact = this.soldier.pose(bot, physics, dt, reset);
      this.soldier.syncWeapon(this.skin.rifle, this.skin.magazine);
      this.front.set(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
      this.ready = true;
      this.presentation.save(reset);
      return contact;
    }
    const joints = this.joints;
    const speed = Math.hypot(bot.velocity.x, bot.velocity.z);
    const drive = MathUtils.clamp(speed / 4.6, 0, 1);
    const crouchTarget = MathUtils.clamp((1.77 - bot.height) / .61, 0, 1);
    const aimReady = bot.visibleTarget || bot.state === 'engage' ? 1 : bot.state === 'cover' ? .66 : .28;
    this.updatePosture(bot, physics, dt, speed, drive, crouchTarget, aimReady, reset);
    const crouch = this.crouchPose;
    const height = .928 - .315 * crouch - .055 * drive + this.bodyBob;
    const pelvis = joints[PELVIS];
    this.place(pelvis, bot, this.pelvisShift, height, .015 - crouch * .082);
    let reachHeight = height, anticipatedHeight = height;
    for (let i = 0; i < 2; i++) {
      const state = this.feet[i];
      const foot = state.position;
      const side = i ? .108 : -.108;
      const dx = pelvis.x + side * this.side.x - foot.x;
      const dz = pelvis.z + side * this.side.z - foot.z;
      const rise = Math.sqrt(Math.max(.10, .874 ** 2 - dx * dx - dz * dz));
      reachHeight = Math.min(reachHeight, foot.y - bot.position.y + rise);
      if (!state.swinging) {
        const forwardX = dx + bot.velocity.x * .046;
        const forwardZ = dz + bot.velocity.z * .046;
        const forecast = Math.sqrt(Math.max(.10, .874 ** 2 - forwardX ** 2 - forwardZ ** 2));
        anticipatedHeight = Math.min(anticipatedHeight, foot.y - bot.position.y + forecast + .018);
      }
    }
    const targetHeight = Math.min(reachHeight, anticipatedHeight);
    if (reset) this.pelvisHeight = targetHeight;
    else this.pelvisHeight += (targetHeight - this.pelvisHeight) * (1 - Math.exp(-dt * (targetHeight < this.pelvisHeight ? 25 : 16)));
    pelvis.y = bot.position.y + Math.min(this.pelvisHeight, reachHeight + .010);

    const breathing = Math.sin(bot.clock * 3.3) * (.0065 - drive * .0035);
    const neck = joints[NECK];
    neck.copy(pelvis).addScaledVector(UP, .557 - .177 * crouch + breathing)
      .addScaledVector(this.chestFront, .008 + crouch * .252)
      .addScaledVector(this.chestSide, -this.pelvisShift * 1.44).add(this.travelLean);
    this.bodyUp.subVectors(neck, pelvis).normalize();
    this.bodyBack.crossVectors(this.chestSide, this.bodyUp).normalize();
    this.chestSide.crossVectors(this.bodyUp, this.bodyBack).normalize();
    this.chestFront.copy(this.bodyBack).negate();
    joints[HEAD].copy(neck).addScaledVector(this.bodyUp, .064).addScaledVector(UP, .088)
      .addScaledVector(this.chestFront, .028).addScaledVector(this.chestSide, this.readyWeapon * .014);

    for (let index = 0; index < 2; index++) {
      const side = index ? 1 : -1;
      const hip = joints[index ? RIGHT_HIP : LEFT_HIP];
      const knee = joints[index ? RIGHT_KNEE : LEFT_KNEE];
      const foot = joints[index ? RIGHT_FOOT : LEFT_FOOT];
      hip.copy(pelvis).addScaledVector(this.side, side * .108);
      foot.copy(this.feet[index].position);
      const footTurn = MathUtils.clamp(angleDelta(this.feet[index].yaw, this.bodyYaw), -.78, .78);
      const kneeYaw = this.bodyYaw + footTurn * .58 - side * (.06 + crouch * .24);
      this.temp.set(-Math.sin(kneeYaw), crouch * .14, -Math.cos(kneeYaw));
      this.midJoint(knee, hip, foot, this.temp, .455, .432);
    }

    if (bot.reloading) this.reloadDuration = Math.max(this.reloadDuration, bot.reloading);
    else if (this.reloadPose < .01) this.reloadDuration = 0;
    const reloadTarget = MathUtils.clamp(bot.reloading / .24 || 0, 0, 1);
    this.reloadPose += (reloadTarget - this.reloadPose) * (1 - Math.exp(-dt * 14));
    const lookToAim = angleDelta(bot.yaw, this.chestYaw);
    const rifleYaw = this.chestYaw + lookToAim * this.readyWeapon + this.carry * .23 - this.pelvisShift * .65;
    this.aim.setFromAxisAngle(UP, rifleYaw);
    const riflePitch = bot.pitch + bot.kick * .068 - (1 - this.readyWeapon) * .17 - this.carry * .47 - this.reloadPose * .17;
    this.pitch.setFromAxisAngle(this.temp.set(1, 0, 0), riflePitch);
    this.aim.multiply(this.pitch);
    this.pitch.setFromAxisAngle(this.temp.set(0, 0, 1), -this.reloadPose * .36 - this.carry * .26);
    this.aim.multiply(this.pitch);

    const wantedScan = bot.visibleTarget ? 0 : Math.sin(bot.clock * 2.4 + (bot.phase || 0)) * (.10 + drive * .03);
    this.headScan += (wantedScan - this.headScan) * (1 - Math.exp(-dt * 10));
    const faceYaw = this.chestYaw + MathUtils.clamp(angleDelta(this.lookYaw + this.headScan, this.chestYaw), -.87, .87);
    this.headAim.setFromAxisAngle(UP, faceYaw);
    this.pitch.setFromAxisAngle(this.temp.set(1, 0, 0), MathUtils.clamp(bot.pitch * .72 + crouch * .06, -.28, .36) + breathing);
    this.headAim.multiply(this.pitch);
    this.pitch.setFromAxisAngle(this.temp.set(0, 0, 1), -(this.readyWeapon - .35) * .07 + this.pelvisShift * .48);
    this.headAim.multiply(this.pitch);

    joints[RIGHT_HAND].copy(neck)
      .addScaledVector(this.chestSide, .142 - this.carry * .034)
      .addScaledVector(this.bodyUp, -.25 + this.readyWeapon * .122 - this.reloadPose * .103 - this.carry * .062)
      .addScaledVector(this.chestFront, .205 - bot.kick * .032 - this.carry * .032);
    const reloadPhase = this.reloadDuration > 0 ? MathUtils.clamp(1 - (bot.reloading / this.reloadDuration || 0), 0, 1) : 0;
    const reloadTravel = Math.sin(Math.PI * reloadPhase);
    const magPouchDip = Math.sin(Math.PI * MathUtils.clamp(reloadPhase * 1.6, 0, 1));
    this.temp.set(
      MathUtils.lerp(-.034, -.026 - magPouchDip * .035, this.reloadPose),
      MathUtils.lerp(.012, -.096 - reloadTravel * .058, this.reloadPose),
      MathUtils.lerp(-.278, -.092 + magPouchDip * .045, this.reloadPose),
    ).applyQuaternion(this.aim);
    joints[LEFT_HAND].copy(joints[RIGHT_HAND]).add(this.temp);

    for (let index = 0; index < 2; index++) {
      const side = index ? 1 : -1;
      const shoulder = joints[index ? RIGHT_SHOULDER : LEFT_SHOULDER];
      const elbow = joints[index ? RIGHT_ELBOW : LEFT_ELBOW];
      const hand = joints[index ? RIGHT_HAND : LEFT_HAND];
      shoulder.copy(neck).addScaledVector(this.chestSide, side * .168)
        .addScaledVector(this.chestFront, side * (-.045 * this.readyWeapon + this.pelvisShift * .22))
        .addScaledVector(this.bodyUp, -.098 - (index ? .008 * this.readyWeapon : 0));
      this.temp.copy(this.chestSide).multiplyScalar(side * (index ? .31 : .26))
        .addScaledVector(this.chestFront, index ? -.14 - this.carry * .17 : .08)
        .addScaledVector(this.bodyUp, index ? -.88 : -.92);
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
    this.bodyBack.crossVectors(fallen ? this.side : this.chestSide, this.bodyUp).normalize();
    this.bodySide.crossVectors(this.bodyUp, this.bodyBack).normalize();
    this.basis.makeBasis(this.bodySide, this.bodyUp, this.bodyBack);
    this.bodyRotation.setFromRotationMatrix(this.basis);
    if (fallen) this.front.copy(this.bodyBack).negate();
    const head = fallen ? this.bodyRotation : this.headAim;
    skin.rifle.position.copy(fallen ? this.dropPoint : joints[RIGHT_HAND]);
    skin.rifle.quaternion.copy(fallen ? this.dropRotation : this.aim);
    for (let index = 0; index < 2; index++) {
      const knee = joints[index ? RIGHT_KNEE : LEFT_KNEE];
      const foot = joints[index ? RIGHT_FOOT : LEFT_FOOT];
      const rotation = this.shoeRotations[index];
      if (fallen) {
        this.orient(rotation, knee, foot, this.front);
      } else {
        const { roll, yaw } = this.feet[index];
        rotation.setFromEuler(this.footRotation.set(roll, yaw, 0, 'YXZ'));
      }
    }
    skin.torso.position.copy(joints[PELVIS]);
    skin.torso.quaternion.copy(this.bodyRotation);
    skin.torso.scale.y = MathUtils.clamp(joints[PELVIS].distanceTo(joints[NECK]) / 0.545, 0.80, 1.08);
    skin.head.position.copy(joints[HEAD]);
    skin.head.quaternion.copy(head);
    this.uniforms[Number(this.distant)].deform(joints, this.side, this.front, skin.uniform.mesh);
    for (let index = 0; index < 2; index += 1) {
      const limb = skin.limbs[index];
      limb.shoe.position.copy(joints[index ? RIGHT_FOOT : LEFT_FOOT]);
      limb.shoe.quaternion.copy(this.shoeRotations[index]);

      const elbow = joints[index ? RIGHT_ELBOW : LEFT_ELBOW];
      const hand = joints[index ? RIGHT_HAND : LEFT_HAND];
      limb.glove.position.copy(hand);
      if (fallen) this.orient(limb.glove.quaternion, elbow, hand, this.front);
      else limb.glove.quaternion.copy(this.aim);
    }
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
    this.dropVelocity.copy(impulse).multiplyScalar(.61).addScaledVector(this.front, .68);
    this.dropRotation.copy(this.skin.rifle.quaternion);
    const yaw = Math.atan2(-this.front.x, -this.front.z) + .55;
    this.footRotation.set(0, yaw, Math.PI * .48, 'YXZ');
    this.restRotation.setFromEuler(this.footRotation);
    this.rifleSettled = false;
    if (this.soldier) {
      this.soldier.fall(direction);
      this.magazineDroppedWithRifle = this.soldier.reloadPhase < .25 || this.soldier.reloadPhase > .78;
      return;
    }
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
    // Let a released rifle clear the hands before the stock turns toward the floor.
    if (!this.soldier || this.age > .075) {
      this.dropRotation.slerp(this.restRotation, 1 - Math.exp(-dt * (this.rifleSettled ? 19 : 6.8)));
    }
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
    if (this.soldier) {
      const release = !this.soldier.fallClip;
      this.soldier.tumble(physics, this.age, dt);
      if (release) {
        // Let the rifle land ahead of the legs. A wall turns the drop along
        // its face so the weapon does not rebound into the seated body.
        const yaw = this.soldier.fallYaw + this.soldier.coverTurn;
        const forward = this.temp.set(0, 0, -1).applyAxisAngle(UP, yaw);
        this.dropVelocity.addScaledVector(forward, Math.max(0, 2.1 - this.dropVelocity.dot(forward)));
        if (this.soldier.coverWall) {
          const normal = this.soldier.coverNormal;
          this.dropVelocity.addScaledVector(normal, .36 - this.dropVelocity.dot(normal));
          this.restRotation.setFromEuler(this.footRotation.set(0, yaw + .12, Math.PI * .48, 'YXZ'));
        }
      }
      this.tumbleRifle(physics, dt);
      this.skin.rifle.position.copy(this.dropPoint);
      this.skin.rifle.quaternion.copy(this.dropRotation);
      this.skin.magazine.position.copy(this.dropPoint);
      this.skin.magazine.quaternion.copy(this.dropRotation);
      this.skin.magazine.scale.setScalar(this.magazineDroppedWithRifle ? 1 : .002);
      return;
    }
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
    this.soldier?.dispose();
    this.skin.magazine?.geometry.dispose();
    this.cloth?.dispose();
    this.fabric?.map.dispose();
    this.fabric?.dispose();
    this.metal.dispose();
    this.group.removeFromParent();
  }
}
