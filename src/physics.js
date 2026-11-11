import { Vector3 } from 'three';

const UP = new Vector3(0, 1, 0);
const CONTACT_SKIN = 0.002;
const SURFACE_EPSILON = 0.00001;
const BIN_COUNT = 12;
const GROUND = { surface: 'asphalt' };

function emptyBounds() {
  return { min: new Vector3(Infinity, Infinity, Infinity), max: new Vector3(-Infinity, -Infinity, -Infinity) };
}

function extendBounds(bounds, other) {
  bounds.min.min(other.min);
  bounds.max.max(other.max);
  return bounds;
}

function area(bounds) {
  const x = bounds.max.x - bounds.min.x;
  const y = bounds.max.y - bounds.min.y;
  const z = bounds.max.z - bounds.min.z;
  return 2 * (x * y + x * z + y * z);
}

function buildNode(items) {
  const bounds = emptyBounds();
  const centers = emptyBounds();
  for (const item of items) {
    extendBounds(bounds, item.collider);
    centers.min.min(item.center);
    centers.max.max(item.center);
  }
  if (items.length <= 5) return { ...bounds, items };

  let best = null;
  let bestCost = items.length * area(bounds);
  for (let axis = 0; axis < 3; axis += 1) {
    const start = centers.min.getComponent(axis);
    const width = centers.max.getComponent(axis) - start;
    if (width < 0.0001) continue;
    const buckets = Array.from({ length: BIN_COUNT }, () => ({ ...emptyBounds(), count: 0 }));
    const scale = BIN_COUNT / width;
    for (const item of items) {
      const index = Math.min(BIN_COUNT - 1, Math.floor((item.center.getComponent(axis) - start) * scale));
      extendBounds(buckets[index], item.collider);
      buckets[index].count += 1;
    }
    const rightBounds = emptyBounds();
    const rightCount = new Uint32Array(BIN_COUNT);
    const rightArea = new Float64Array(BIN_COUNT);
    let count = 0;
    for (let index = BIN_COUNT - 1; index > 0; index -= 1) {
      if (buckets[index].count) extendBounds(rightBounds, buckets[index]);
      count += buckets[index].count;
      rightCount[index] = count;
      rightArea[index] = count ? area(rightBounds) : 0;
    }
    const leftBounds = emptyBounds();
    count = 0;
    for (let index = 0; index < BIN_COUNT - 1; index += 1) {
      if (buckets[index].count) extendBounds(leftBounds, buckets[index]);
      count += buckets[index].count;
      if (!count || !rightCount[index + 1]) continue;
      const cost = area(bounds) + count * area(leftBounds) + rightCount[index + 1] * rightArea[index + 1];
      if (cost >= bestCost) continue;
      bestCost = cost;
      best = { axis, split: start + (index + 1) / scale };
    }
  }
  if (!best) return { ...bounds, items };

  const left = [];
  const right = [];
  for (const item of items) {
    (item.center.getComponent(best.axis) < best.split ? left : right).push(item);
  }
  if (!left.length || !right.length) return { ...bounds, items };
  return { ...bounds, left: buildNode(left), right: buildNode(right) };
}

// The capsule's center segment is vertical, so translating the obstacle along
// that segment reduces a capsule cast to a point cast against a rounded box.
function slab(origin, delta, box, maxTime, interval, radius = 0, height = 0, extents = null) {
  let near = -Infinity;
  let far = Infinity;
  let side = 0;
  let sign = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    const start = origin.getComponent(axis);
    const movement = delta.getComponent(axis);
    const vertical = axis === 1;
    const extent = extents?.getComponent(axis);
    const lower = box.min.getComponent(axis) - (extent ?? (vertical ? (height || radius) : radius));
    const upper = box.max.getComponent(axis) + (extent ?? (vertical ? (height ? 0 : radius) : radius));
    if (Math.abs(movement) < 1e-10) {
      if (start < lower || start > upper) return false;
      continue;
    }
    const lowTime = (lower - start) / movement;
    const highTime = (upper - start) / movement;
    const entry = Math.min(lowTime, highTime);
    if (entry > near) {
      near = entry;
      side = axis;
      sign = movement > 0 ? -1 : 1;
    }
    far = Math.min(far, Math.max(lowTime, highTime));
    if (near > far) return false;
  }
  if (near > maxTime || far < 0) return false;
  interval.near = Math.max(near, 0);
  interval.entry = near;
  interval.far = far;
  interval.side = side;
  interval.sign = sign;
  return true;
}

function signedBoxDistance(point, box, normal, radius, height) {
  const minY = box.min.y - (height ? height - radius : 0);
  const maxY = box.max.y - (height ? radius : 0);
  const x = point.x - Math.min(box.max.x, Math.max(box.min.x, point.x));
  const y = point.y - Math.min(maxY, Math.max(minY, point.y));
  const z = point.z - Math.min(box.max.z, Math.max(box.min.z, point.z));
  normal.set(x, y, z);
  const distanceSquared = normal.lengthSq();
  if (distanceSquared > 0) {
    const distance = Math.sqrt(distanceSquared);
    normal.multiplyScalar(1 / distance);
    return distance;
  }

  let face = point.x - box.min.x;
  normal.set(-1, 0, 0);
  if (box.max.x - point.x < face) {
    face = box.max.x - point.x;
    normal.set(1, 0, 0);
  }
  if (point.y - minY < face) {
    face = point.y - minY;
    normal.set(0, -1, 0);
  }
  if (maxY - point.y < face) {
    face = maxY - point.y;
    normal.set(0, 1, 0);
  }
  if (point.z - box.min.z < face) {
    face = point.z - box.min.z;
    normal.set(0, 0, -1);
  }
  if (box.max.z - point.z < face) {
    face = box.max.z - point.z;
    normal.set(0, 0, 1);
  }
  return -face;
}

export class StaticBVH {
  constructor(colliders) {
    this.colliders = colliders;
    this.root = colliders.length ? buildNode(colliders.map((collider) => ({
      collider,
      center: new Vector3().addVectors(collider.min, collider.max).multiplyScalar(0.5),
    }))) : null;
    this.stack = [];
    this.interval = {};
    this.sample = new Vector3();
    this.normal = new Vector3();
  }

  raycast(origin, direction, maxDistance = Infinity, ignore = null) {
    const interval = this.interval;
    let distance = maxDistance;
    let collider = null;
    let side = 0;
    let sign = 0;
    let exitDistance = maxDistance;
    if (direction.y < -1e-10 && origin.y >= 0) {
      const groundDistance = -origin.y / direction.y;
      if (groundDistance <= distance) {
        distance = groundDistance;
        exitDistance = groundDistance;
        collider = GROUND;
        side = 1;
        sign = 1;
      }
    }

    const stack = this.stack;
    stack.length = 0;
    if (this.root) stack.push(this.root);
    while (stack.length) {
      const node = stack.pop();
      if (!slab(origin, direction, node, distance, interval)) continue;
      if (!node.items) {
        stack.push(node.left, node.right);
        continue;
      }
      for (const item of node.items) {
        const candidate = item.collider;
        if (candidate === ignore || !slab(origin, direction, candidate, distance, interval)) continue;
        collider = candidate;
        distance = interval.near;
        exitDistance = interval.far;
        side = interval.side;
        sign = interval.sign;
      }
    }

    if (!collider) return null;
    const normal = new Vector3().setComponent(side, sign);
    return {
      distance,
      exitDistance,
      normal,
      point: origin.clone().addScaledVector(direction, distance),
      surface: collider.surface ?? 'concrete',
      material: collider.surface ?? 'concrete',
      collider,
    };
  }

  segmentCast(start, end, ignore) {
    const direction = end.clone().sub(start);
    const distance = direction.length();
    if (distance < 1e-10) return null;
    return this.raycast(start, direction.multiplyScalar(1 / distance), distance, ignore);
  }

  sphereCast(center, displacement, radius) {
    return this.sweep(center, displacement, radius, 0);
  }

  sweepCapsule(feet, displacement, radius, height) {
    return this.sweep(feet, displacement, radius, Math.max(radius * 2, height));
  }

  sweep(origin, displacement, radius, height) {
    const interval = this.interval;
    const sample = this.sample;
    const normal = this.normal;
    const startHeight = origin.y - (height ? 0 : radius);
    let fraction = 1;
    let hit = null;
    if (displacement.y < -1e-10 && startHeight + displacement.y <= 0) {
      fraction = Math.max(0, -startHeight / displacement.y);
      hit = { fraction, normal: UP.clone(), surface: 'asphalt', collider: GROUND };
    }

    const stack = this.stack;
    stack.length = 0;
    if (this.root) stack.push(this.root);
    while (stack.length) {
      const node = stack.pop();
      if (!slab(origin, displacement, node, fraction, interval, radius, height)) continue;
      if (!node.items) {
        stack.push(node.left, node.right);
        continue;
      }
      for (const item of node.items) {
        const collider = item.collider;
        if (!slab(origin, displacement, collider, fraction, interval, radius, height)) continue;
        let time = interval.near;
        const end = Math.min(fraction, interval.far);
        for (let iteration = 0; iteration < 14 && time <= end + SURFACE_EPSILON; iteration += 1) {
          sample.copy(origin).addScaledVector(displacement, time);
          const clearance = signedBoxDistance(sample, collider, normal, radius, height) - radius;
          const closing = -displacement.dot(normal);
          if (closing < 1e-9) break;
          if (clearance < SURFACE_EPSILON) {
            fraction = Math.min(fraction, time);
            hit = { fraction, normal: normal.clone(), surface: collider.surface, collider };
            break;
          }
          time += clearance / closing;
        }
      }
    }
    if (hit) {
      hit.point = origin.clone().addScaledVector(displacement, hit.fraction);
      hit.distance = displacement.length() * hit.fraction;
      hit.material = hit.surface;
    }
    return hit;
  }

  sweepBox(center, displacement, halfExtents) {
    let fraction = 1;
    let collider = null;
    let axis = 1;
    let sign = 1;
    const height = center.y - halfExtents.y;
    if (displacement.y < 0 && height + displacement.y <= 0) {
      fraction = Math.max(0, -height / displacement.y);
      collider = GROUND;
    }
    const stack = this.stack;
    const interval = this.interval;
    stack.length = 0;
    if (this.root) stack.push(this.root);
    while (stack.length) {
      const node = stack.pop();
      if (!slab(center, displacement, node, fraction, interval, 0, 0, halfExtents)) continue;
      if (!node.items) {
        stack.push(node.left, node.right);
        continue;
      }
      for (const item of node.items) {
        if (!slab(center, displacement, item.collider, fraction, interval, 0, 0, halfExtents)) continue;
        if (interval.entry < -SURFACE_EPSILON || interval.far < SURFACE_EPSILON) continue;
        fraction = interval.near;
        axis = interval.side;
        sign = interval.sign;
        collider = item.collider;
      }
    }
    if (!collider) return null;
    return {
      fraction, collider, surface: collider.surface,
      normal: new Vector3().setComponent(axis, sign),
      point: center.clone().addScaledVector(displacement, fraction),
    };
  }

  overlapBox(center, halfExtents) {
    const belowGround = halfExtents.y - center.y;
    let deepest = Math.max(0, belowGround);
    let collider = deepest > 0 ? GROUND : null;
    let axis = 1;
    let sign = 1;
    const stack = this.stack;
    stack.length = 0;
    if (this.root) stack.push(this.root);
    while (stack.length) {
      const node = stack.pop();
      if (!this.nearBox(center, halfExtents, node)) continue;
      if (!node.items) {
        stack.push(node.left, node.right);
        continue;
      }
      for (const item of node.items) {
        const candidate = item.collider;
        if (!this.nearBox(center, halfExtents, candidate)) continue;
        let depth = Infinity;
        let side = 0;
        let direction = 0;
        for (let component = 0; component < 3; component += 1) {
          const position = center.getComponent(component);
          const half = halfExtents.getComponent(component);
          const before = position + half - candidate.min.getComponent(component);
          const after = candidate.max.getComponent(component) - (position - half);
          if (Math.min(before, after) >= depth) continue;
          depth = Math.min(before, after);
          side = component;
          direction = before < after ? -1 : 1;
        }
        if (depth <= deepest) continue;
        deepest = depth;
        axis = side;
        sign = direction;
        collider = candidate;
      }
    }
    return collider ? { depth: deepest, normal: new Vector3().setComponent(axis, sign), collider } : null;
  }

  nearBox(center, half, box) {
    return center.x + half.x > box.min.x && center.x - half.x < box.max.x
      && center.y + half.y > box.min.y && center.y - half.y < box.max.y
      && center.z + half.z > box.min.z && center.z - half.z < box.max.z;
  }

  overlapCapsule(feet, radius, height) {
    const normal = this.normal;
    let overlap = feet.y < 0 ? { depth: -feet.y, normal: UP.clone(), collider: GROUND } : null;
    let deepest = overlap?.depth ?? 0;
    const stack = this.stack;
    stack.length = 0;
    if (this.root) stack.push(this.root);
    while (stack.length) {
      const node = stack.pop();
      if (!this.nearCapsule(feet, radius, height, node)) continue;
      if (!node.items) {
        stack.push(node.left, node.right);
        continue;
      }
      for (const item of node.items) {
        const collider = item.collider;
        if (!this.nearCapsule(feet, radius, height, collider)) continue;
        const depth = radius - signedBoxDistance(feet, collider, normal, radius, height);
        if (depth <= deepest + SURFACE_EPSILON) continue;
        deepest = depth;
        overlap = { depth, normal: normal.clone(), collider };
      }
    }
    return overlap;
  }

  overlapsCapsule(feet, radius, height) {
    return this.overlapCapsule(feet, radius, height) !== null;
  }

  nearCapsule(feet, radius, height, box) {
    return feet.x + radius > box.min.x && feet.x - radius < box.max.x
      && feet.z + radius > box.min.z && feet.z - radius < box.max.z
      && feet.y + height > box.min.y && feet.y < box.max.y;
  }

  closestPoint(point, maxDistance = Infinity) {
    let distance = Math.min(Math.abs(point.y), maxDistance);
    let closest = Math.abs(point.y) <= maxDistance ? new Vector3(point.x, 0, point.z) : null;
    let surface = 'asphalt';
    const stack = this.stack;
    const sample = this.sample;
    stack.length = 0;
    if (this.root) stack.push(this.root);
    while (stack.length) {
      const node = stack.pop();
      if (sample.copy(point).clamp(node.min, node.max).distanceToSquared(point) > distance * distance) continue;
      if (!node.items) {
        stack.push(node.left, node.right);
        continue;
      }
      for (const item of node.items) {
        const collider = item.collider;
        sample.copy(point).clamp(collider.min, collider.max);
        const candidateDistance = sample.distanceTo(point);
        if (candidateDistance > distance) continue;
        distance = candidateDistance;
        closest = sample.clone();
        surface = collider.surface;
      }
    }
    return closest ? { point: closest, distance, surface } : null;
  }
}

export class CharacterController {
  constructor(physics, feet = new Vector3()) {
    this.physics = physics;
    this.position = feet.clone();
    this.velocity = new Vector3();
    this.radius = 0.32;
    this.height = 1.77;
    this.grounded = true;
    this.surface = 'asphalt';
    this.stepSurface = null;
    this.landed = 0;
    this.mantleTime = 0;
    this.mantleStart = new Vector3();
    this.mantleEnd = new Vector3();
    this.wishVelocity = new Vector3();
    this.move = new Vector3();
    this.remaining = new Vector3();
    this.temp = new Vector3();
    this.down = new Vector3();
    this.stepTop = new Vector3();
  }

  teleport(feet) {
    this.position.copy(feet);
    this.velocity.set(0, 0, 0);
    this.height = 1.77;
    this.mantleTime = 0;
    this.grounded = true;
    this.stepSurface = null;
    this.landed = 0;
    this.resolveOverlap();
  }

  resolveOverlap() {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const overlap = this.physics.overlapCapsule(this.position, this.radius, this.height);
      if (!overlap) break;
      this.position.addScaledVector(overlap.normal, overlap.depth + CONTACT_SKIN);
    }
  }

  startMantle(wish) {
    if (!this.grounded || wish.lengthSq() < 0.01) return false;
    const probe = this.temp.copy(this.position).addScaledVector(UP, 0.65);
    const direction = this.wishVelocity.copy(wish).setY(0).normalize();
    const ledge = this.physics.raycast(probe, direction, 0.95);
    if (!ledge?.collider.max || Math.abs(ledge.normal.y) > 0.1) return false;
    const top = ledge.collider.max.y;
    const gain = top - this.position.y;
    if (gain < 0.36 || gain > 1.25) return false;
    this.mantleEnd.copy(ledge.point).addScaledVector(direction, this.radius + 0.09).setY(top + CONTACT_SKIN);
    if (this.physics.overlapsCapsule(this.mantleEnd, this.radius, this.height)) return false;
    this.stepTop.copy(this.position).setY(this.mantleEnd.y);
    if (this.physics.overlapsCapsule(this.stepTop, this.radius, this.height)) return false;
    if (this.physics.sweepCapsule(this.position, this.move.copy(this.stepTop).sub(this.position), this.radius, this.height)) return false;
    if (this.physics.sweepCapsule(this.stepTop, this.move.copy(this.mantleEnd).sub(this.stepTop), this.radius, this.height)) return false;
    this.mantleStart.copy(this.position);
    this.mantleTime = 0.29;
    this.velocity.set(0, 0, 0);
    this.grounded = false;
    return true;
  }

  tryStep(horizontal) {
    const stepHeight = 0.36;
    const up = this.temp.set(0, stepHeight, 0);
    if (this.physics.sweepCapsule(this.position, up, this.radius, this.height)) return false;
    const top = this.stepTop.copy(this.position).add(up);
    if (this.physics.sweepCapsule(top, horizontal, this.radius, this.height)) return false;
    top.add(horizontal);
    const down = this.down.set(0, -stepHeight - 0.10, 0);
    const support = this.physics.sweepCapsule(top, down, this.radius, this.height);
    if (!support || support.normal.y < 0.2) return false;
    this.position.copy(top).addScaledVector(down, support.fraction).addScaledVector(support.normal, CONTACT_SKIN);
    this.surface = support.surface ?? 'concrete';
    this.stepSurface = support.collider;
    return true;
  }

  slide(displacement, canStep) {
    const remaining = this.remaining.copy(displacement);
    for (let iteration = 0; iteration < 4 && remaining.lengthSq() > 1e-10; iteration += 1) {
      const hit = this.physics.sweepCapsule(this.position, remaining, this.radius, this.height);
      if (!hit) {
        this.position.add(remaining);
        return;
      }
      const ledgeHeight = (hit.collider.max?.y ?? Infinity) - this.position.y;
      if (canStep && iteration === 0 && ledgeHeight > 0.01 && ledgeHeight < 0.36 && this.tryStep(remaining)) return;
      const length = remaining.length();
      const safeFraction = Math.max(0, hit.fraction - CONTACT_SKIN / length);
      this.position.addScaledVector(remaining, safeFraction);
      remaining.multiplyScalar(1 - hit.fraction);
      remaining.addScaledVector(hit.normal, Math.max(0, -remaining.dot(hit.normal)));
      const push = Math.max(0, -this.velocity.dot(hit.normal));
      this.velocity.addScaledVector(hit.normal, push);
    }
  }

  step(dt, { wish, speed = 4.6, jump = false, crouch = false, mantle = false, maxAcceleration, maxBraking }) {
    this.landed = 0;
    if (!this.mantleTime && mantle) this.startMantle(wish);
    if (this.mantleTime > 0) {
      this.mantleTime = Math.max(0, this.mantleTime - dt);
      const progress = 1 - this.mantleTime / 0.29;
      const across = Math.min(1, Math.max(0, (progress - 0.48) / 0.52));
      const up = Math.min(1, progress / 0.48);
      this.position.lerpVectors(this.mantleStart, this.mantleEnd, across * across * (3 - 2 * across));
      this.position.y = this.mantleStart.y + (this.mantleEnd.y - this.mantleStart.y) * up * up * (3 - 2 * up);
      if (this.mantleTime === 0) this.grounded = true;
      return;
    }

    const nextHeight = this.height + ((crouch ? 1.16 : 1.77) - this.height) * Math.min(1, dt * 16);
    if (nextHeight <= this.height || !this.physics.overlapsCapsule(this.position, this.radius, nextHeight)) {
      this.height = nextHeight;
    }
    const target = this.wishVelocity.copy(wish).setY(0).clampLength(0, 1).multiplyScalar(speed);
    const response = 1 - Math.exp(-dt * (this.grounded ? (target.lengthSq() > 0 ? 17 : 22) : 3.8));
    let dx = (target.x - this.velocity.x) * response;
    let dz = (target.z - this.velocity.z) * response;
    if (maxAcceleration !== undefined) {
      const braking = dx * this.velocity.x + dz * this.velocity.z < 0;
      const budget = (braking ? maxBraking ?? maxAcceleration : maxAcceleration) * dt;
      const change = Math.hypot(dx, dz);
      if (change > budget) {
        dx *= budget / change;
        dz *= budget / change;
      }
    }
    this.velocity.x += dx;
    this.velocity.z += dz;
    if (jump && this.grounded && !crouch) {
      this.grounded = false;
      this.stepSurface = null;
      this.velocity.y = 5.15;
    }

    this.slide(this.move.set(this.velocity.x * dt, 0, this.velocity.z * dt), this.grounded);
    const wasGrounded = this.grounded;
    this.velocity.y = wasGrounded ? Math.min(0, this.velocity.y) : Math.max(-30, this.velocity.y - dt * 15.8);
    const moveY = this.velocity.y * dt - (wasGrounded ? 0.16 : 0);
    const down = this.move.set(0, moveY, 0);
    const floor = this.physics.sweepCapsule(this.position, down, this.radius, this.height);
    const stepEdge = floor?.collider === this.stepSurface && floor.normal.y > 0.2;
    this.grounded = Boolean(floor && (floor.normal.y > 0.62 || stepEdge) && moveY <= 0);
    if (floor?.collider !== this.stepSurface) this.stepSurface = null;
    if (floor) {
      this.position.addScaledVector(down, floor.fraction).addScaledVector(floor.normal, CONTACT_SKIN);
      if (this.grounded) {
        this.surface = floor.surface ?? 'concrete';
        if (!wasGrounded) this.landed = -this.velocity.y;
      }
      if (this.grounded || floor.normal.y < -0.4) this.velocity.y = 0;
    } else {
      this.position.add(down);
      if (wasGrounded) this.velocity.y = 0;
    }
  }
}
