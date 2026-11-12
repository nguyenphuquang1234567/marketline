import { MathUtils, Quaternion, Vector3 } from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { angleDelta } from './bot-gait.js';
import { SoldierFallContact } from './soldier-fall-contact.js';
import { SoldierFootPlacement } from './soldier-foot-placement.js';

const { clamp, lerp, smoothstep } = MathUtils;
const UP = new Vector3(0, 1, 0);
const FORWARD = new Vector3(0, 0, -1);
const WALL_GAP = .008;

const locomotion = {
  walk: [1.28, .53], run: [2.30, .32],
  backpedal: [1.32, .55], strafe_left: [1, .54], strafe_right: [1, .54],
  crouch_forward: [1.11, .57], crouch_back: [.98, .59],
  crouch_left: [.88, .56], crouch_right: [.88, .56],
};
export class SoldierAnimator {
  constructor({ root, clips, fallSurface }, group) {
    this.root = clone(root);
    group.add(this.root);
    this.mesh = this.root.getObjectByProperty('isSkinnedMesh', true);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.clips = clips;
    this.fallSurface = fallSurface;
    this.bones = new Map(this.mesh.skeleton.bones.map(bone => [bone.name, bone]));
    this.rifle = this.bones.get('RifleSocket');
    this.magazine = this.bones.get('MagazineSocket');
    this.chest = this.bones.get('chest');
    this.head = this.bones.get('head');
    this.aimParts = [this.bones.get('clavicleL'), this.bones.get('clavicleR'), this.rifle];
    this.aimPivot = new Vector3();
    this.root.updateMatrixWorld(true);
    this.feet = new SoldierFootPlacement(this.bones);
    this.fallContact = new SoldierFallContact(this.mesh, this.bones, fallSurface);
    this.parts = [this.root, ...this.bones.values()].map(mesh => ({ mesh }));
    this.velocity = new Vector3();
    this.previousPosition = new Vector3();
    this.currentFacing = new Quaternion();
    this.rotation = new Quaternion();
    this.reference = new Quaternion();
    this.delta = new Quaternion();
    this.parent = new Quaternion();
    this.sampleVector = new Vector3();
    this.targetDirection = new Vector3();
    this.point = new Vector3();
    this.fallImpulse = new Vector3();
    this.fallOrigin = new Vector3();
    this.coverNormal = new Vector3();
    this.fallStart = [];
    this.blends = [];
  }

  clip(name, phase, weight = 1, upperOnly = false) {
    if (weight <= 0) return;
    const { duration, tracks } = this.clips.get(name);
    for (const track of tracks) {
      if (upperOnly && !track.upper) continue;
      const bone = this.bones.get(track.target);
      const value = track.interpolant.evaluate(phase * duration);
      if (weight >= 1) {
        bone[track.property].fromArray(value);
      } else if (track.property === 'quaternion') {
        bone.quaternion.slerp(this.rotation.fromArray(value), weight);
      } else {
        bone[track.property].lerp(this.sampleVector.fromArray(value), weight);
      }
    }
  }

  upperPair(first, second, phase, crouch, weight) {
    const low = crouch * weight;
    this.clip(first, phase, low < 1 ? (weight - low) / (1 - low) : 0, true);
    this.clip(second, phase, low, true);
  }

  overlay(name, elapsed, weight) {
    const { duration, tracks } = this.clips.get(name);
    if (elapsed >= duration || weight <= 0) return;
    for (const track of tracks) {
      if (!track.upper || track.property === 'scale') continue;
      const bone = this.bones.get(track.target);
      const value = track.interpolant.evaluate(elapsed);
      if (track.property === 'quaternion') {
        this.delta.fromArray(track.reference).invert().multiply(this.rotation.fromArray(value)).normalize();
        this.reference.identity().slerp(this.delta, weight);
        bone.quaternion.multiply(this.reference);
      } else {
        const [x, y, z] = track.reference;
        this.sampleVector.set(value[0] - x, value[1] - y, value[2] - z);
        bone.position.addScaledVector(this.sampleVector, weight);
      }
    }
  }

  reset(bot) {
    this.yaw = bot.yaw;
    this.crouch = clamp((1.77 - bot.height) / .61, 0, 1);
    this.aim = this.targetAim(bot);
    this.velocity.copy(bot.velocity);
    this.previousPosition.copy(bot.position);
    this.phase = 0;
    this.fireTime = Infinity;
    this.hitTime = Infinity;
    this.hitClip = null;
    this.transition = null;
    this.turn = null;
    this.airTime = 0;
    this.landTime = Infinity;
    this.grounded = bot.controller.grounded;
    this.moving = false;
    this.reloadSpan = 0;
    this.reloadPhase = 0;
    this.fallClip = null;
    this.feet.clear();
  }

  targetAim(bot) {
    return bot.visibleTarget || bot.state === 'engage' ? 1 : bot.state === 'cover' ? .47 : 0;
  }

  movement(speed) {
    const sine = Math.sin(this.yaw), cosine = Math.cos(this.yaw);
    const x = this.velocity.x * cosine - this.velocity.z * sine;
    const z = this.velocity.x * sine + this.velocity.z * cosine;
    const side = Math.abs(x) / Math.max(.001, Math.abs(x) + Math.abs(z));
    const longitudinal = 1 - side;
    const upright = 1 - this.crouch;
    const run = smoothstep(speed, 1.48, 3.16);
    const left = x < 0;
    const forward = z <= 0;
    this.rifleGaitWeight = forward ? upright * longitudinal : 0;
    this.blends.length = 0;
    if (forward) {
      this.blends.push(['walk', upright * longitudinal * (1 - run)]);
      this.blends.push(['run', upright * longitudinal * run]);
    } else {
      this.blends.push(['backpedal', upright * longitudinal]);
    }
    this.blends.push([left ? 'strafe_left' : 'strafe_right', upright * side]);
    this.blends.push([forward ? 'crouch_forward' : 'crouch_back', this.crouch * longitudinal]);
    this.blends.push([left ? 'crouch_left' : 'crouch_right', this.crouch * side]);
  }

  groundPose(bot, speed, distance, dt, crouching, motion) {
    const idleTime = (bot.clock + (bot.phase ?? 0) * .39) / 2.8 % 1;
    if (this.crouch > .015 && this.crouch < .985 && motion < .25) {
      this.clip(crouching ? 'crouch_down' : 'stand_up', crouching ? this.crouch : 1 - this.crouch);
    } else {
      this.clip('idle', idleTime);
      this.clip('crouch_idle', idleTime, this.crouch);
    }
    this.movement(speed);
    let stride = 0, stance = 0;
    for (const [name, weight] of this.blends) {
      const [length, contact] = locomotion[name];
      stride += length * weight;
      stance += contact * weight;
    }
    this.phase = (this.phase + distance / Math.max(.5, stride * lerp(.68, 1, smoothstep(speed, .3, 1.2)))) % 1;
    let total = 1 - motion;
    for (const [name, amount] of this.blends) {
      const weight = amount * motion;
      if (weight < .0001) continue;
      total += weight;
      this.clip(name, this.phase, weight / total);
    }

    if (this.transition) {
      const step = this.transition;
      step.elapsed += dt;
      const progress = step.elapsed / this.clips.get(step.name).duration;
      if (progress >= 1) this.transition = null;
      else this.clip(step.name, progress, Math.sin(Math.PI * progress) * (1 - this.crouch) * .41);
    }
    if (this.turn) {
      const step = this.turn;
      step.elapsed += dt;
      step.phase = step.elapsed / this.clips.get(step.name).duration;
      if (step.phase >= 1 || motion > .45) this.turn = null;
      else this.clip(step.name, step.phase, Math.min(1, Math.sin(Math.PI * step.phase) * 2.8) * (1 - motion));
    }
    return stance;
  }

  pose(bot, physics, dt, reset) {
    if (reset) this.reset(bot);
    const distance = Math.min(.17, Math.hypot(bot.position.x - this.previousPosition.x, bot.position.z - this.previousPosition.z));
    this.previousPosition.copy(bot.position);
    this.velocity.lerp(bot.velocity, 1 - Math.exp(-16 * dt));
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const motion = smoothstep(speed, .12, .85);
    const oldCrouch = this.crouch;
    const desiredCrouch = clamp((1.77 - bot.height) / .61, 0, 1);
    this.crouch = lerp(this.crouch, desiredCrouch, 1 - Math.exp(-19 * dt));
    this.aim = lerp(this.aim, this.targetAim(bot), 1 - Math.exp(-12 * dt));
    const deltaYaw = angleDelta(bot.yaw, this.yaw);
    if (!this.turn && speed < .42 && Math.abs(deltaYaw) > .28) {
      const direction = deltaYaw > 0 ? 'left' : 'right';
      this.turn = { name: (this.crouch > .55 ? 'crouch_turn_' : 'turn_') + direction, elapsed: 0, direction };
    }
    this.yaw += deltaYaw * (1 - Math.exp(-dt * (this.turn ? 9.5 : speed > .42 ? 11 : 5.3)));
    this.currentFacing.setFromAxisAngle(UP, this.yaw);
    this.root.position.copy(bot.position);
    this.root.quaternion.copy(this.currentFacing);
    const wasMoving = this.moving;
    this.moving = speed > (wasMoving ? .34 : .56);
    if (!reset && this.moving !== wasMoving && !this.turn) {
      this.transition = { name: this.moving ? 'start' : 'stop', elapsed: 0 };
    }

    const stance = this.groundPose(bot, speed, distance, dt, desiredCrouch >= oldCrouch, motion);
    const grounded = bot.controller.grounded;
    let contact = null;
    if (grounded && !this.grounded) {
      this.landTime = 0;
      contact = bot.controller.surface;
    }
    this.grounded = grounded;
    if (!grounded) {
      this.airTime += dt;
      this.clip('airborne', Math.min(1, this.airTime / this.clips.get('airborne').duration),
        smoothstep(this.airTime, 0, .13));
    } else {
      this.airTime = 0;
      const duration = this.clips.get('land').duration;
      this.clip('land', Math.min(1, this.landTime / duration), .73 * (1 - smoothstep(this.landTime, .05, duration)));
      this.landTime += dt;
    }

    const aimPhase = (bot.clock + (bot.phase ?? 0) * .27) / 1.73 % 1;
    // The rifle gait already carries the weapon in both hands. Aim the moving
    // shoulders and rifle below without replacing their motion with idle aim.
    const aimWeight = this.aim * (1 - motion * lerp(.12, .98, this.rifleGaitWeight));
    this.upperPair('aim', 'aim_crouch', aimPhase, this.crouch, aimWeight);
    const remaining = bot.reloading || 0;
    this.reloadSpan = remaining > 0 ? Math.max(this.reloadSpan, remaining) : 0;
    this.reloadPhase = this.reloadSpan > 0 ? 1 - remaining / this.reloadSpan : 0;
    const reloadWeight = smoothstep(this.reloadPhase, 0, .095) * (1 - smoothstep(this.reloadPhase, .92, 1));
    this.upperPair('reload', 'reload_crouch', this.reloadPhase, this.crouch, reloadWeight);
    this.fireTime += dt;
    this.hitTime += dt;
    this.overlay('fire', this.fireTime, (1 - reloadWeight) * .94);
    if (this.hitClip) this.overlay(this.hitClip, this.hitTime, this.hitWeight);

    this.root.updateMatrixWorld(true);
    const horizontalAim = Math.cos(bot.pitch);
    this.point.set(-Math.sin(bot.yaw) * horizontalAim, Math.sin(bot.pitch), -Math.cos(bot.yaw) * horizontalAim);
    this.rifle.getWorldQuaternion(this.rotation);
    this.targetDirection.copy(FORWARD).applyQuaternion(this.rotation);
    const aimCorrection = this.aim * (1 - reloadWeight) * (this.fireTime < .11 ? .61 : .93);
    this.delta.setFromUnitVectors(this.targetDirection, this.point);
    this.reference.identity().slerp(this.delta, aimCorrection);
    // Aim the rifle and both arms together around the collar. The upper back
    // and head keep the lean from the crouch clip when the muzzle levels out.
    this.chest.getWorldQuaternion(this.parent);
    this.delta.copy(this.parent).invert().multiply(this.reference).multiply(this.parent);
    this.aimPivot.copy(this.aimParts[0].position).lerp(this.aimParts[1].position, .5);
    for (const bone of this.aimParts) {
      bone.position.sub(this.aimPivot).applyQuaternion(this.delta).add(this.aimPivot);
      bone.quaternion.premultiply(this.delta).normalize();
    }
    this.chest.updateMatrixWorld(true);

    if (grounded) {
      if (this.turn) {
        const phase = (this.turn.phase + (this.turn.direction === 'left' ? .5 : 0)) % 1;
        contact = this.feet.place(bot, physics, dt, phase, .50, .9, true) ?? contact;
      } else {
        contact = this.feet.place(bot, physics, dt, this.phase, stance, 1, motion > .53) ?? contact;
      }
    } else {
      this.feet.clear();
    }
    return contact;
  }

  fire() { this.fireTime = 0; }

  impact(direction, amount) {
    this.sampleVector.copy(direction).applyAxisAngle(UP, -this.yaw);
    const { x, z } = this.sampleVector;
    const side = Math.abs(x) > Math.abs(z) ? (x > 0 ? 'left' : 'right') : (z > 0 ? 'front' : 'back');
    this.hitClip = 'hit_' + side;
    this.hitWeight = clamp(.41 + amount * .013, .41, 1);
    this.hitTime = 0;
  }

  syncWeapon(rifle, magazine) {
    this.rifle.getWorldPosition(rifle.position);
    this.rifle.getWorldQuaternion(rifle.quaternion);
    this.magazine.getWorldPosition(magazine.position);
    this.magazine.getWorldQuaternion(magazine.quaternion);
    this.magazine.getWorldScale(magazine.scale);
  }

  fall(direction) {
    this.fallClip = null;
    this.coverWall = null;
    this.fallYaw = this.yaw;
    this.coverTurn = 0;
    this.fallOrigin.copy(this.root.position);
    this.fallImpulse.copy(direction).applyAxisAngle(UP, -this.yaw);
    this.fallStart = [...this.bones.values()].map(bone => ({
      bone, position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone(),
    }));
  }

  chooseFall(physics) {
    const { x, z } = this.fallImpulse;
    const sideways = Math.abs(x) > Math.abs(z);
    const name = sideways ? (x > 0 ? 'right' : 'left') : (z > 0 ? 'back' : 'forward');
    this.fallClip = 'death_' + name;
    this.fallContact.begin(physics, this.fallOrigin);
    this.sampleVector.set(x, 0, z).normalize();
    this.sampleVector.applyQuaternion(this.root.quaternion).multiplyScalar(.88);
    this.point.copy(this.fallOrigin).addScaledVector(UP, .67);
    const wall = physics.sphereCast(this.point, this.sampleVector, .22);
    if (!wall?.collider.max || Math.abs(wall.normal.y) > .28) return;

    const axis = Math.abs(wall.normal.x) > Math.abs(wall.normal.z) ? 0 : 2;
    const sign = Math.sign(wall.normal.getComponent(axis));
    this.coverNormal.set(0, 0, 0).setComponent(axis, sign);
    const face = sign > 0 ? wall.collider.max : wall.collider.min;
    this.coverPlane = face.getComponent(axis) * sign;
    const clearance = this.fallOrigin.dot(this.coverNormal) - this.coverPlane;
    if (clearance < .04 || clearance > 1.02) return;

    // Turn tangentially so a shoulder, rather than the face, receives the hit.
    const rightTowardWall = Math.atan2(this.coverNormal.z, -this.coverNormal.x);
    const rightTurn = angleDelta(rightTowardWall, this.fallYaw);
    const leftTurn = angleDelta(rightTowardWall + Math.PI, this.fallYaw);
    const right = Math.abs(rightTurn) <= Math.abs(leftTurn);
    this.coverTurn = right ? rightTurn : leftTurn;
    this.coverShoulder = right ? 'upper_armR' : 'upper_armL';
    this.coverWall = wall.collider;
    this.coverTangent = axis === 0 ? 2 : 0;
    this.fallClip = right ? 'death_cover_right' : 'death_cover_left';
  }

  approachCover(age) {
    const wall = this.coverWall;
    if (!wall) return;
    let clearance = Infinity;
    let shoulderClearance = Infinity;
    // Skin vertices at the extremities of each body part include the fingers,
    // boot sides and gear that can reach a surface before their joints do.
    for (const { vertex, bone } of this.fallSurface) {
      this.mesh.getVertexPosition(vertex, this.point).applyMatrix4(this.mesh.matrixWorld);
      if (this.point.y < wall.min.y - .01 || this.point.y > wall.max.y + .01) continue;
      const along = this.point.getComponent(this.coverTangent);
      if (along < wall.min.getComponent(this.coverTangent) - .01 || along > wall.max.getComponent(this.coverTangent) + .01) continue;
      const gap = this.point.dot(this.coverNormal) - this.coverPlane;
      if (!/^(forearm|hand|fingers|fingertips|shin|foot)/.test(bone)) clearance = Math.min(clearance, gap);
      if (bone === this.coverShoulder) shoulderClearance = Math.min(shoulderClearance, gap);
    }
    if (clearance < Infinity) {
      const approach = shoulderClearance < Infinity
        ? Math.min(.66, shoulderClearance - WALL_GAP) * smoothstep(age, .07, .40) : 0;
      this.root.position.addScaledVector(this.coverNormal, -Math.min(clearance - WALL_GAP, approach));
      this.root.updateMatrixWorld(true);
    }
  }

  tumble(physics, age, dt) {
    if (!this.fallClip) this.chooseFall(physics);
    const phase = clamp(age / this.clips.get(this.fallClip).duration, 0, 1);
    this.root.position.copy(this.fallOrigin);
    this.root.position.y -= this.fallContact.dropFrom(this.fallOrigin.y, age);
    this.root.quaternion.setFromAxisAngle(UP, this.fallYaw + this.coverTurn * smoothstep(age, .055, .39));
    this.clip(this.fallClip, phase);
    const blend = 1 - smoothstep(age, 0, .19);
    for (const { bone, position, quaternion, scale } of this.fallStart) {
      bone.position.lerp(position, blend);
      bone.quaternion.slerp(quaternion, blend);
      bone.scale.lerp(scale, blend);
    }
    this.root.updateMatrixWorld(true);
    this.approachCover(age);
    if (this.fallClip === 'death_left' || this.fallClip === 'death_right') {
      const settle = smoothstep(phase, .59, .94);
      const side = this.fallClip === 'death_left' ? -1 : 1;
      if (settle > 0) this.fallContact.settleSide(this.root, settle, side, this.fallYaw);
    }
    this.fallContact.solve(this.root, this, dt);
  }

  dispose() { this.mesh.skeleton.dispose(); }
}
