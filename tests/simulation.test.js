import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Box3, Group, Scene, Texture, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BotRig } from '../src/bot-rig.js';
import { BotSystem, NavWorld } from '../src/bots.js';
import { CharacterController, StaticBVH } from '../src/physics.js';
import { RigidWorld } from '../src/rigid-world.js';
import { soldierVariants } from '../src/soldier-model.js';

const vector = (x, y, z) => new Vector3(x, y, z);
const box = (min, max, surface = 'concrete') => ({
  min: vector(...min),
  max: vector(...max),
  surface,
});
const advance = (controller, wish, ticks, options = {}) => {
  let peak = controller.position.y;
  for (let index = 0; index < ticks; index += 1) {
    controller.step(1 / 120, { wish, ...options });
    peak = Math.max(peak, controller.position.y);
  }
  return peak;
};

test('BVH returns the nearest material, entry normal, and unclipped exit', () => {
  const plank = box([-1, 0, -3], [1, 3, -2.5], 'wood');
  const distant = box([-2, 0, -7], [2, 3, -5], 'metal');
  const boxes = [plank, distant];
  for (let index = 0; index < 24; index += 1) {
    const x = 3 + index;
    boxes.push(box([x, 0, -9], [x + 0.5, 2, -4]));
  }
  const physics = new StaticBVH(boxes);
  const origin = vector(0, 1, 0);
  const direction = vector(0, 0, -1);
  assert.equal(physics.raycast(origin, direction, 2.49), null);
  const hit = physics.raycast(origin, direction, 2.6);
  assert.equal(hit.distance, 2.5);
  assert.equal(hit.exitDistance, 3);
  assert.equal(hit.surface, 'wood');
  assert.deepEqual(hit.normal.toArray(), [0, 0, 1]);
  assert.equal(physics.raycast(origin, direction, 20, plank).collider, distant);
  assert.equal(physics.segmentCast(origin, vector(0, -1, 0)).surface, 'asphalt');
});

test('sphere sweeps detect thin obstacles from above and below', () => {
  const platform = box([-1, 1, -3], [1, 1.04, -2]);
  const physics = new StaticBVH([platform]);
  const top = physics.sphereCast(vector(0, 2, -2.5), vector(0, -2, 0), 0.2);
  const bottom = physics.sphereCast(vector(0, 0.2, -2.5), vector(0, 2, 0), 0.2);
  assert.ok(Math.abs(top.fraction - 0.38) < 1e-6);
  assert.ok(Math.abs(bottom.fraction - 0.3) < 1e-6);
  assert.equal(top.normal.y, 1);
  assert.equal(bottom.normal.y, -1);
});

test('the controller stops at walls, clears a step, and mantles a low ledge', () => {
  const physics = new StaticBVH([
    box([-1, 0, -3], [1, 3, -2.5]),
    box([-1, 0, 2], [1, 0.25, 3], 'wood'),
    box([2, 0, -3], [4, 0.78, -1], 'wood'),
  ]);
  const controller = new CharacterController(physics, vector(0, 0, 0));
  advance(controller, vector(0, 0, -1), 120, { speed: 13 });
  assert.ok(controller.position.z > -2.183 && controller.position.z < -2.155);
  assert.equal(physics.overlapsCapsule(controller.position, controller.radius, controller.height), false);

  controller.teleport(vector(0, 0, 0));
  assert.ok(advance(controller, vector(0, 0, 1), 120) >= 0.25);
  assert.ok(controller.position.z > 3);
  controller.teleport(vector(3, 0, -0.61));
  controller.step(1 / 120, { wish: vector(0, 0, -1), mantle: true });
  assert.ok(controller.mantleTime > 0);
  advance(controller, vector(0, 0, -1), 37);
  assert.ok(controller.position.y > 0.78);
});

test('navigation routes around a thin wall between adjacent grid cells', () => {
  const physics = new StaticBVH([box([-0.05, 0, -5], [0.05, 3, 1.6])]);
  const nav = new NavWorld(physics, { minX: -5, maxX: 5, minZ: -5, maxZ: 5 });
  const route = nav.route(vector(-3, 0, 0), vector(3, 0, 0));
  const across = route.find((point) => point.x > 0);
  assert.ok(across && across.z > 1.6);
  assert.ok(route.at(-1).x > 2.5);
});

test('bots replay deterministically, respect smoke, and clean up a fallen operative', () => {
  const scene = new Scene();
  const physics = new StaticBVH([box([-1, 0, -3], [1, 3, -2.5])]);
  const world = {
    bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 },
    spawns: [
      [vector(-2, 0, 14), vector(0, 0, 14), vector(1, 0, 14), vector(2, 0, 14)],
      [vector(-2, 0, -14), vector(0, 0, -14), vector(1, 0, -14), vector(2, 0, -14)],
    ],
  };
  const player = { position: world.spawns[0][0].clone(), team: 0, alive: true, height: 1.77 };
  let shots = 0;
  let steps = 0;
  let smoke = false;
  const bots = new BotSystem({
    scene, physics, world, seed: 42,
    onFire: () => { shots += 1; },
    onStep: () => { steps += 1; },
    isObscured: () => smoke,
  });
  function runRound() {
    shots = 0;
    steps = 0;
    bots.reset();
    for (let tick = 1; tick <= 3600; tick += 1) bots.step(1 / 120, player, tick / 120);
    return { shots, steps, positions: bots.bots.map((bot) => bot.position.toArray()) };
  }
  const first = runRound();
  assert.ok(first.shots > 20);
  assert.ok(first.steps > 20);
  assert.deepEqual(runRound(), first);

  smoke = true;
  const operative = bots.bots[3];
  bots.kill(operative, vector(1, 0, 0));
  for (let tick = 3601; tick <= 4320; tick += 1) bots.step(1 / 120, player, tick / 120);
  assert.equal(shots, first.shots);
  assert.equal(operative.alive, false);
  assert.equal(operative.group.visible, false);
  assert.ok(operative.rig.joints.every((joint) => joint.toArray().every(Number.isFinite)));
  bots.respawn(operative, world.spawns[1][0]);
  assert.equal(operative.alive, true);
  assert.equal(operative.group.visible, true);
  bots.dispose();
  assert.equal(scene.children.length, 0);
});


test('operative clothes stay closed while crouching and switching detail', () => {
  const physics = new StaticBVH([]);
  const group = new Group();
  const rig = new BotRig(group, 3, 1);
  const bot = {
    position: vector(0, 0, 0), velocity: vector(0, 0, 0), height: 1.77, controller: { grounded: true },
    yaw: 0, pitch: 0, kick: 0, clock: 0, state: 'engage', visibleTarget: true,
  };
  rig.pose(bot, physics, 1 / 60);
  const standing = new Box3().setFromObject(group, true);
  assert.ok(standing.max.y > 1.74 && standing.max.y < 1.81);

  bot.height = 1.16;
  for (let tick = 0; tick < 28; tick++) rig.pose(bot, physics, 1 / 60);
  for (const distance of [100, 40 ** 2]) {
    rig.setDetail(distance);
    rig.pose(bot, physics, 1 / 60);
    const geometry = rig.skin.uniform.mesh.geometry;
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    assert.ok(position.array.every(Number.isFinite) && normal.array.every(Number.isFinite));
    const faces = geometry.index.array;
    const unique = new Map();
    const welded = [];
    for (let i = 0; i < position.count; i++) {
      const key = [position.getX(i), position.getY(i), position.getZ(i)]
        .map(value => Math.round(value * 1e6)).join('/');
      if (!unique.has(key)) unique.set(key, unique.size);
      welded[i] = unique.get(key);
    }
    const edges = new Map();
    for (let i = 0; i < faces.length; i += 3) {
      const face = [welded[faces[i]], welded[faces[i + 1]], welded[faces[i + 2]]];
      assert.equal(new Set(face).size, 3);
      for (let edge = 0; edge < 3; edge++) {
        const a = face[edge], b = face[(edge + 1) % 3];
        const key = Math.min(a, b) + '/' + Math.max(a, b);
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    assert.ok([...edges.values()].every(uses => uses === 2));
    const crouching = new Box3().setFromObject(group, true);
    assert.ok(crouching.max.y < standing.max.y - .49);
  }

  rig.fall(vector(1, 0, .15), vector(.7, 0, 0));
  for (let i = 0; i < 258; i++) rig.tumble(physics, 1 / 120);
  assert.ok(rig.skin.rifle.position.distanceTo(rig.joints[14]) > .13);
  assert.ok(new Box3().setFromObject(group, true).min.y > -.09);
  rig.dispose();
});

test('a running bot brakes at a wall and pivots with planted feet', () => {
  const physics = new StaticBVH([box([-4, 0, -2.7], [4, 3, -2.45])]);
  const controller = new CharacterController(physics, vector(0, 0, 0));
  const rig = new BotRig(new Group(), 3, 1);
  const bot = {
    position: controller.position, velocity: controller.velocity, height: controller.height, controller,
    yaw: 0, pitch: 0, kick: 0, clock: 0, state: 'engage', visibleTarget: true,
  };
  rig.pose(bot, physics, 1 / 60);
  const previous = rig.feet.map(foot => ({ point: foot.position.clone(), yaw: foot.yaw, swinging: foot.swinging }));
  const wish = vector(0, 0, -1);
  let stopSteps = 0;
  let pivotSteps = 0;
  let contactFrames = 0;
  for (let tick = 1; tick <= 288; tick++) {
    bot.clock = tick / 120;
    if (tick >= 150) {
      wish.set(0, 0, 0);
      bot.yaw = Math.min(Math.PI / 2, (tick - 150) / 120 * 4);
    }
    controller.step(1 / 120, { wish, speed: 4.22 });
    bot.height = controller.height;
    if (tick % 2) continue;
    const headBefore = rig.skin.head.position.clone();
    const contact = rig.pose(bot, physics, 1 / 60);
    if (contact) {
      assert.equal(contact, 'asphalt');
      if (tick < 150) stopSteps++;
      else pivotSteps++;
    }
    for (let i = 0; i < 2; i++) {
      const foot = rig.feet[i];
      const sample = previous[i];
      const stride = sample.point.distanceTo(foot.position);
      assert.ok(stride < .3, 'a swing advances continuously through the wall stop');
      if (!sample.swinging && !foot.swinging) {
        contactFrames++;
        assert.ok(stride < 1e-7, 'a planted foot keeps its world position');
        assert.equal(foot.yaw, sample.yaw, 'a planted shoe holds its orientation');
      }
      const reach = rig.joints[i ? 6 : 3].distanceTo(rig.joints[i ? 8 : 5]);
      assert.ok(reach < .92, 'the pelvis compensates before the leg overextends');
      sample.point.copy(foot.position);
      sample.yaw = foot.yaw;
      sample.swinging = foot.swinging;
    }
    if (tick === 40) {
      const headAfter = rig.skin.head.position.clone();
      const expected = headBefore.lerp(headAfter, .5);
      rig.presentation.apply(.5);
      assert.ok(rig.skin.head.position.distanceTo(expected) < 1e-7);
      rig.presentation.restore();
      assert.ok(rig.skin.head.position.equals(headAfter));
    }
  }
  assert.ok(stopSteps >= 2);
  assert.ok(pivotSteps >= 2);
  assert.ok(contactFrames > 70);
  rig.dispose();
});

test('an operative looks into a turn before the hips and keeps the collar joined during a reversal', () => {
  const physics = new StaticBVH([]);
  const controller = new CharacterController(physics, vector(0, 0, 0));
  const rig = new BotRig(new Group(), 3, 1);
  const bot = {
    position: controller.position, velocity: controller.velocity, height: controller.height, controller,
    yaw: 0, pitch: 0, kick: 0, clock: 0, state: 'engage', visibleTarget: true,
  };
  const forward = vector(0, 0, -1);
  const direction = vector(0, 0, 0);
  const yawOf = mesh => {
    direction.copy(forward).applyQuaternion(mesh.quaternion);
    return Math.atan2(-direction.x, -direction.z);
  };
  rig.pose(bot, physics, 1 / 60);
  for (let frame = 1; frame <= 8; frame++) {
    bot.yaw = frame * .09;
    bot.clock = frame / 60;
    rig.pose(bot, physics, 1 / 60);
  }
  const hips = direction.subVectors(rig.joints[6], rig.joints[3]);
  const hipsYaw = Math.atan2(-hips.z, hips.x);
  const chestYaw = yawOf(rig.skin.torso);
  assert.ok(yawOf(rig.skin.head) > chestYaw + .08);
  assert.ok(chestYaw > hipsYaw + .08);

  const wish = vector(1, 0, -.35);
  const torso = rig.skin.torso, head = rig.skin.head;
  const collar = vector(0, 0, 0), gaiter = vector(0, 0, 0), up = vector(0, 0, 0);
  for (let tick = 1; tick <= 285; tick++) {
    bot.clock = (tick + 16) / 120;
    if (tick === 150) wish.set(-.76, 0, .54);
    controller.step(1 / 120, { wish, speed: 2.85, maxAcceleration: 13, maxBraking: 17 });
    if (tick % 2) continue;
    rig.pose(bot, physics, 1 / 60);
    collar.set(0, .592 * torso.scale.y, 0).applyQuaternion(torso.quaternion).add(torso.position);
    gaiter.set(0, -.182, .016).applyQuaternion(head.quaternion).add(head.position);
    up.set(0, 1, 0).applyQuaternion(torso.quaternion);
    assert.ok(gaiter.sub(collar).dot(up) < .008, 'the neck gaiter overlaps the collar');
    const [pelvis, , , leftHip, , leftFoot, rightHip, , rightFoot] = rig.joints;
    assert.ok(pelvis.y - bot.position.y > .57, 'the standing pelvis stays above a crouch dip');
    assert.ok(leftHip.distanceTo(leftFoot) < .92 && rightHip.distanceTo(rightFoot) < .92,
      'the catch step keeps both boots within leg reach');
  }
  rig.dispose();
});

test('boots lift over a curb before swinging forward', () => {
  const physics = new StaticBVH([box([-3, 0, -6.3], [3, .17, -3.3])]);
  const controller = new CharacterController(physics, vector(0, .002, 0));
  const rig = new BotRig(new Group(), 3, 1);
  const bot = {
    position: controller.position, velocity: controller.velocity, height: controller.height, controller,
    yaw: 0, pitch: 0, kick: 0, clock: 0, reloading: 0, state: 'patrol', visibleTarget: null,
  };
  const wish = vector(0, 0, 0), probe = vector(0, 0, 0), sole = vector(0, 0, 0), down = vector(0, -1, 0);
  rig.pose(bot, physics, 1 / 60);
  let touches = 0;
  for (let tick = 1; tick <= 330; tick++) {
    bot.clock = tick / 120;
    wish.z = bot.clock >= .32 && bot.clock < 2.64 ? -1 : 0;
    controller.step(1 / 120, { wish, speed: 3.1 });
    bot.height = controller.height;
    if (tick % 2) continue;
    if (rig.pose(bot, physics, 1 / 60) === 'concrete') touches++;
    for (const { shoe } of rig.skin.limbs) {
      for (const z of [-.16, .044]) {
        sole.set(0, -.086, z).applyQuaternion(shoe.quaternion).add(shoe.position);
        const floor = physics.raycast(probe.copy(sole).addScaledVector(down, -.45), down, .95);
        assert.ok(!floor || sole.y - floor.point.y > -.035, 'the sole clears the curb lip');
      }
    }
  }
  assert.ok(touches >= 2, 'footfalls use the curb surface');
  rig.dispose();
});

test('reactive crates stack, sleep, and wake when their support is shot', () => {
  const physics = new StaticBVH([]);
  const rigid = new RigidWorld(physics);
  const crates = [0.245, 0.747, 1.25].map((height) => rigid.add({
    position: vector(0, height, 0), halfExtents: vector(0.24, 0.245, 0.24),
  }));
  for (let tick = 0; tick < 360; tick += 1) rigid.step(1 / 120);
  assert.equal(rigid.activeCount, 0);
  assert.ok(crates[2].position.y > 1.21);
  const hit = rigid.raycast(vector(0, 0.74, 2), vector(0, 0, -1), 1.9);
  assert.equal(hit.body, crates[1]);
  assert.ok(hit.exitDistance > 2.2);

  rigid.impulse(crates[0], vector(-3.7, 0.25, 0), crates[0].position.clone().add(vector(0, 0, 0.03)));
  rigid.step(1 / 120);
  assert.equal(rigid.activeCount, 3);
  for (let tick = 0; tick < 310; tick += 1) rigid.step(1 / 120);
  assert.ok(crates[0].position.x < -0.5);
  assert.ok(crates[2].position.y < 0.6);
  assert.equal(rigid.activeCount, 0);
  rigid.reset();
  assert.equal(crates[0].position.x, 0);
  assert.equal(crates[2].position.y, 1.25);
});

async function loadSoldierAsset() {
  const bytes = await readFile(new URL('../src/assets/soldier-rig.glb', import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'testTexture', loadTexture: async () => new Texture({}) }));
  return soldierVariants(await loader.parseAsync(new Uint8Array(bytes).buffer, ''));
}

test('rifle walk and run loop and keep their footfall rhythm through a speed change', async () => {
  const asset = await loadSoldierAsset();
  const template = asset.templates[0];
  const physics = new StaticBVH([]);
  const controller = new CharacterController(physics, vector(0, 0, 0));
  const bot = {
    position: controller.position, velocity: controller.velocity, height: controller.height, controller,
    yaw: 0, pitch: 0, kick: 0, clock: 0, state: 'engage', visibleTarget: true,
  };
  const rig = new BotRig(new Group(), 0, 0, template);
  const { feet, chest, bones } = rig.soldier;
  let previousPhase = 0;
  let doubleSupport = 0;
  let flight = 0;
  const walkLean = [];
  const runLean = [];
  const up = new Vector3();
  const world = new Vector3();
  const elbow = new Vector3();
  const wish = vector(0, 0, -1);
  const dt = 1 / 60;
  try {
    for (const name of ['walk', 'run']) {
      const { tracks, duration } = template.clips.get(name);
      for (const track of tracks) {
        const end = track.interpolant.evaluate(duration);
        const sign = track.property === 'quaternion' && end.reduce((sum, x, i) => sum + x * track.reference[i], 0) < 0 ? -1 : 1;
        assert.ok(end.every((x, i) => Math.abs(x * sign - track.reference[i]) < .0001), name + ' loop seam');
      }
    }
    for (let frame = 0; frame <= 300; frame++) {
      const t = frame * dt;
      const progress = Math.max(0, Math.min(1, t - 1.4, 4.7 - t));
      const speed = 1.25 + 2.2 * progress;
      controller.step(dt, { wish, speed });
      bot.clock = t;
      rig.pose(bot, physics, dt);
      const phaseAdvance = (rig.soldier.phase - previousPhase + 1) % 1;
      assert.ok(phaseAdvance < .045, 'changing speed does not restart the gait cycle');
      previousPhase = rig.soldier.phase;
      for (const { foot } of feet.legs) {
        foot.getWorldPosition(world);
        assert.ok(world.y > .10 && world.y < .57, 'the boot stays within the gait range');
      }
      if (t > .65) {
        bones.get('handL').getWorldPosition(world);
        bones.get('forearmL').getWorldPosition(elbow);
        assert.ok(Math.abs(world.distanceTo(elbow) - .229) < .006, 'the arm can reach the rifle without stretching');
      }
      // The chest bone points up in the bind pose.
      up.set(0, 1, 0).transformDirection(chest.matrixWorld);
      const support = feet.legs.filter(leg => leg.planted).length;
      if (t > .65 && t < 1.4) {
        doubleSupport += Number(support === 2);
        walkLean.push(-up.z);
      }
      if (t > 2.8 && t < 3.65) {
        flight += Number(support === 0);
        runLean.push(-up.z);
      }
    }
    assert.ok(doubleSupport > 0, 'walk passes weight from one planted foot to the other');
    assert.ok(flight > 0, 'run includes a flight phase');
    assert.ok(Math.min(...runLean) - Math.max(...walkLean) > .18, 'the forward run lean survives aiming');
  } finally {
    rig.dispose();
    asset.dispose();
  }
});

test('soldier falls settle on either side and clear walls and low obstacles', async () => {
  const asset = await loadSoldierAsset();
  const point = new Vector3();
  const joint = new Vector3();

  try {
    for (const side of [-1, 1]) for (const obstacle of ['none', 'wall', 'low', 'air']) {
      const besideWall = obstacle === 'wall';
      const low = side === -1 ? box([.20, 0, -.32], [.44, .22, -.10]) : box([-.44, 0, -.32], [-.20, .22, -.10]);
      const wall = side === 1 ? box([.455, 0, -1], [.625, 2.7, 1]) : box([-.625, 0, -1], [-.455, 2.7, 1]);
      const physics = new StaticBVH(besideWall ? [wall] : obstacle === 'low' ? [low] : []);
      const controller = new CharacterController(physics, vector(0, obstacle === 'air' ? .68 : 0, 0));
      controller.step(1 / 120, { wish: vector(0, 0, 0) });
      const bot = {
        position: controller.position, velocity: controller.velocity, height: controller.height, controller,
        yaw: 0, pitch: 0, kick: 0, clock: .5, reloading: 0, state: 'engage', visibleTarget: true,
      };
      const rig = new BotRig(new Group(), 0, 0, asset.templates[0]);
      const { root, mesh, bones } = rig.soldier;
      try {
        rig.pose(bot, physics, 1 / 60);
        rig.fall(vector(side, .05, 0), bot.velocity);
        let closestWall = Infinity;
        for (let tick = 0; tick <= 192; tick++) {
          rig.tumble(physics, 1 / 120);
          if (tick % 8 !== 0) continue;
          root.updateMatrixWorld(true);
          let floorGap = Infinity;
          let propDepth = 0;
          closestWall = Infinity;
          for (let vertex = 0; vertex < mesh.geometry.attributes.position.count; vertex++) {
            mesh.getVertexPosition(vertex, point).applyMatrix4(mesh.matrixWorld);
            floorGap = Math.min(floorGap, point.y);
            if (obstacle === 'low') {
              propDepth = Math.max(propDepth, Math.min(
                point.x - low.min.x, low.max.x - point.x,
                point.y - low.min.y, low.max.y - point.y,
                point.z - low.min.z, low.max.z - point.z,
              ));
            }
            if (besideWall && Math.abs(point.z) <= 1 && point.y <= 2.7) {
              closestWall = Math.min(closestWall, .455 - point.x * side);
            }
          }
          assert.ok(floorGap > -.004, `mesh intersects floor by ${-floorGap} m at tick ${tick}`);
          assert.ok(closestWall > -.004, `mesh intersects wall by ${-closestWall} m at tick ${tick}`);
          assert.ok(propDepth < .009, `mesh intersects a low obstacle by ${propDepth} m at tick ${tick}`);
        }
        assert.equal(rig.soldier.fallClip, 'death_' + (besideWall ? 'cover_' : '') + (side === 1 ? 'right' : 'left'));
        if (besideWall) assert.ok(closestWall < .025, 'the soldier rests against the wall');
        if (obstacle === 'none' || obstacle === 'air') {
          let chestGap = Infinity;
          let pelvisGap = Infinity;
          for (const { vertex, bone } of asset.templates[0].fallSurface) {
            if (bone !== 'chest' && bone !== 'pelvis') continue;
            mesh.getVertexPosition(vertex, point).applyMatrix4(mesh.matrixWorld);
            if (bone === 'chest') chestGap = Math.min(chestGap, point.y);
            else pelvisGap = Math.min(pelvisGap, point.y);
          }
          assert.ok(chestGap < .065 && pelvisGap < .10, 'the torso settles rather than balancing on an arm');
        }
        for (const arm of ['L', 'R']) {
          bones.get('hand' + arm).getWorldPosition(point);
          bones.get('forearm' + arm).getWorldPosition(joint);
          assert.ok(Math.abs(point.distanceTo(joint) - .229) < .005, 'the forearm retains its bind length');
        }
        bones.get('footL').getWorldPosition(point);
        bones.get('footR').getWorldPosition(joint);
        assert.ok(point.distanceTo(joint) > .24, 'the boots finish in separate positions');
      } finally {
        rig.dispose();
      }
    }
  } finally {
    asset.dispose();
  }
});

test('a face-down fall settles onto the ground', async () => {
  const asset = await loadSoldierAsset();
  const point = new Vector3();
  try {
    for (const height of [0, .68]) {
      const physics = new StaticBVH([]);
      const controller = new CharacterController(physics, vector(0, height, 0));
      controller.step(1 / 120, { wish: vector(0, 0, 0) });
      const rig = new BotRig(new Group(), 0, 0, asset.templates[0]);
      try {
        rig.pose({
          controller, position: controller.position, velocity: controller.velocity,
          yaw: 0, pitch: 0, kick: 0, clock: .5, reloading: 0, height: controller.height, state: 'engage', visibleTarget: true,
        }, physics, 1 / 60);
        rig.fall(vector(0, .05, -1), controller.velocity);
        const { mesh, root } = rig.soldier;
        let gaps;
        for (let tick = 0; tick <= 240; tick++) {
          rig.tumble(physics, 1 / 120);
          if (tick % 8) continue;
          root.updateMatrixWorld(true);
          let floor = Infinity;
          for (let vertex = 0; vertex < mesh.geometry.attributes.position.count; vertex++) {
            mesh.getVertexPosition(vertex, point).applyMatrix4(mesh.matrixWorld);
            floor = Math.min(floor, point.y);
          }
          assert.ok(floor > -.004, `floor penetration at tick ${tick}: ${floor} m`);
          gaps = { floor, chest: Infinity, pelvis: Infinity };
          for (const { vertex, bone } of asset.templates[0].fallSurface) {
            if (bone !== 'chest' && bone !== 'pelvis') continue;
            mesh.getVertexPosition(vertex, point).applyMatrix4(mesh.matrixWorld);
            gaps[bone] = Math.min(gaps[bone], point.y);
          }
        }
        assert.equal(rig.soldier.fallClip, 'death_forward');
        assert.ok(gaps.floor < .028 && gaps.chest < .055 && gaps.pelvis < .09, JSON.stringify(gaps));
      } finally {
        rig.dispose();
      }
    }
  } finally {
    asset.dispose();
  }
});

test('a fast reactive tin hits a thin static wall and stops', () => {
  const physics = new StaticBVH([box([2.3, 0, -2], [2.34, 4, 2], 'metal')]);
  const rigid = new RigidWorld(physics);
  const tin = rigid.add({
    shape: 'sphere', radius: 0.11, position: vector(1, 0.2, 0),
    mass: 0.5, restitution: 0.1, surface: 'metal',
  });
  for (let tick = 0; tick < 180; tick += 1) rigid.step(1 / 120);
  assert.equal(tin.sleeping, true);
  rigid.impulse(tin, vector(19, 0.75, 0));
  for (let tick = 0; tick < 360; tick += 1) {
    rigid.step(1 / 120);
    assert.ok(tin.position.x < 2.191);
  }
  assert.equal(tin.sleeping, true);
});
