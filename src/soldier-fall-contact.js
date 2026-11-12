import { MathUtils, Quaternion, Vector3 } from 'three';
import { SoldierLimbIK } from './soldier-limb-ik.js';

const GAP = .008;
const UP = new Vector3(0, 1, 0);
const DOWN = new Vector3(0, -1, 0);
const SUPPORT_REACH = 2.5;
const GRAVITY = 9.8;
const upperBody = new Set(['chest', 'clavicleL', 'clavicleR']);
const lowerBody = new Set(['pelvis', 'thighL', 'thighR']);

function mergeCorrection(result, axis, delta) {
  if (Math.abs(delta) > Math.abs(result.getComponent(axis))) result.setComponent(axis, delta);
}

export class SoldierFallContact {
  constructor(mesh, bones, surface) {
    this.mesh = mesh;
    this.surface = surface;
    this.ik = new SoldierLimbIK();
    this.pelvis = bones.get('pelvis');
    this.chest = bones.get('chest');
    this.limbs = ['L', 'R'].flatMap(side => [
      this.limb(bones, side, ['upper_arm', 'forearm', 'hand'], ['fingers', 'fingertips']),
      this.limb(bones, side, ['thigh', 'shin', 'foot']),
    ]);
    this.point = new Vector3();
    this.upper = new Vector3();
    this.lower = new Vector3();
    this.axis = new Vector3();
    this.target = new Vector3();
    this.rotation = new Quaternion();
    this.push = new Vector3();
    this.probe = new Vector3();
  }

  limb(bones, side, [top, middle, end], extra = []) {
    const names = new Set([top, middle, end, ...extra].map(name => name + side));
    return {
      upper: bones.get(top + side), middle: bones.get(middle + side), end: bones.get(end + side),
      surface: this.surface.filter(({ bone }) => names.has(bone)),
    };
  }

  begin(physics, origin) {
    this.nearby = physics.colliders.filter(({min, max}) =>
      min.x < origin.x + SUPPORT_REACH && max.x > origin.x - SUPPORT_REACH
      && min.z < origin.z + SUPPORT_REACH && max.z > origin.z - SUPPORT_REACH
      && min.y < origin.y + 2 && max.y > 0);
    this.probe.copy(origin).y += .018;
    this.floorY = physics.raycast(this.probe, DOWN, origin.y + .02)?.point.y ?? 0;
    this.lift = 0;
  }

  dropFrom(originY, age) {
    return Math.min(Math.max(0, originY - this.floorY), .5 * GRAVITY * age ** 2);
  }

  vertex(index) {
    return this.mesh.getVertexPosition(index, this.point).applyMatrix4(this.mesh.matrixWorld);
  }

  settleSide(root, amount, side, yaw) {
    this.pelvis.getWorldPosition(this.lower);
    this.chest.getWorldPosition(this.upper);
    this.axis.subVectors(this.upper, this.lower).normalize();
    this.rotation.setFromAxisAngle(this.axis, -side * .53 * amount);
    root.position.sub(this.lower).applyQuaternion(this.rotation).add(this.lower);
    root.quaternion.premultiply(this.rotation);
    root.updateMatrixWorld(true);
    this.upper.y = this.lower.y = Infinity;
    for (const { vertex, bone } of this.surface) {
      const upper = upperBody.has(bone);
      if (!upper && !lowerBody.has(bone)) continue;
      const point = this.vertex(vertex);
      const support = upper ? this.upper : this.lower;
      if (point.y < support.y) support.copy(point);
    }
    if (!Number.isFinite(this.upper.y + this.lower.y)) return;
    this.axis.subVectors(this.lower, this.upper);
    const slope = Math.atan2(this.axis.y, Math.hypot(this.axis.x, this.axis.z));
    this.axis.cross(UP).normalize();
    this.rotation.setFromAxisAngle(this.axis, -MathUtils.clamp(slope, -.25, .25) * amount);
    // Pivot around the ribcage so the pelvis settles without sliding sideways.
    root.position.sub(this.upper).applyQuaternion(this.rotation).add(this.upper);
    root.quaternion.premultiply(this.rotation);
    root.updateMatrixWorld(true);
    let low = Infinity;
    for (const { vertex, bone } of this.surface) {
      if (upperBody.has(bone) || lowerBody.has(bone)) low = Math.min(low, this.vertex(vertex).y);
    }
    root.position.y -= MathUtils.clamp(low - this.floorY - GAP, 0, .15) * amount;
    root.updateMatrixWorld(true);
    // Release the boots downward as the body loses tension. Let the upper leg
    // retain some lift so it does not cross through the other boot.
    for (const limb of this.limbs) {
      if (!limb.end.name.startsWith('foot')) continue;
      let sole = Infinity;
      for (const { vertex, bone } of limb.surface) {
        if (bone === limb.end.name) sole = Math.min(sole, this.vertex(vertex).y);
      }
      const limit = limb.end.name === (side < 0 ? 'footL' : 'footR') ? .23 : .12;
      const release = MathUtils.clamp(sole - this.floorY - .025, 0, limit) * amount;
      if (release < .001) continue;
      limb.end.getWorldPosition(this.target);
      limb.end.getWorldQuaternion(this.rotation);
      this.target.y -= release;
      this.ik.solve(limb.upper, limb.middle, limb.end, this.target, this.rotation, yaw);
    }
  }

  contact(point, result, cover) {
    if (point.y < GAP) mergeCorrection(result, 1, GAP - point.y);
    for (const box of this.nearby) {
      if (point.x <= box.min.x || point.x >= box.max.x || point.y <= box.min.y || point.y >= box.max.y
        || point.z <= box.min.z || point.z >= box.max.z) continue;
      if (box === cover.coverWall) {
        const axis = cover.coverTangent === 2 ? 0 : 2;
        const gap = point.dot(cover.coverNormal) - cover.coverPlane;
        mergeCorrection(result, axis, (GAP - gap) * cover.coverNormal.getComponent(axis));
        continue;
      }
      if (box.max.y <= cover.fallOrigin.y + .34) {
        mergeCorrection(result, 1, box.max.y + GAP - point.y);
        continue;
      }
      // Use the entry side for the whole body. Independent nearest faces can
      // push one limb deeper into a crate while another is moved out of it.
      const origin = cover.fallOrigin;
      const outsideX = Math.max(box.min.x - origin.x, origin.x - box.max.x);
      const outsideZ = Math.max(box.min.z - origin.z, origin.z - box.max.z);
      const axis = outsideX > outsideZ ? 0 : 2;
      const from = origin.getComponent(axis);
      const value = point.getComponent(axis);
      const min = box.min.getComponent(axis), max = box.max.getComponent(axis);
      const delta = from - min < max - from ? min - GAP - value : max + GAP - value;
      mergeCorrection(result, axis, delta);
    }
  }

  solve(root, cover, dt) {
    // Only turn joints whose skinned surface actually reaches an obstacle.
    for (const limb of this.limbs) {
      for (let pass = 0; pass < 3; pass++) {
        this.push.set(0, 0, 0);
        for (const { vertex } of limb.surface) this.contact(this.vertex(vertex), this.push, cover);
        if (this.push.lengthSq() < .001 ** 2) break;
        limb.end.getWorldPosition(this.target);
        limb.end.getWorldQuaternion(this.rotation);
        this.target.add(this.push.multiplyScalar(1.15).clampLength(0, .23));
        this.ik.solve(limb.upper, limb.middle, limb.end, this.target, this.rotation, cover.fallYaw);
      }
    }
    // Resolve any torso contact or penetration beyond the limb's available reach.
    for (let pass = 0; pass < 3; pass++) {
      this.push.set(0, 0, 0);
      for (const { vertex } of this.surface) this.contact(this.vertex(vertex), this.push, cover);
      if (pass === 0) {
        this.lift = Math.max(this.push.y, MathUtils.lerp(this.lift, this.push.y, 1 - Math.exp(-dt * 19)));
        this.push.y = this.lift;
      }
      if (this.push.lengthSq() < .001 ** 2) break;
      root.position.add(this.push);
      root.updateMatrixWorld(true);
    }
  }
}
