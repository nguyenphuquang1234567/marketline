import { MathUtils, Quaternion, Vector3 } from 'three';

const UP = new Vector3(0, 1, 0);
const FORWARD = new Vector3(0, 0, -1);

// Solve in the authored bend plane and preserve the end joint's world orientation.
export class SoldierLimbIK {
  constructor() {
    this.hip = new Vector3();
    this.knee = new Vector3();
    this.ankle = new Vector3();
    this.kneeTarget = new Vector3();
    this.axis = new Vector3();
    this.authoredAxis = new Vector3();
    this.pole = new Vector3();
    this.from = new Vector3();
    this.to = new Vector3();
    this.parentRotation = new Quaternion();
    this.swing = new Quaternion();
  }

  turnBone(bone, from, to) {
    this.swing.setFromUnitVectors(from.normalize(), to.normalize());
    bone.getWorldQuaternion(this.parentRotation);
    this.swing.multiply(this.parentRotation);
    bone.parent.getWorldQuaternion(this.parentRotation).invert();
    bone.quaternion.copy(this.parentRotation).multiply(this.swing).normalize();
    bone.updateMatrixWorld(true);
  }

  solve(upperBone, middleBone, endBone, target, worldRotation, yaw) {
    endBone.getWorldPosition(this.ankle);
    upperBone.getWorldPosition(this.hip);
    middleBone.getWorldPosition(this.knee);
    const upper = this.hip.distanceTo(this.knee);
    const lower = this.knee.distanceTo(this.ankle);
    this.axis.subVectors(target, this.hip);
    const distance = MathUtils.clamp(this.axis.length(), Math.abs(upper - lower) + .01, upper + lower - .002);
    if (this.axis.lengthSq() < 1e-10) return;
    this.axis.normalize();
    target.copy(this.hip).addScaledVector(this.axis, distance);
    // Rotate the authored plane with the ankle target. Projecting the old knee
    // directly against the new axis can flip it sideways when the boot rises.
    this.authoredAxis.subVectors(this.ankle, this.hip).normalize();
    this.pole.subVectors(this.knee, this.hip);
    this.pole.addScaledVector(this.authoredAxis, -this.authoredAxis.dot(this.pole));
    if (this.pole.lengthSq() < .00001) {
      this.pole.copy(FORWARD).applyAxisAngle(UP, yaw);
      this.pole.addScaledVector(this.authoredAxis, -this.authoredAxis.dot(this.pole));
    }
    this.pole.normalize().applyQuaternion(this.swing.setFromUnitVectors(this.authoredAxis, this.axis));
    const along = (upper ** 2 - lower ** 2 + distance ** 2) / (2 * distance);
    const across = Math.sqrt(Math.max(0, upper ** 2 - along ** 2));
    this.kneeTarget.copy(this.hip).addScaledVector(this.axis, along).addScaledVector(this.pole, across);
    this.turnBone(upperBone, this.from.subVectors(this.knee, this.hip), this.to.subVectors(this.kneeTarget, this.hip));
    middleBone.getWorldPosition(this.knee);
    endBone.getWorldPosition(this.ankle);
    this.turnBone(middleBone, this.from.subVectors(this.ankle, this.knee), this.to.subVectors(target, this.knee));
    endBone.parent.getWorldQuaternion(this.parentRotation).invert();
    endBone.quaternion.copy(this.parentRotation).multiply(worldRotation).normalize();
    endBone.updateMatrixWorld(true);
  }
}
