import { Group, MathUtils, Vector3 } from 'three';
import { CharacterController } from './physics.js';
import { BotRig } from './bot-rig.js';

const DOWN = new Vector3(0, -1, 0);
const GRID_SIZE = 1.25;
const NAMES = ['Kestrel', 'Sable', 'Tern', 'Viper', 'Rook', 'Mantis', 'Jackal'];
const NEIGHBORS = [
  [-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1],
  [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, 1, Math.SQRT2],
];
const FORWARD_EDGES = [1, 3, 6, 7];
const REVERSE_EDGE = [1, 0, 3, 2, 7, 6, 5, 4];
const DIFFICULTY = {
  easy: { reaction: 0.62, spread: 0.044, range: 40, burstPause: 0.96 },
  normal: { reaction: 0.39, spread: 0.027, range: 53, burstPause: 0.72 },
  hard: { reaction: 0.27, spread: 0.017, range: 62, burstPause: 0.56 },
};

function seededRandom(seed) {
  let state = (Number(seed) ^ 0x58cf624f) >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function turnToward(from, to, limit) {
  const difference = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + MathUtils.clamp(difference, -limit, limit);
}

class OpenSet {
  constructor() {
    this.ids = [];
    this.priorities = [];
    this.length = 0;
  }

  push(id, priority) {
    let position = this.length;
    this.length += 1;
    while (position > 0) {
      const parent = (position - 1) >> 1;
      if (this.priorities[parent] <= priority) break;
      this.ids[position] = this.ids[parent];
      this.priorities[position] = this.priorities[parent];
      position = parent;
    }
    this.ids[position] = id;
    this.priorities[position] = priority;
  }

  pop() {
    const best = this.ids[0];
    this.length -= 1;
    if (this.length === 0) return best;
    const last = this.ids[this.length];
    const lastPriority = this.priorities[this.length];
    let position = 0;
    while (position * 2 + 1 < this.length) {
      let child = position * 2 + 1;
      if (child + 1 < this.length && this.priorities[child + 1] < this.priorities[child]) child += 1;
      if (this.priorities[child] >= lastPriority) break;
      this.ids[position] = this.ids[child];
      this.priorities[position] = this.priorities[child];
      position = child;
    }
    this.ids[position] = last;
    this.priorities[position] = lastPriority;
    return best;
  }
}

export class NavWorld {
  constructor(physics, bounds) {
    this.physics = physics;
    this.bounds = bounds;
    this.width = Math.floor((bounds.maxX - bounds.minX) / GRID_SIZE);
    this.depth = Math.floor((bounds.maxZ - bounds.minZ) / GRID_SIZE);
    const size = this.width * this.depth;
    this.walkable = new Uint8Array(size);
    this.edges = new Uint8Array(size);
    this.height = new Float32Array(size);
    this.cost = new Float32Array(size);
    this.seen = new Int32Array(size);
    this.closed = new Int32Array(size);
    this.parent = new Int32Array(size);
    this.generation = 0;
    this.open = new OpenSet();
    this.cover = [];
    const floorProbe = new Vector3();
    const point = new Vector3();
    for (let index = 0; index < size; index += 1) {
      this.point(index, point).setY(0.012);
      if (physics.overlapsCapsule(point, 0.42, 1.75)) {
        point.y = 0.34;
        if (physics.overlapsCapsule(point, 0.42, 1.75)) continue;
        const floor = physics.raycast(floorProbe.copy(point), DOWN, 0.35);
        if (!floor || floor.normal.y < 0.65 || floor.point.y < 0.03) continue;
        point.y = floor.point.y + 0.012;
        if (physics.overlapsCapsule(point, 0.42, 1.75)) continue;
      }
      this.height[index] = point.y;
      this.walkable[index] = 1;
    }

    const destination = new Vector3();
    const travel = new Vector3();
    const rise = new Vector3();
    for (let index = 0; index < size; index += 1) {
      if (!this.walkable[index]) continue;
      const x = index % this.width;
      const z = Math.floor(index / this.width);
      for (const direction of FORWARD_EDGES) {
        const [dx, dz] = NEIGHBORS[direction];
        const a = x + dx;
        const b = z + dz;
        if (a < 0 || a >= this.width || b >= this.depth) continue;
        const next = b * this.width + a;
        if (!this.walkable[next] || Math.abs(this.height[index] - this.height[next]) > 0.35) continue;
        if (dx && dz && (!this.walkable[index + dx] || !this.walkable[index + dz * this.width])) continue;
        this.point(index, point);
        this.point(next, destination);
        travel.subVectors(destination, point);
        const obstacle = physics.sweepCapsule(point, travel, 0.37, 1.75);
        if (obstacle) {
          const top = (obstacle.collider.max?.y ?? Infinity) + 0.012;
          const low = Math.min(point.y, destination.y);
          if (top - low > 0.35) continue;
          const across = Math.max(point.y, destination.y, top);
          if (physics.sweepCapsule(point, rise.set(0, across - point.y, 0), 0.37, 1.75)
            || physics.sweepCapsule(destination, rise.set(0, across - destination.y, 0), 0.37, 1.75)) continue;
          point.y = across;
          travel.y = 0;
          if (physics.sweepCapsule(point, travel, 0.37, 1.75)) continue;
        }
        this.edges[index] |= 1 << direction;
        this.edges[next] |= 1 << REVERSE_EDGE[direction];
      }
    }
    for (let index = 0; index < size; index += 1) {
      if (!this.edges[index]) continue;
      const x = index % this.width;
      const z = Math.floor(index / this.width);
      if (x < 2 || z < 2 || x > this.width - 3 || z > this.depth - 3) continue;
      let blocked = 0;
      for (let direction = 0; direction < 4; direction += 1) {
        if (!(this.edges[index] & (1 << direction))) blocked += 1;
      }
      if (blocked > 0 && blocked < 3) this.cover.push({ index, point: this.point(index, new Vector3()), blocked });
    }
  }

  point(index, target) {
    return target.set(
      this.bounds.minX + (index % this.width + 0.5) * GRID_SIZE,
      this.height[index],
      this.bounds.minZ + (Math.floor(index / this.width) + 0.5) * GRID_SIZE,
    );
  }

  nearest(position) {
    const col = MathUtils.clamp(Math.floor((position.x - this.bounds.minX) / GRID_SIZE), 0, this.width - 1);
    const row = MathUtils.clamp(Math.floor((position.z - this.bounds.minZ) / GRID_SIZE), 0, this.depth - 1);
    let best = -1;
    let score = Infinity;
    for (let radius = 0; radius <= 7; radius += 1) {
      for (let z = Math.max(0, row - radius); z <= Math.min(this.depth - 1, row + radius); z += 1) {
        for (let x = Math.max(0, col - radius); x <= Math.min(this.width - 1, col + radius); x += 1) {
          if (Math.max(Math.abs(x - col), Math.abs(z - row)) !== radius) continue;
          const index = z * this.width + x;
          if (!this.edges[index]) continue;
          const dx = position.x - (this.bounds.minX + (x + 0.5) * GRID_SIZE);
          const dz = position.z - (this.bounds.minZ + (z + 0.5) * GRID_SIZE);
          const distance = dx * dx + dz * dz + Math.abs(position.y - this.height[index]) * 0.5;
          if (distance < score) {
            score = distance;
            best = index;
          }
        }
      }
      if (best !== -1 && score < (radius + 0.48) ** 2 * GRID_SIZE * GRID_SIZE) break;
    }
    return best;
  }

  route(origin, target) {
    const start = this.nearest(origin);
    const goal = this.nearest(target);
    if (start < 0 || goal < 0) return [];
    if (start === goal) return [this.point(goal, new Vector3())];
    const endX = goal % this.width;
    const endZ = Math.floor(goal / this.width);
    const estimate = (x, z) => {
      const a = Math.abs(x - endX);
      const b = Math.abs(z - endZ);
      return Math.max(a, b) + Math.min(a, b) * (Math.SQRT2 - 1);
    };

    const generation = ++this.generation;
    this.seen[start] = generation;
    this.cost[start] = 0;
    this.parent[start] = -1;
    this.open.length = 0;
    this.open.push(start, 0);
    let best = start;
    let bestEstimate = Infinity;
    let visited = 0;
    while (this.open.length && visited < 2900) {
      const current = this.open.pop();
      if (this.closed[current] === generation) continue;
      this.closed[current] = generation;
      visited += 1;
      const x = current % this.width;
      const z = Math.floor(current / this.width);
      const remaining = estimate(x, z);
      if (remaining < bestEstimate) {
        best = current;
        bestEstimate = remaining;
      }
      if (current === goal) break;
      for (let direction = 0; direction < NEIGHBORS.length; direction += 1) {
        if (!(this.edges[current] & (1 << direction))) continue;
        const [dx, dz, distance] = NEIGHBORS[direction];
        const a = x + dx;
        const b = z + dz;
        const next = b * this.width + a;
        if (this.closed[next] === generation) continue;
        const cost = this.cost[current] + distance + Math.abs(this.height[current] - this.height[next]);
        if (this.seen[next] === generation && this.cost[next] <= cost) continue;
        this.seen[next] = generation;
        this.cost[next] = cost;
        this.parent[next] = current;
        this.open.push(next, cost + estimate(a, b) * 1.045);
      }
    }
    const path = [];
    for (let node = best; node !== -1 && node !== start; node = this.parent[node]) {
      path.push(this.point(node, new Vector3()));
    }
    return path.reverse();
  }
}

export class BotSystem {
  constructor({ scene, physics, world, seed, onFire = () => {}, onStep = () => {}, isObscured = () => false }) {
    this.scene = scene;
    this.physics = physics;
    this.world = world;
    this.onFire = onFire;
    this.onStep = onStep;
    this.isObscured = isObscured;
    this.random = seededRandom(seed);
    this.seed = seed;
    this.nav = new NavWorld(physics, world.bounds);
    this.reports = [];
    this.time = 0;
    this.frame = 0;
    this.origin = new Vector3();
    this.fireOrigin = new Vector3();
    this.ray = new Vector3();
    this.targetPoint = new Vector3();
    this.wish = new Vector3();
    this.aimPoint = new Vector3();
    this.peekPoint = new Vector3();
    this.probe = new Vector3();
    this.moveProbe = new Vector3();
    this.bots = NAMES.map((name, index) => {
      const team = index < 3 ? 0 : 1;
      const slot = team === 0 ? index : index - 3;
      const group = new Group();
      group.name = name;
      scene.add(group);
      const rig = new BotRig(group, index, team);
      const spawn = this.spawnPoint(team, slot);
      const controller = new CharacterController(physics, spawn);
      return {
        id: 'bot-' + index,
        name, team, slot, group, controller, rig,
        flank: Math.abs(spawn.x) > 13 ? Math.sign(spawn.x) : 0,
        position: controller.position,
        velocity: controller.velocity,
        height: controller.height,
        alive: true,
        health: 100,
        memory: new Vector3(),
        observed: new Vector3(),
        destination: new Vector3(),
        goal: new Vector3(),
        coverPoint: new Vector3(),
        path: [],
        state: 'patrol',
        phase: slot + team * 0.4,
      };
    });
    this.reset();
  }

  spawnPoint(team, slot) {
    const points = this.world.spawns[team];
    return points[(slot + (team === 0 ? 1 : 0)) % points.length];
  }

  reset() {
    this.random = seededRandom(this.seed);
    this.time = 0;
    this.frame = 0;
    this.reports.length = 0;
    for (const bot of this.bots) this.respawn(bot, this.spawnPoint(bot.team, bot.slot));
  }

  respawn(bot, feet) {
    bot.controller.teleport(feet);
    bot.health = 100;
    bot.alive = true;
    bot.height = bot.controller.height;
    bot.yaw = bot.team === 0 ? 0 : Math.PI;
    bot.pitch = 0;
    bot.kick = 0;
    bot.clock = 0;
    bot.shootAt = this.time + 0.7;
    bot.thinkAt = this.time + this.random() * 0.17;
    bot.planAt = this.time;
    bot.radioAt = this.time;
    bot.seenAt = -Infinity;
    bot.aimSince = Infinity;
    bot.heardAt = -Infinity;
    bot.alertAt = -Infinity;
    bot.visibleTarget = null;
    bot.magazine = 30;
    bot.reloading = 0;
    bot.burst = 0;
    bot.state = 'patrol';
    bot.path.length = 0;
    bot.pathIndex = 0;
    bot.patrolStage = 0;
    bot.coverUntil = 0;
    bot.peekUntil = 0;
    bot.coverPoint.copy(bot.position);
    bot.destination.copy(bot.position);
    bot.progressAt = this.time + 0.65;
    bot.progressX = bot.position.x;
    bot.progressZ = bot.position.z;
    bot.rig.ready = false;
    bot.rig.age = 0;
    bot.rig.pose(bot, this.physics, 1 / 60);
  }

  kill(bot, direction = new Vector3(0, 0.1, -1)) {
    bot.alive = false;
    bot.health = 0;
    bot.visibleTarget = null;
    bot.rig.fall(direction, bot.velocity);
  }

  hit(bot, amount = 0) {
    bot.kick = Math.min(1.4, bot.kick + 0.25 + amount * 0.009);
    bot.alertAt = this.time;
    if (amount > 22) bot.planAt = Math.min(bot.planAt, this.time + 0.1);
  }

  hear(position, sourceTeam, radius) {
    const radiusSquared = radius * radius;
    for (const bot of this.bots) {
      if (!bot.alive || bot.team === sourceTeam || this.time - bot.seenAt < 0.45) continue;
      const distanceSquared = bot.position.distanceToSquared(position);
      if (distanceSquared > radiusSquared) continue;
      if (this.time - bot.heardAt < 0.35) continue;
      const error = 0.6 + 3.9 * Math.sqrt(distanceSquared) / radius;
      bot.memory.copy(position);
      bot.memory.x += (this.random() * 2 - 1) * error;
      bot.memory.z += (this.random() * 2 - 1) * error;
      bot.heardAt = this.time;
      bot.planAt = Math.min(bot.planAt, this.time + 0.12);
    }
  }

  canSee(origin, destination) {
    const direction = this.ray.subVectors(destination, origin);
    const length = direction.length();
    if (length < 0.05) return true;
    if (this.isObscured(origin, destination)) return false;
    return !this.physics.raycast(origin, direction.multiplyScalar(1 / length), length - 0.04);
  }

  findTarget(bot, player, config) {
    const previous = bot.visibleTarget;
    let best = null;
    let score = Infinity;
    const x = -Math.sin(bot.yaw);
    const z = -Math.cos(bot.yaw);
    const eye = this.origin.copy(bot.position).addScaledVector(Vector3UnitY, bot.height - 0.11);
    for (let index = -1; index < this.bots.length; index += 1) {
      const actor = index === -1 ? player : this.bots[index];
      if (!actor?.alive || actor.team === bot.team) continue;
      const dx = actor.position.x - eye.x;
      const dz = actor.position.z - eye.z;
      const distance = Math.hypot(dx, dz);
      if (distance > config.range || distance < 1e-4) continue;
      const look = (dx * x + dz * z) / distance;
      if (look < (distance > 15 ? 0.43 : (distance > 7 ? 0.16 : -0.5))) continue;
      const value = distance - (previous === actor ? 6 : 0);
      if (value >= score) continue;
      const target = this.targetPoint.copy(actor.position).addScaledVector(Vector3UnitY, actor.height * 0.75);
      if (!this.canSee(eye, target)) {
        target.y = actor.position.y + actor.height * 0.94;
        if (!this.canSee(eye, target)) continue;
      }
      score = value;
      best = actor;
      bot.observed.copy(target);
    }
    bot.visibleTarget = best;
    if (!best) return;
    if (previous !== best || this.time - bot.seenAt > 0.47) {
      bot.aimSince = this.time + config.reaction * (0.84 + this.random() * 0.46);
      bot.planAt = Math.min(this.time + 0.06, bot.planAt);
    }
    bot.memory.copy(best.position);
    bot.seenAt = this.time;
    if (this.time >= bot.radioAt) {
      bot.radioAt = this.time + 1.1 + this.random() * 0.65;
      const position = best.position.clone();
      position.x += (this.random() - 0.5) * 2.5;
      position.z += (this.random() - 0.5) * 2.5;
      this.reports.push({ team: bot.team, position, time: this.time + 0.45 + this.random() * 0.42 });
    }
  }

  shareReports() {
    for (let index = this.reports.length - 1; index >= 0; index -= 1) {
      const report = this.reports[index];
      if (report.time > this.time) continue;
      for (const bot of this.bots) {
        if (!bot.alive || bot.team !== report.team || this.time - Math.max(bot.seenAt, bot.heardAt) < 0.95) continue;
        bot.memory.copy(report.position);
        bot.heardAt = this.time;
        bot.planAt = Math.min(bot.planAt, this.time + 0.2);
      }
      this.reports.splice(index, 1);
    }
  }

  chooseCover(bot) {
    const threat = this.targetPoint.copy(bot.memory).addScaledVector(Vector3UnitY, 1.4);
    const options = [];
    for (const cover of this.nav.cover) {
      const distance = cover.point.distanceToSquared(bot.position);
      if (distance > 230 || distance < 2.2) continue;
      const targetDistance = cover.point.distanceToSquared(threat);
      if (targetDistance < 32) continue;
      let score = distance - cover.blocked * 2.5;
      if (bot.health < 48) score -= Math.min(targetDistance, 490) * 0.045;
      if (options.length >= 7 && score >= options.at(-1).score) continue;
      if (this.bots.some((ally) => ally !== bot && ally.alive && ally.team === bot.team
        && (ally.position.distanceToSquared(cover.point) < 3.1
          || (ally.state === 'cover' && ally.coverPoint.distanceToSquared(cover.point) < 2.7)))) continue;
      const low = this.probe.copy(cover.point).addScaledVector(Vector3UnitY, 0.8);
      if (this.canSee(low, threat)) continue;
      const tall = this.probe.setY(cover.point.y + 1.58);
      if (!this.canSee(tall, threat)) score += 5;
      options.push({ cover, score });
      options.sort((a, b) => a.score - b.score);
      if (options.length > 7) options.pop();
    }
    for (const { cover } of options) {
      const route = this.nav.route(bot.position, cover.point);
      if (route.length === 0 || route.at(-1).distanceToSquared(cover.point) > 1.7) continue;
      bot.coverPoint.copy(cover.point);
      this.assignPath(bot, cover.point, route, 'cover');
      bot.coverUntil = this.time + 2 + this.random() * 1.8;
      return true;
    }
    return false;
  }

  peek(bot) {
    const index = this.nav.nearest(bot.coverPoint);
    if (index < 0) return false;
    const x = index % this.nav.width;
    const z = Math.floor(index / this.nav.width);
    const threat = this.targetPoint.copy(bot.memory).addScaledVector(Vector3UnitY, 1.38);
    for (let distance = 1; distance <= 2; distance += 1) {
      for (const [dx, dz] of NEIGHBORS) {
        const a = x + dx * distance;
        const b = z + dz * distance;
        if (a < 0 || b < 0 || a >= this.nav.width || b >= this.nav.depth) continue;
        const candidate = b * this.nav.width + a;
        if (!this.nav.walkable[candidate]) continue;
        const position = this.nav.point(candidate, this.peekPoint);
        const eye = this.probe.copy(position).addScaledVector(Vector3UnitY, 1.48);
        if (!this.canSee(eye, threat)) continue;
        const route = this.nav.route(bot.position, position);
        if (route.length > 5 || route.length === 0 || route.at(-1).distanceToSquared(position) > 1.7) continue;
        this.assignPath(bot, position, route, 'peek');
        bot.peekUntil = this.time + 1.8 + this.random() * 0.9;
        return true;
      }
    }
    return false;
  }

  assignPath(bot, goal, route, state) {
    bot.destination.copy(goal);
    bot.path = route;
    bot.pathIndex = 0;
    bot.state = state;
    bot.progressAt = this.time + 0.7;
    bot.progressX = bot.position.x;
    bot.progressZ = bot.position.z;
  }

  plan(bot) {
    const sees = bot.visibleTarget !== null;
    const remembered = this.time - Math.max(bot.seenAt, bot.heardAt) < 8.5;
    const distance = bot.position.distanceTo(bot.memory);
    bot.planAt = this.time + 0.48 + this.random() * 0.55;

    if (bot.state === 'peek') {
      if (this.time < bot.peekUntil) return;
      this.assignPath(bot, bot.coverPoint, this.nav.route(bot.position, bot.coverPoint), 'cover');
      bot.coverUntil = this.time + 1.25 + this.random() * 0.85;
      return;
    }
    if (bot.state === 'cover') {
      if (bot.pathIndex < bot.path.length && this.time < bot.coverUntil + 2) return;
      if (this.time < bot.coverUntil && remembered) {
        if (bot.reloading || this.time < bot.coverUntil - 0.7 || sees) return;
        if (this.peek(bot)) return;
      }
    }

    if (sees && distance < 43) {
      if ((bot.health < 48 || this.time - bot.alertAt < 0.9 || bot.magazine < 5 || this.random() < 0.18)
        && distance > 8 && this.chooseCover(bot)) return;
      bot.state = 'engage';
      bot.path.length = 0;
      bot.pathIndex = 0;
      return;
    }

    if (remembered && bot.pathIndex < bot.path.length && bot.destination.distanceToSquared(bot.memory) < 13) return;
    const goal = bot.goal;
    let state = 'patrol';
    if (remembered) {
      goal.copy(bot.memory);
      state = sees ? 'advance' : 'investigate';
      if (!sees && distance > 14 && distance < 42 && bot.flank && this.random() < 0.45) {
        goal.x += bot.flank * (9 + this.random() * 6);
        goal.z += (bot.team === 0 ? -1 : 1) * (4 + this.random() * 8);
        state = 'flank';
      } else if (distance < 2.8) {
        goal.x += (this.random() - 0.5) * 13;
        goal.z += (this.random() - 0.5) * 13;
        state = 'search';
      }
    } else {
      if (bot.pathIndex < bot.path.length && bot.state === 'patrol') return;
      const approach = bot.team === 0 ? 1 : -1;
      const flank = bot.flank;
      const stage = bot.patrolStage++;
      if (stage === 0) {
        goal.set(flank * 29, 0, approach * (flank ? 22 : 12));
      } else if (stage === 1) {
        goal.set(flank * 27, 0, -approach * 3);
      } else {
        goal.set((this.random() - 0.5) * 25, 0, -approach * (8 + this.random() * 24));
      }
    }
    const route = this.nav.route(bot.position, goal);
    this.assignPath(bot, goal, route, state);
  }

  follow(bot) {
    const wish = this.wish.set(0, 0, 0);
    while (bot.pathIndex < bot.path.length) {
      const next = bot.path[bot.pathIndex];
      wish.copy(next).sub(bot.position).setY(0);
      if (wish.lengthSq() > 0.27) break;
      bot.pathIndex += 1;
      wish.set(0, 0, 0);
    }
    if (bot.pathIndex < bot.path.length && this.time > bot.progressAt) {
      bot.progressAt = this.time + 0.7;
      const movement = Math.hypot(bot.position.x - bot.progressX, bot.position.z - bot.progressZ);
      bot.progressX = bot.position.x;
      bot.progressZ = bot.position.z;
      if (movement < 0.25) {
        bot.pathIndex = bot.path.length;
        bot.planAt = Math.min(bot.planAt, this.time + 0.08);
      } else if (bot.pathIndex + 3 < bot.path.length) {
        // Skip several cells only when the controller has room along the cut.
        const next = bot.path[bot.pathIndex + 3];
        const travel = this.moveProbe.copy(next).sub(bot.position);
        if (Math.abs(travel.y) < 0.07
          && !this.physics.sweepCapsule(bot.position, travel, bot.controller.radius + 0.05, 1.75)) {
          bot.pathIndex += 3;
          wish.copy(next).sub(bot.position).setY(0);
        }
      }
    }
    if (wish.lengthSq() < 0.001) return wish;
    wish.normalize();
    for (const ally of this.bots) {
      if (ally === bot || !ally.alive || ally.team !== bot.team) continue;
      const dx = bot.position.x - ally.position.x;
      const dz = bot.position.z - ally.position.z;
      const range = dx * dx + dz * dz;
      if (range < 1.4 && range > 0.005) {
        wish.x += dx * (1.4 - range) * 0.7;
        wish.z += dz * (1.4 - range) * 0.7;
      }
    }
    return wish.clampLength(0, 1);
  }

  engage(bot, config) {
    const target = bot.visibleTarget;
    const finishingBurst = !target && bot.burst > 0 && bot.state === 'engage' && this.time - bot.seenAt < 0.55;
    if ((!target?.alive && !finishingBurst) || bot.reloading || bot.magazine <= 0
      || this.time < Math.max(bot.shootAt, bot.aimSince)) return;
    const origin = this.origin.copy(bot.position).addScaledVector(Vector3UnitY, bot.height * 0.77);
    const aim = this.aimPoint.copy(bot.observed);
    if (finishingBurst ? this.isObscured(origin, aim) : !this.canSee(origin, aim)) return;
    const muzzle = bot.rig.muzzle(this.fireOrigin);
    if (this.physics.segmentCast(origin, muzzle)) return;
    const direction = this.ray.copy(aim).sub(muzzle);
    const distance = direction.length();
    if (distance > config.range + 2 || distance < 0.25) return;
    const azimuth = Math.atan2(-direction.x, -direction.z);
    const aimError = Math.abs(Math.atan2(Math.sin(azimuth - bot.yaw), Math.cos(azimuth - bot.yaw)));
    if (aimError > 0.105) return;
    if (bot.burst === 0) bot.burst = 2 + Math.floor(this.random() * 4);
    direction.normalize();
    const spread = config.spread * ((finishingBurst ? 1.45 : 1) + Math.min(1, bot.velocity.length() * 0.1) + bot.kick * 0.45);
    direction.x += (this.random() + this.random() - 1) * spread;
    direction.y += (this.random() + this.random() - 1) * spread * 0.85;
    direction.z += (this.random() - 0.5) * spread;
    direction.normalize();
    bot.burst -= 1;
    bot.magazine -= 1;
    bot.kick = Math.min(1.1, bot.kick + 0.53);
    bot.shootAt = this.time + (bot.burst ? 0.105 + this.random() * 0.045 : config.burstPause + this.random() * 0.55);
    this.onFire(bot, muzzle, direction);
    this.hear(muzzle, bot.team, 43);
  }

  step(dt, player, elapsed, difficulty = 'normal') {
    this.time = elapsed;
    this.frame += 1;
    this.shareReports();
    const config = DIFFICULTY[difficulty] ?? DIFFICULTY.normal;
    for (const bot of this.bots) {
      if (!bot.alive) {
        bot.rig.tumble(this.physics, dt);
        continue;
      }
      bot.clock += dt;
      bot.kick *= Math.exp(-dt * 9);
      if (bot.reloading) {
        bot.reloading = Math.max(0, bot.reloading - dt);
        if (bot.reloading === 0) bot.magazine = 30;
      } else if (bot.magazine === 0 || (bot.magazine < 8 && !bot.visibleTarget)) {
        bot.reloading = 1.85 + this.random() * 0.34;
        bot.burst = 0;
      }
      if (this.time >= bot.thinkAt) {
        bot.thinkAt = this.time + 0.11 + this.random() * 0.09;
        this.findTarget(bot, player, config);
      }
      if (this.time >= bot.planAt) this.plan(bot);

      const wish = this.follow(bot);
      const stationary = wish.lengthSq() < 0.05;
      const threatAge = this.time - Math.max(bot.seenAt, bot.heardAt);
      if (bot.visibleTarget) {
        this.targetPoint.copy(bot.observed).sub(bot.position);
        this.targetPoint.y -= bot.height * 0.77;
        bot.yaw = turnToward(bot.yaw, Math.atan2(-this.targetPoint.x, -this.targetPoint.z), dt * 5.9);
        const pitch = Math.atan2(this.targetPoint.y, Math.hypot(this.targetPoint.x, this.targetPoint.z));
        bot.pitch += (pitch - bot.pitch) * Math.min(dt * 10, 1);
      } else if (!stationary) {
        bot.yaw = turnToward(bot.yaw, Math.atan2(-wish.x, -wish.z), dt * 4.8);
        bot.pitch *= Math.exp(-dt * 7);
      } else if (threatAge < 7) {
        const angle = Math.atan2(bot.position.x - bot.memory.x, bot.position.z - bot.memory.z);
        bot.yaw = turnToward(bot.yaw, angle + Math.sin(bot.clock * 2.4) * 0.32, dt * 3.9);
      } else {
        bot.yaw += Math.sin(bot.clock * 2.8 + bot.phase) * dt * 0.87;
      }

      if (stationary && bot.state === 'engage' && bot.visibleTarget && !bot.reloading) {
        const strafe = Math.sin(bot.clock * 1.45 + bot.phase);
        if (Math.abs(strafe) > 0.7) wish.set(Math.cos(bot.yaw), 0, -Math.sin(bot.yaw)).multiplyScalar(strafe * 0.35);
      }
      const crouch = (bot.state === 'cover' && stationary && !bot.visibleTarget)
        || (bot.state === 'engage' && (bot.slot % 2 === 0 || bot.health < 55) && bot.clock % 4.9 > 2.0);
      const speed = crouch ? 2.2 : bot.visibleTarget ? 3.15 : bot.state === 'flank' ? 4.9 : 4.22;
      bot.controller.step(dt, { wish, speed, crouch });
      bot.height = bot.controller.height;
      this.engage(bot, config);
      if (bot.alive && this.frame % 2 === 0) {
        if (player) bot.rig.setDetail(bot.position.distanceToSquared(player.position));
        const contact = bot.rig.pose(bot, this.physics, dt * 2);
        if (contact) {
          this.onStep(bot, contact);
          this.hear(bot.position, bot.team, crouch ? 4.5 : 9);
        }
      }
    }
  }

  present(alpha) {
    const blend = ((this.frame % 2) + alpha) * .5;
    for (const bot of this.bots) if (bot.alive) bot.rig.presentation.apply(blend);
  }

  restorePresentation() {
    for (const bot of this.bots) bot.rig.presentation.restore();
  }

  dispose() {
    for (const bot of this.bots) bot.rig.dispose();
    this.bots.length = 0;
    this.reports.length = 0;
  }
}

const Vector3UnitY = new Vector3(0, 1, 0);
