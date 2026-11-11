import { Matrix4, Quaternion, Vector3 } from 'three';

const GRAVITY = 14.2;
const CELL_SIZE = 1.4;
const SKIN = 0.00055;
const MAX_BODIES = 48;
const RIGHT = new Vector3(1, 0, 0);
const UP = new Vector3(0, 1, 0);

function newContact() {
  return {
    normal: new Vector3(), tangent: new Vector3(), point: new Vector3(),
    normalImpulse: 0, tangentImpulse: 0, bounce: 0, penetration: 0,
    a: null, b: null, key: 0,
  };
}

export class RigidWorld {
  constructor(physics) {
    this.physics = physics;
    this.bodies = [];
    this.cells = new Map();
    this.pairs = new Set();
    this.cache = new Map();
    this.contacts = [];
    this.contactCount = 0;
    this.frame = 0;
    this.staticContact = newContact();
    this.matrix = new Matrix4();
    this.rotation = new Quaternion();
    this.delta = new Vector3();
    this.relative = new Vector3();
    this.velocityA = new Vector3();
    this.velocityB = new Vector3();
    this.arm = new Vector3();
    this.angular = new Vector3();
    this.axis = new Vector3();
    this.local = new Vector3();
    this.localDirection = new Vector3();
    this.localPoint = new Vector3();
    this.response = new Vector3();
    this.castNormal = new Vector3();
  }

  add({
    shape = 'box', position, halfExtents, radius = 0.15,
    mass = 1, surface = 'wood', mesh = null, restitution = 0.23, friction = 0.58,
    quaternion = mesh?.quaternion,
  }) {
    if (this.bodies.length >= MAX_BODIES) return null;
    const center = position.clone();
    const rotation = quaternion?.clone() ?? new Quaternion();
    const half = shape === 'sphere' ? new Vector3(radius, radius, radius) : halfExtents.clone();
    const invMass = 1 / Math.max(0.01, mass);
    const inverseInertia = shape === 'sphere'
      ? new Vector3().setScalar(2.5 * invMass / (radius * radius))
      : new Vector3(
        3 * invMass / (half.y ** 2 + half.z ** 2),
        3 * invMass / (half.x ** 2 + half.z ** 2),
        3 * invMass / (half.x ** 2 + half.y ** 2),
      );
    const body = {
      id: this.bodies.length, shape, radius, surface, mesh, restitution, friction, invMass, inverseInertia,
      position: center, rotation, inverseRotation: new Quaternion(), half,
      home: center.clone(), orientation: rotation.clone(), extent: half.clone(),
      velocity: new Vector3(), spin: new Vector3(), sleeping: false, supported: false, restTime: 0,
      supportBody: null, staticSupported: false, supportContact: newContact(),
    };
    body.supportContact.a = body;
    this.bodies.push(body);
    this.updateBounds(body);
    this.syncMesh(body);
    return body;
  }

  get activeCount() {
    let count = 0;
    for (const body of this.bodies) if (!body.sleeping) count += 1;
    return count;
  }

  reset() {
    this.cache.clear();
    for (const body of this.bodies) {
      body.position.copy(body.home);
      body.rotation.copy(body.orientation);
      body.velocity.set(0, 0, 0);
      body.spin.set(0, 0, 0);
      body.sleeping = false;
      body.restTime = 0;
      body.supported = body.staticSupported = false;
      body.supportBody = null;
      this.updateBounds(body);
      this.syncMesh(body);
    }
  }

  updateBounds(body) {
    body.inverseRotation.copy(body.rotation).invert();
    if (body.shape === 'sphere') return;
    const e = this.matrix.makeRotationFromQuaternion(body.rotation).elements;
    const { x, y, z } = body.half;
    body.extent.set(
      Math.abs(e[0]) * x + Math.abs(e[4]) * y + Math.abs(e[8]) * z,
      Math.abs(e[1]) * x + Math.abs(e[5]) * y + Math.abs(e[9]) * z,
      Math.abs(e[2]) * x + Math.abs(e[6]) * y + Math.abs(e[10]) * z,
    );
  }

  syncMesh(body) {
    if (!body.mesh) return;
    body.mesh.position.copy(body.position);
    body.mesh.quaternion.copy(body.rotation);
  }

  wake(body) {
    body.sleeping = false;
    body.restTime = 0;
  }

  impulse(body, impulse, point) {
    if (!body) return;
    this.wake(body);
    this.apply(body, impulse, point ?? body.position, 1);
    body.velocity.clampLength(0, 26);
    body.spin.clampLength(0, 20);
  }

  inertia(body, vector) {
    return vector.applyQuaternion(body.inverseRotation).multiply(body.inverseInertia).applyQuaternion(body.rotation);
  }

  apply(body, impulse, point, sign) {
    if (!body || body.sleeping) return;
    body.velocity.addScaledVector(impulse, body.invMass * sign);
    this.arm.copy(point).sub(body.position);
    this.angular.crossVectors(this.arm, impulse);
    body.spin.addScaledVector(this.inertia(body, this.angular), sign);
  }

  pointVelocity(body, point, output) {
    if (!body || body.sleeping) return output.set(0, 0, 0);
    this.arm.copy(point).sub(body.position);
    return output.crossVectors(body.spin, this.arm).add(body.velocity);
  }

  relativeVelocity(contact) {
    this.pointVelocity(contact.a, contact.point, this.velocityA);
    this.pointVelocity(contact.b, contact.point, this.velocityB);
    return this.relative.subVectors(this.velocityA, this.velocityB);
  }

  impulseMass(body, point, direction) {
    if (!body || body.sleeping) return 0;
    this.arm.copy(point).sub(body.position);
    this.axis.crossVectors(this.arm, direction);
    this.angular.copy(this.axis);
    return body.invMass + this.axis.dot(this.inertia(body, this.angular));
  }

  prepare(contact) {
    const velocity = this.relativeVelocity(contact);
    const normalSpeed = velocity.dot(contact.normal);
    const restitution = contact.b
      ? Math.min(contact.a.restitution, contact.b.restitution) : contact.a.restitution;
    contact.bounce = normalSpeed < -1.15 ? -normalSpeed * restitution : 0;
    contact.tangent.copy(velocity).addScaledVector(contact.normal, -normalSpeed);
    if (contact.tangent.lengthSq() < 1e-8) {
      contact.tangent.crossVectors(contact.normal, Math.abs(contact.normal.y) > 0.8 ? RIGHT : UP);
    }
    contact.tangent.normalize();
    contact.normalImpulse = 0;
    contact.tangentImpulse = 0;
    contact.normalMass = this.impulseMass(contact.a, contact.point, contact.normal)
      + this.impulseMass(contact.b, contact.point, contact.normal);
    contact.tangentMass = this.impulseMass(contact.a, contact.point, contact.tangent)
      + this.impulseMass(contact.b, contact.point, contact.tangent);
  }

  applyPair(contact, direction, magnitude) {
    const response = this.response.copy(direction).multiplyScalar(magnitude);
    this.apply(contact.a, response, contact.point, 1);
    this.apply(contact.b, response, contact.point, -1);
  }

  resolve(contact) {
    if (contact.normalMass < 1e-8) return;
    const velocity = this.relativeVelocity(contact);
    const normal = velocity.dot(contact.normal);
    const previousNormal = contact.normalImpulse;
    contact.normalImpulse = Math.max(0, previousNormal + (contact.bounce - normal) / contact.normalMass);
    this.applyPair(contact, contact.normal, contact.normalImpulse - previousNormal);
    const friction = contact.b ? Math.sqrt(contact.a.friction * contact.b.friction) : contact.a.friction;
    const previousTangent = contact.tangentImpulse;
    const tangent = this.relativeVelocity(contact).dot(contact.tangent);
    const limit = contact.normalImpulse * friction;
    contact.tangentImpulse = Math.min(limit, Math.max(-limit, previousTangent - tangent / Math.max(1e-8, contact.tangentMass)));
    this.applyPair(contact, contact.tangent, contact.tangentImpulse - previousTangent);
  }

  staticSweep(body, dt) {
    body.velocity.y -= GRAVITY * dt;
    const support = this.staticContact;
    support.a = body;
    let remaining = dt;
    for (let iteration = 0; iteration < 3 && remaining > 1e-5; iteration += 1) {
      this.delta.copy(body.velocity).multiplyScalar(remaining);
      const hit = body.shape === 'sphere'
        ? this.physics.sphereCast(body.position, this.delta, body.radius)
        : this.physics.sweepBox(body.position, this.delta, body.extent);
      if (!hit) {
        body.position.add(this.delta);
        break;
      }
      body.position.addScaledVector(this.delta, hit.fraction).addScaledVector(hit.normal, SKIN);
      remaining *= 1 - hit.fraction;
      if (hit.normal.y > 0.55) this.markStaticSupport(body, hit.normal);
      support.normal.copy(hit.normal);
      support.point.copy(body.position);
      const face = Math.abs(hit.normal.x) * body.extent.x
        + Math.abs(hit.normal.y) * body.extent.y + Math.abs(hit.normal.z) * body.extent.z;
      support.point.addScaledVector(hit.normal, -face);
      this.prepare(support);
      this.resolve(support);
    }

    body.spin.multiplyScalar(Math.exp(-dt * (body.supported ? 4.4 : 0.48)));
    if (body.supported) {
      body.velocity.x *= Math.exp(-dt * 2.3);
      body.velocity.z *= Math.exp(-dt * 2.3);
    }
    const speed = body.spin.length();
    if (speed > 1e-5) {
      this.axis.copy(body.spin).multiplyScalar(1 / speed);
      this.rotation.setFromAxisAngle(this.axis, speed * dt);
      body.rotation.premultiply(this.rotation).normalize();
      this.updateBounds(body);
    }

    const overlap = body.shape === 'sphere'
      ? this.physics.overlapCapsule(this.local.copy(body.position).addScaledVector(UP, -body.radius), body.radius, body.radius * 2)
      : this.physics.overlapBox(body.position, body.extent);
    if (overlap) {
      body.position.addScaledVector(overlap.normal, overlap.depth + SKIN);
      body.velocity.addScaledVector(overlap.normal, Math.max(0, -body.velocity.dot(overlap.normal)));
      if (overlap.normal.y > 0.55) this.markStaticSupport(body, overlap.normal);
    }
    if (!body.staticSupported && Math.abs(body.velocity.y) < 0.14) {
      const down = this.delta.set(0, -0.003, 0);
      const floor = body.shape === 'sphere'
        ? this.physics.sphereCast(body.position, down, body.radius)
        : this.physics.sweepBox(body.position, down, body.extent);
      if (floor?.normal.y > 0.55) this.markStaticSupport(body, floor.normal);
    }
    if (body.staticSupported) {
      const contact = body.supportContact;
      const normal = contact.normal;
      const extent = Math.abs(normal.x) * body.extent.x + Math.abs(normal.y) * body.extent.y
        + Math.abs(normal.z) * body.extent.z;
      contact.point.copy(body.position).addScaledVector(normal, -extent);
      this.prepare(contact);
      contact.bounce = 0;
    }
  }

  markStaticSupport(body, normal) {
    body.supported = body.staticSupported = true;
    body.supportContact.normal.copy(normal);
  }

  makeSphereContact(contact, a, b) {
    const difference = contact.normal.subVectors(a.position, b.position);
    const distance = difference.length();
    const depth = a.radius + b.radius - distance;
    if (depth <= 0) return false;
    if (distance < 1e-6) difference.copy(UP);
    else difference.multiplyScalar(1 / distance);
    contact.point.copy(b.position).addScaledVector(difference, b.radius - depth * 0.5);
    contact.penetration = depth;
    return true;
  }

  makeMixedContact(contact, sphere, box) {
    const relative = this.local.copy(sphere.position).sub(box.position).applyQuaternion(box.inverseRotation);
    const point = this.localPoint.copy(relative);
    point.x = Math.min(box.half.x, Math.max(-box.half.x, point.x));
    point.y = Math.min(box.half.y, Math.max(-box.half.y, point.y));
    point.z = Math.min(box.half.z, Math.max(-box.half.z, point.z));
    const normal = contact.normal.subVectors(relative, point);
    const distance = normal.length();
    if (distance > sphere.radius) return false;
    if (distance > 1e-6) {
      normal.multiplyScalar(1 / distance);
      contact.penetration = sphere.radius - distance;
    } else {
      const x = box.half.x - Math.abs(relative.x);
      const y = box.half.y - Math.abs(relative.y);
      const z = box.half.z - Math.abs(relative.z);
      const axis = x < y && x < z ? 0 : (y < z ? 1 : 2);
      const sign = relative.getComponent(axis) >= 0 ? 1 : -1;
      normal.set(0, 0, 0).setComponent(axis, sign);
      point.setComponent(axis, box.half.getComponent(axis) * sign);
      contact.penetration = sphere.radius + Math.min(x, y, z);
    }
    normal.applyQuaternion(box.rotation);
    contact.point.copy(point).applyQuaternion(box.rotation).add(box.position);
    if (contact.a !== sphere) normal.negate();
    return true;
  }

  makeBoxContact(contact, a, b) {
    const difference = this.local.subVectors(a.position, b.position);
    const x = a.extent.x + b.extent.x - Math.abs(difference.x);
    const y = a.extent.y + b.extent.y - Math.abs(difference.y);
    const z = a.extent.z + b.extent.z - Math.abs(difference.z);
    const depth = Math.min(x, y, z);
    if (depth <= 0) return false;
    const axis = x < y && x < z ? 0 : (y < z ? 1 : 2);
    contact.normal.set(0, 0, 0).setComponent(axis, difference.getComponent(axis) >= 0 ? 1 : -1);
    for (let component = 0; component < 3; component += 1) {
      const aCenter = a.position.getComponent(component);
      const bCenter = b.position.getComponent(component);
      const aHalf = a.extent.getComponent(component);
      const bHalf = b.extent.getComponent(component);
      const lower = Math.max(aCenter - aHalf, bCenter - bHalf);
      const upper = Math.min(aCenter + aHalf, bCenter + bHalf);
      contact.point.setComponent(component, (lower + upper) * 0.5);
    }
    contact.penetration = depth;
    return true;
  }

  addPair(a, b) {
    if (a.sleeping && b.sleeping) return;
    const key = a.id * MAX_BODIES + b.id;
    if (this.pairs.has(key)) return;
    this.pairs.add(key);
    const contact = this.contacts[this.contactCount] ?? newContact();
    contact.a = a;
    contact.b = b;
    contact.key = key;
    const collides = a.shape === 'sphere'
      ? (b.shape === 'sphere' ? this.makeSphereContact(contact, a, b) : this.makeMixedContact(contact, a, b))
      : (b.shape === 'sphere' ? this.makeMixedContact(contact, b, a) : this.makeBoxContact(contact, a, b));
    if (!collides) return;
    this.contacts[this.contactCount++] = contact;
    if (contact.normal.y > 0.55 && !a.staticSupported) {
      a.supported = true;
      a.supportBody = b;
    }
    if (contact.normal.y < -0.55 && !b.staticSupported) {
      b.supported = true;
      b.supportBody = a;
    }
    const relativeSpeed = this.relative.subVectors(a.velocity, b.velocity).lengthSq();
    if (relativeSpeed > 0.1 || contact.penetration > 0.025) {
      if (a.sleeping) this.wake(a);
      if (b.sleeping) this.wake(b);
    }
    this.prepare(contact);

    const cached = this.cache.get(key);
    if (!cached || cached.normal.dot(contact.normal) < 0.94 || cached.bounce > 0) return;
    contact.normalImpulse = cached.normalImpulse * 0.84;
    contact.tangentImpulse = cached.tangentImpulse * cached.tangent.dot(contact.tangent) * 0.75;
    this.applyPair(contact, contact.normal, contact.normalImpulse);
    this.applyPair(contact, contact.tangent, contact.tangentImpulse);
  }

  broadphase() {
    this.cells.clear();
    this.pairs.clear();
    this.contactCount = 0;
    for (const body of this.bodies) {
      const { position, extent } = body;
      const lowerX = Math.floor((position.x - extent.x) / CELL_SIZE);
      const upperX = Math.floor((position.x + extent.x) / CELL_SIZE);
      const lowerY = Math.floor((position.y - extent.y) / CELL_SIZE);
      const upperY = Math.floor((position.y + extent.y) / CELL_SIZE);
      const lowerZ = Math.floor((position.z - extent.z) / CELL_SIZE);
      const upperZ = Math.floor((position.z + extent.z) / CELL_SIZE);
      for (let x = lowerX; x <= upperX; x += 1) {
        for (let y = lowerY; y <= upperY; y += 1) {
          for (let z = lowerZ; z <= upperZ; z += 1) {
            const key = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
            const bucket = this.cells.get(key);
            if (!bucket) {
              this.cells.set(key, [body]);
              continue;
            }
            for (const other of bucket) this.addPair(other, body);
            bucket.push(body);
          }
        }
      }
    }
  }

  correct(contact) {
    const aHeld = contact.a.sleeping || (contact.a.staticSupported && contact.normal.y < -0.55);
    const bHeld = contact.b.sleeping || (contact.b.staticSupported && contact.normal.y > 0.55);
    const aMass = aHeld ? 0 : contact.a.invMass;
    const bMass = bHeld ? 0 : contact.b.invMass;
    const total = aMass + bMass;
    if (!total) return;
    const shift = Math.max(0, contact.penetration - 0.0015) * 0.78 / total;
    contact.a.position.addScaledVector(contact.normal, shift * aMass);
    contact.b.position.addScaledVector(contact.normal, -shift * bMass);
  }

  step(dt) {
    if (!this.activeCount) return;
    this.frame += 1;
    for (const body of this.bodies) {
      if (body.sleeping && body.supportBody && !body.supportBody.sleeping) this.wake(body);
      if (body.sleeping) continue;
      body.supported = body.staticSupported = false;
      body.supportBody = null;
      this.staticSweep(body, dt);
    }
    this.broadphase();
    for (let iteration = 0; iteration < 7; iteration += 1) {
      for (let index = 0; index < this.contactCount; index += 1) this.resolve(this.contacts[index]);
      for (const body of this.bodies) if (body.staticSupported && !body.sleeping) this.resolve(body.supportContact);
    }
    for (let index = 0; index < this.contactCount; index += 1) {
      const contact = this.contacts[index];
      this.correct(contact);
      const cached = this.cache.get(contact.key) ?? newContact();
      cached.normal.copy(contact.normal);
      cached.tangent.copy(contact.tangent);
      cached.normalImpulse = contact.normalImpulse;
      cached.tangentImpulse = contact.tangentImpulse;
      cached.bounce = contact.bounce;
      cached.frame = this.frame;
      this.cache.set(contact.key, cached);
    }
    for (const [key, cached] of this.cache) if (cached.frame !== this.frame) this.cache.delete(key);
    for (const body of this.bodies) {
      if (body.sleeping) continue;
      if (body.supported && body.velocity.lengthSq() < 0.009 && body.spin.lengthSq() < 0.065) {
        body.restTime += dt;
        if (body.restTime > 0.48) {
          body.sleeping = true;
          body.velocity.set(0, 0, 0);
          body.spin.set(0, 0, 0);
        }
      } else body.restTime = 0;
      this.syncMesh(body);
    }
  }

  raycast(origin, direction, maxDistance = Infinity) {
    let nearest = null;
    let limit = maxDistance;
    for (const body of this.bodies) {
      const local = this.local.subVectors(origin, body.position);
      let entry;
      let exit;
      if (body.shape === 'sphere') {
        const along = -local.dot(direction);
        const square = body.radius * body.radius - (local.lengthSq() - along * along);
        if (square < 0) continue;
        const chord = Math.sqrt(square);
        entry = Math.max(0, along - chord);
        exit = along + chord;
        if (entry > limit || exit < 0) continue;
        this.castNormal.copy(local).addScaledVector(direction, entry).normalize();
      } else {
        local.applyQuaternion(body.inverseRotation);
        const localDirection = this.localDirection.copy(direction).applyQuaternion(body.inverseRotation);
        let near = -Infinity;
        let far = Infinity;
        let side = 0;
        let sign = 0;
        for (let axis = 0; axis < 3; axis += 1) {
          const offset = local.getComponent(axis);
          const component = localDirection.getComponent(axis);
          const extent = body.half.getComponent(axis);
          if (Math.abs(component) < 1e-8) {
            if (Math.abs(offset) > extent) far = -Infinity;
            continue;
          }
          const first = (-extent - offset) / component;
          const second = (extent - offset) / component;
          const entrance = Math.min(first, second);
          if (entrance > near) {
            near = entrance;
            side = axis;
            sign = component > 0 ? -1 : 1;
          }
          far = Math.min(far, Math.max(first, second));
        }
        entry = Math.max(0, near);
        exit = far;
        if (entry > limit || exit < entry) continue;
        this.castNormal.set(0, 0, 0).setComponent(side, sign).applyQuaternion(body.rotation);
      }
      limit = entry;
      nearest = {
        body, distance: entry, exitDistance: exit,
        point: origin.clone().addScaledVector(direction, entry),
        normal: this.castNormal.clone(),
        surface: body.surface, material: body.surface,
      };
    }
    return nearest;
  }
}
