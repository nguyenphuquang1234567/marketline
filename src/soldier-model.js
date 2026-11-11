import { Float32BufferAttribute } from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

export function soldierVariants({ scene: template, animations }) {
  const source = template.getObjectByProperty('isSkinnedMesh', true);
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
    templates: variants.map(({ root }) => ({ root, clips })),
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
