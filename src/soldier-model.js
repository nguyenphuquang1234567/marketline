import { Float32BufferAttribute } from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

function collectFallSurface(mesh) {
  const { position, skinIndex, skinWeight } = mesh.geometry.attributes;
  const directions = [];
  for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) {
    if (x || y || z) directions.push([x, y, z]);
  }
  const groups = new Map();
  const count = mesh.skeleton.bones.length;
  for (let vertex = 0; vertex < position.count; vertex++) {
    let first = 0;
    let second = 1;
    if (skinWeight.getComponent(vertex, second) > skinWeight.getComponent(vertex, first)) [first, second] = [second, first];
    for (let component = 2; component < 4; component++) {
      if (skinWeight.getComponent(vertex, component) > skinWeight.getComponent(vertex, first)) {
        second = first;
        first = component;
      } else if (skinWeight.getComponent(vertex, component) > skinWeight.getComponent(vertex, second)) {
        second = component;
      }
    }
    const joint = skinIndex.getComponent(vertex, first);
    const mixedWith = skinWeight.getComponent(vertex, second) > .20 ? skinIndex.getComponent(vertex, second) : count;
    const key = joint + mixedWith * count;
    if (!groups.has(key)) {
      groups.set(key, { bone: mesh.skeleton.bones[joint].name, extrema: directions.map(() => ({ vertex, score: -Infinity })) });
    }
    const { extrema } = groups.get(key);
    const x = position.getX(vertex), y = position.getY(vertex), z = position.getZ(vertex);
    for (const [index, [dx, dy, dz]] of directions.entries()) {
      const score = x * dx + y * dy + z * dz;
      if (score <= extrema[index].score) continue;
      extrema[index].score = score;
      extrema[index].vertex = vertex;
    }
  }
  return [...groups.values()].flatMap(({ bone, extrema }) =>
    [...new Set(extrema.map(point => point.vertex))].map(vertex => ({ bone, vertex })));
}

export function soldierVariants({ scene: template, animations }) {
  const source = template.getObjectByProperty('isSkinnedMesh', true);
  const fallSurface = collectFallSurface(source);
  const clips = new Map(animations.map(clip => [clip.name, {
    duration: clip.duration,
    tracks: clip.tracks.map(track => {
      const split = track.name.lastIndexOf('.');
      const target = track.name.slice(0, split);
      const property = track.name.slice(split + 1);
      const interpolant = track.createInterpolant();
      return {
        target, property, interpolant, reference: interpolant.evaluate(0).slice(),
        upper: !/^(pelvis|thigh|shin|foot)/.test(target),
      };
    }),
  }]));
  const colors = [[.32, .68, 1], [1, .30, .22]];
  const variants = colors.map(color => {
    const root = clone(template);
    const mesh = root.getObjectByProperty('isSkinnedMesh', true);
    mesh.geometry = source.geometry.clone();
    const position = mesh.geometry.getAttribute('position');
    const tint = new Float32Array(position.count * 3).fill(1);
    for (let i = 0; i < position.count; i++) {
      const x = Math.abs(position.getX(i)), y = position.getY(i);
      if (x < .255 || x > .331 || y < 1.20 || y > 1.44) continue;
      tint.set(color, i * 3);
    }
    mesh.geometry.setAttribute('color', new Float32BufferAttribute(tint, 3));
    mesh.material = source.material.clone();
    mesh.material.vertexColors = true;
    return { root, mesh };
  });
  source.geometry.dispose();
  source.material.dispose();
  source.skeleton.dispose();
  return {
    templates: variants.map(({ root }) => ({ root, clips, fallSurface })),
    dispose() {
      for (const { mesh } of variants) {
        mesh.geometry.dispose();
        mesh.material.dispose();
        mesh.skeleton.dispose();
      }
      source.material.map.source.data.close?.();
      source.material.map.dispose();
    },
  };
}
