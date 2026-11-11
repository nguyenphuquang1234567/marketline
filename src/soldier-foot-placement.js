import { MathUtils, Quaternion, Vector3 } from 'three';

const DOWN = new Vector3(0, -1, 0);
const UP = new Vector3(0, 1, 0);
const BACK = new Vector3(0, 0, 1);
const HEEL = new Vector3(0, -.129, .078);
const TOE = new Vector3(0, -.129, -.181);
const FOOT_PROBES = [HEEL, TOE];

export class SoldierFootPlacement {
  constructor(bones) {
    this.legs = ['L', 'R'].map(side => {
      const [thigh, shin, foot] = ['thigh', 'shin', 'foot'].map(name => bones.get(name + side));
      return {
        thigh, shin, foot,
        inverseRestRotation: foot.getWorldQuaternion(new Quaternion()).invert(),
        anchor: new Vector3(),
        lastPosition: new Vector3(),
        settleFrom: new Vector3(),
        settleTime: Infinity,
        planted: false,
        hasAnchor: false,
      };
    });
    this.hip = new Vector3();
    this.knee = new Vector3();
    this.ankle = new Vector3();
    this.target = new Vector3();
    this.kneeTarget = new Vector3();
    this.axis = new Vector3();
    this.pole = new Vector3();
    this.probe = new Vector3();
    this.edge = new Vector3();
    this.contactOffset = new Vector3();
    this.flatDirection = new Vector3();
    this.from = new Vector3();
    this.to = new Vector3();
    this.worldRotation = new Quaternion();
    this.footFrame = new Quaternion();
    this.parentRotation = new Quaternion();
    this.swing = new Quaternion();
    this.flatRotation = new Quaternion();
  }

  clear() {
    this.wasLocked = false;
    for (const leg of this.legs) {
      leg.planted = false;
      leg.hasAnchor = false;
      leg.settleTime = Infinity;
    }
  }

  floor(physics, ankle, height) {
    let surface = null;
    for (const offset of FOOT_PROBES) {
      this.probe.copy(offset).applyQuaternion(this.footFrame).add(ankle).setY(height + .46);
      const hit = physics.raycast(this.probe, DOWN, .92);
      if (hit?.normal.y >= .64 && hit.point.y <= height + .36 && (!surface || hit.point.y > surface.point.y)) {
        surface = hit;
      }
    }
    return surface;
  }

  place(bot, physics, dt, phase, stance, travelWeight, lockFeet) {
    let contact = null;
    let settleDelay = 0;
    for (const [index, leg] of this.legs.entries()) {
      leg.foot.getWorldPosition(this.ankle);
      leg.foot.getWorldQuaternion(this.worldRotation);
      this.footFrame.copy(this.worldRotation).multiply(leg.inverseRestRotation);
      this.target.copy(this.ankle);
      const sole = this.edge.copy(HEEL).applyQuaternion(this.footFrame).y < this.probe.copy(TOE).applyQuaternion(this.footFrame).y
        ? HEEL : TOE;
      this.flatDirection.copy(BACK).applyQuaternion(this.footFrame);
      const yaw = Math.atan2(this.flatDirection.x, this.flatDirection.z);
      this.flatRotation.setFromAxisAngle(UP, yaw);
      this.contactOffset.copy(sole).applyQuaternion(this.flatRotation)
        .sub(this.edge.copy(sole).applyQuaternion(this.footFrame)).setY(0);
      const footPhase = (phase + .5 * index) % 1;
      const planted = lockFeet && footPhase < stance;
      if (lockFeet) leg.settleTime = Infinity;
      else if (this.wasLocked && leg.planted && leg.lastPosition.distanceToSquared(this.ankle) > .05 ** 2) {
        leg.settleFrom.copy(leg.lastPosition);
        leg.settleTime = -settleDelay;
        settleDelay += .16;
      }
      if (planted && !leg.planted) {
        leg.anchor.copy(this.ankle).sub(this.contactOffset);
        leg.hasAnchor = true;
        contact = this.floor(physics, this.ankle, bot.position.y)?.surface ?? bot.controller.surface;
      }
      leg.planted = planted;
      // Hold the contact through toe-off, then let the swing catch up in the air.
      const release = 1 - MathUtils.smoothstep(footPhase, stance, stance + .17);
      if (leg.hasAnchor && lockFeet && release > 0) {
        this.probe.copy(leg.anchor).add(this.contactOffset).sub(this.ankle).setY(0);
        this.target.addScaledVector(this.probe.clampLength(0, .24), release * travelWeight);
      } else {
        leg.hasAnchor = false;
      }

      const floor = this.floor(physics, this.target, bot.position.y);
      if (floor) {
        const groundOffset = floor.point.y - bot.position.y;
        const authoredLift = this.ankle.y + this.edge.y - bot.position.y;
        this.target.y += groundOffset - Math.min(0, authoredLift);
      }
      if (leg.settleTime < .25) {
        const progress = MathUtils.smoothstep(leg.settleTime, 0, .25);
        this.target.lerp(leg.settleFrom, 1 - progress);
        this.target.y += Math.sin(Math.PI * progress) * .067;
        leg.settleTime += dt;
      }
      if (this.target.distanceToSquared(this.ankle) > .0025 ** 2) this.solve(leg);
      leg.foot.getWorldPosition(leg.lastPosition);
    }
    this.wasLocked = lockFeet;
    return contact;
  }

  turnBone(bone, from, to) {
    this.swing.setFromUnitVectors(from.normalize(), to.normalize());
    bone.getWorldQuaternion(this.parentRotation);
    this.swing.multiply(this.parentRotation);
    bone.parent.getWorldQuaternion(this.parentRotation).invert();
    bone.quaternion.copy(this.parentRotation).multiply(this.swing).normalize();
    bone.updateMatrixWorld(true);
  }

  solve({ thigh, shin, foot }) {
    thigh.getWorldPosition(this.hip);
    shin.getWorldPosition(this.knee);
    const upper = this.hip.distanceTo(this.knee);
    const lower = this.knee.distanceTo(this.ankle);
    this.axis.subVectors(this.target, this.hip);
    const distance = MathUtils.clamp(this.axis.length(), .025, upper + lower - .002);
    this.axis.normalize();
    this.target.copy(this.hip).addScaledVector(this.axis, distance);
    this.pole.subVectors(this.knee, this.hip);
    this.pole.addScaledVector(this.axis, -this.axis.dot(this.pole)).normalize();
    const along = (upper ** 2 - lower ** 2 + distance ** 2) / (2 * distance);
    const across = Math.sqrt(Math.max(0, upper ** 2 - along ** 2));
    this.kneeTarget.copy(this.hip).addScaledVector(this.axis, along).addScaledVector(this.pole, across);
    this.turnBone(thigh, this.from.subVectors(this.knee, this.hip), this.to.subVectors(this.kneeTarget, this.hip));
    shin.getWorldPosition(this.knee);
    foot.getWorldPosition(this.ankle);
    this.turnBone(shin, this.from.subVectors(this.ankle, this.knee), this.to.subVectors(this.target, this.knee));
    foot.parent.getWorldQuaternion(this.parentRotation).invert();
    foot.quaternion.copy(this.parentRotation).multiply(this.worldRotation).normalize();
    foot.updateMatrixWorld(true);
  }
}
