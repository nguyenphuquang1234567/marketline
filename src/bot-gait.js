import { MathUtils, Vector3 } from 'three';

const DOWN = new Vector3(0, -1, 0);
const ANKLE = .088;
const MOVING = .21;
const TAU = 2 * Math.PI;
const FOOT_SUPPORT = [0, .167, -.055];

export function angleDelta(target, current) {
  return MathUtils.euclideanModulo(target - current + Math.PI, TAU) - Math.PI;
}

const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

function horizontalDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function footState() {
  return {
    position: new Vector3(), anchor: new Vector3(), start: new Vector3(), goal: new Vector3(),
    yaw: 0, startYaw: 0, goalYaw: 0, roll: 0, swinging: false, surface: 'asphalt',
    elapsed: 0, duration: 0, clearance: 0, lead: 0, plantedFor: .25,
  };
}

export class BotGait {
  constructor(index) {
    this.feet = [footState(), footState()];
    this.firstFoot = index % 2;
    this.neutrals = [new Vector3(), new Vector3()];
    this.probe = new Vector3();
    this.direction = new Vector3();
    this.destination = new Vector3();
  }

  stance(out, bot, yaw, index, ready, crouch) {
    const side = index ? 1 : -1;
    const spread = side * (.133 + crouch * .029);
    const stagger = (index ? -.096 : .103) * ready - side * .028;
    const sine = Math.sin(yaw), cosine = Math.cos(yaw);
    return out.set(
      bot.position.x + cosine * spread - sine * stagger,
      bot.position.y + ANKLE,
      bot.position.z - sine * spread - cosine * stagger,
    );
  }

  ground(position, bot, physics, yaw) {
    let height = -Infinity;
    let surface = bot.controller.surface || 'asphalt';
    const x = -Math.sin(yaw), z = -Math.cos(yaw);
    for (const offset of FOOT_SUPPORT) {
      this.probe.set(position.x + x * offset, bot.position.y + .44, position.z + z * offset);
      const floor = physics.raycast(this.probe, DOWN, .89);
      if (!floor || floor.distance <= .02 || floor.normal.y < .65 || floor.point.y > bot.position.y + .35
        || floor.point.y <= height) continue;
      height = floor.point.y;
      surface = floor.surface || surface;
    }
    position.y = (Number.isFinite(height) ? height : bot.position.y) + ANKLE;
    return surface;
  }

  target(out, neutral, bot, physics, yaw, prediction) {
    out.copy(neutral);
    const direction = this.direction.set(bot.velocity.x, 0, bot.velocity.z);
    const speed = direction.length();
    if (speed > MOVING && prediction > 0) {
      direction.multiplyScalar(1 / speed);
      const ahead = Math.min(speed * prediction, 2.15);
      const hit = physics.raycast(this.probe.set(neutral.x, bot.position.y + .32, neutral.z), direction, ahead);
      out.addScaledVector(direction, hit ? Math.max(0, hit.distance - .10) : ahead);
    }
    return this.ground(out, bot, physics, yaw);
  }

  reset(bot, physics, yaw, ready, crouch) {
    this.nextFoot = this.firstFoot;
    this.sinceStep = .5;
    this.lift = 0;
    this.shift = 0;
    this.landed = null;
    this.grounded = bot.controller.grounded;
    for (let index = 0; index < this.feet.length; index++) {
      const foot = this.feet[index];
      foot.yaw = yaw + (index ? -.095 : .095);
      this.stance(foot.anchor, bot, yaw, index, ready, crouch);
      foot.surface = this.ground(foot.anchor, bot, physics, foot.yaw);
      foot.position.copy(foot.anchor);
      foot.start.copy(foot.anchor);
      foot.goal.copy(foot.anchor);
      foot.startYaw = foot.goalYaw = foot.yaw;
      foot.roll = 0;
      foot.swinging = false;
      foot.plantedFor = .25;
    }
  }

  begin(index, bot, physics, yaw, speed, crouch, duration, lead) {
    const foot = this.feet[index];
    this.nextFoot = 1 - index;
    this.sinceStep = 0;
    foot.elapsed = 0;
    foot.duration = duration;
    foot.clearance = speed > MOVING ? MathUtils.clamp(.062 + speed * .015 - crouch * .026, .06, .13) : .055;
    foot.lead = lead;
    foot.swinging = true;
    foot.start.copy(foot.position);
    foot.startYaw = foot.yaw;
    foot.goalYaw = yaw + (index ? -.095 : .095);
    foot.surface = this.target(foot.goal, this.neutrals[index], bot, physics, foot.goalYaw, duration + lead);
  }

  chooseStep(yaw, speed, interval) {
    const [left, right] = this.feet;
    if (speed > MOVING) {
      const next = this.nextFoot;
      const foot = this.feet[next];
      const other = this.feet[1 - next];
      if (foot.swinging || foot.plantedFor < .05
        || other.swinging && (speed < 1.55 || other.elapsed < other.duration * .56)) return -1;
      const lag = horizontalDistance(foot.anchor, this.neutrals[next]);
      const time = lag > .32 ? Math.min(interval, .133) : interval;
      return this.sinceStep >= time && lag > .085 ? next : -1;
    }
    if (left.swinging || right.swinging || this.sinceStep < .25) return -1;
    const stanceError = (foot, index) => foot.plantedFor < .05 ? 0 : Math.max(
      horizontalDistance(foot.anchor, this.neutrals[index]) / .115,
      Math.abs(angleDelta(yaw + (index ? -.095 : .095), foot.yaw)) / .44,
    );
    const leftError = stanceError(left, 0), rightError = stanceError(right, 1);
    return Math.max(leftError, rightError) > 1 ? Number(rightError > leftError) : -1;
  }

  swingFoot(index, dt, bot, physics, yaw, speed) {
    const foot = this.feet[index];
    if (!foot.swinging) return;
    const remaining = foot.duration - foot.elapsed;
    foot.elapsed = Math.min(foot.duration, foot.elapsed + dt);
    const progress = foot.elapsed / foot.duration;
    if (progress < .73) {
      const wantedYaw = yaw + (index ? -.095 : .095);
      const response = damp(18, dt);
      foot.goalYaw += angleDelta(wantedYaw, foot.goalYaw) * response;
      foot.surface = this.target(this.destination, this.neutrals[index], bot, physics, foot.goalYaw, remaining + foot.lead);
      foot.goal.lerp(this.destination, response);
    }
    const rise = foot.goal.y - foot.start.y;
    const climb = MathUtils.smoothstep(rise, .034, .102);
    const eased = MathUtils.smoothstep(progress, climb * .145, 1);
    const arch = 16 * progress ** 2 * (1 - progress) ** 2;
    foot.position.lerpVectors(foot.start, foot.goal, eased);
    const elevation = rise >= 0
      ? MathUtils.smoothstep(progress, 0, .56 - climb * .37)
      : MathUtils.smoothstep(progress, .38, 1);
    foot.position.y = foot.start.y + rise * elevation + foot.clearance * arch;
    foot.yaw = foot.startYaw + angleDelta(foot.goalYaw, foot.startYaw) * eased;
    const toeOff = 1 - climb * (1 - MathUtils.smoothstep(progress, .23, .62));
    foot.roll = -Math.sin(progress * TAU) * .225 * Math.min(.55 + speed * .12, 1) * toeOff;
    this.lift += Math.sin(progress * TAU) * Math.min(speed * .003, .012) + arch * .007;
    this.shift += (index ? -1 : 1) * arch * .021;

    if (progress >= 1) {
      foot.surface = this.ground(foot.goal, bot, physics, foot.goalYaw);
      foot.anchor.copy(foot.goal);
      foot.position.copy(foot.anchor);
      foot.yaw = foot.goalYaw;
      foot.roll = 0;
      foot.swinging = false;
      foot.plantedFor = 0;
      this.landed = foot.surface;
    }
  }

  update(dt, bot, physics, yaw, ready, crouch, speed) {
    this.landed = null;
    this.lift = this.shift = 0;
    this.sinceStep += dt;
    for (let i = 0; i < 2; i++) this.stance(this.neutrals[i], bot, yaw, i, ready, crouch);
    if (!bot.controller.grounded) {
      for (let i = 0; i < 2; i++) {
        const foot = this.feet[i];
        this.destination.copy(this.neutrals[i]).addScaledVector(bot.velocity, .04);
        this.destination.y = bot.position.y + ANKLE + .06;
        foot.position.lerp(this.destination, damp(12, dt));
        foot.yaw += angleDelta(yaw + (i ? -.095 : .095), foot.yaw) * damp(11, dt);
        foot.swinging = false;
        foot.plantedFor = 0;
        foot.roll *= 1 - damp(14, dt);
        foot.anchor.copy(foot.position);
      }
      this.grounded = false;
      return;
    }

    if (!this.grounded) {
      for (const foot of this.feet) {
        foot.surface = this.ground(foot.anchor, bot, physics, foot.yaw);
        foot.position.copy(foot.anchor);
      }
      this.landed = this.feet[0].surface;
      this.grounded = true;
    }
    for (let i = 0; i < 2; i++) {
      const foot = this.feet[i];
      if (foot.swinging) this.swingFoot(i, dt, bot, physics, yaw, speed);
      else foot.plantedFor += dt;
    }

    const interval = MathUtils.clamp(.43 - speed * .062, .155, .42) * (1 - crouch * .16);
    const index = this.chooseStep(yaw, speed, interval);
    if (index < 0) return;
    const running = MathUtils.smoothstep(speed, 1.65, 3.65) * (1 - crouch * .56);
    const duration = speed > MOVING ? interval * MathUtils.lerp(.83, 1.16, running) : .255;
    const lead = speed > MOVING ? interval * MathUtils.lerp(.55, .46, running) : 0;
    this.begin(index, bot, physics, yaw, speed, crouch, duration, lead);
  }
}
