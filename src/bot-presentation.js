import { Quaternion, Vector3 } from 'three';

function transform() {
  return { position: new Vector3(), rotation: new Quaternion(), scale: new Vector3() };
}

function copyTransform(out, value) {
  out.position.copy(value.position);
  out.rotation.copy(value.quaternion);
  out.scale.copy(value.scale);
}

function vertexSamples(geometry) {
  return ['position', 'normal'].map(name => {
    const attribute = geometry.getAttribute(name);
    return { attribute, previous: attribute.array.slice(), current: attribute.array.slice() };
  });
}

// Interpolating presentation keeps fixed-step hit tests, AI and the muzzle on the current simulation pose.
export class BotPresentation {
  constructor(parts, clothing) {
    this.parts = parts.map(({ mesh }) => ({ mesh, previous: transform(), current: transform() }));
    this.clothing = clothing;
    this.samples = new Map();
    this.active = false;
  }

  save(reset) {
    for (const part of this.parts) {
      const recycled = part.previous;
      part.previous = part.current;
      part.current = recycled;
      copyTransform(part.current, part.mesh);
      if (reset) copyTransform(part.previous, part.mesh);
    }

    if (!this.clothing) return;
    const geometry = this.clothing.geometry;
    const changedDetail = this.currentGeometry !== geometry;
    this.currentGeometry = geometry;
    if (!this.samples.has(geometry)) this.samples.set(geometry, vertexSamples(geometry));
    for (const sample of this.samples.get(geometry)) {
      const recycled = sample.previous;
      sample.previous = sample.current;
      sample.current = recycled;
      sample.current.set(sample.attribute.array);
      if (reset || changedDetail) sample.previous.set(sample.current);
    }
  }

  apply(alpha) {
    if (alpha >= .999 || (this.clothing && this.currentGeometry !== this.clothing.geometry)) return;
    this.active = true;
    for (const { mesh, previous, current } of this.parts) {
      mesh.position.lerpVectors(previous.position, current.position, alpha);
      mesh.quaternion.slerpQuaternions(previous.rotation, current.rotation, alpha);
      mesh.scale.lerpVectors(previous.scale, current.scale, alpha);
    }
    for (const { attribute, previous, current } of this.samples.get(this.currentGeometry) ?? []) {
      const output = attribute.array;
      for (let i = 0; i < output.length; i++) output[i] = previous[i] + (current[i] - previous[i]) * alpha;
      attribute.needsUpdate = true;
    }
  }

  restore() {
    if (!this.active) return;
    this.active = false;
    for (const { mesh, current } of this.parts) {
      mesh.position.copy(current.position);
      mesh.quaternion.copy(current.rotation);
      mesh.scale.copy(current.scale);
    }
    for (const { attribute, current } of this.samples.get(this.currentGeometry) ?? []) {
      attribute.array.set(current);
      attribute.needsUpdate = true;
    }
  }
}
