import * as THREE from 'three';

const CORNERS = [[0,0,0],[1,0,0],[1,0,1],[0,0,1],[0,1,0],[1,1,0],[1,1,1],[0,1,1]];
const EDGES = [0,1, 1,2, 2,3, 3,0, 4,5, 5,6, 6,7, 7,4, 0,4, 1,5, 2,6, 3,7];

function wireBounds(bounds, color) {
  const vertices = [];
  for (const { min, max } of bounds) {
    for (const edge of EDGES) {
      const [x, y, z] = CORNERS[edge];
      vertices.push(x ? max.x : min.x, y ? max.y : min.y, z ? max.z : min.z);
    }
  }
  return new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: .55, depthWrite: false }),
  );
}

function pointCloud(vertices, color, size) {
  return new THREE.Points(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)),
    new THREE.PointsMaterial({ color, size, depthWrite: false, sizeAttenuation: true }),
  );
}

export const DEBUG_NAMES = ['Frame timing', 'Normals', 'Velocity', 'Depth', 'Shadow cascades',
  'Ambient occlusion', 'Collision BVH', 'Navigation', 'Cover', 'Audio probes'];

export class DebugView {
  constructor(scene, physics, nav) {
    this.scene = scene;
    this.physics = physics;
    this.nav = nav;
    this.items = new Map();
    this.mode = 0;
  }

  set(mode) {
    for (const node of this.items.values()) node.visible = false;
    this.mode = mode;
    if (mode < 6) return;
    let node = this.items.get(mode);
    if (!node) {
      node = this.build(mode);
      this.items.set(mode, node);
      this.scene.add(node);
    }
    node.visible = true;
  }

  build(mode) {
    if (mode === 6) {
      const group = new THREE.Group();
      const nodes = [];
      const visit = (node, depth) => {
        if (!node) return;
        if (depth === 3 || node.items) { nodes.push(node); return; }
        visit(node.left, depth + 1);
        visit(node.right, depth + 1);
      };
      visit(this.physics.root, 0);
      group.add(wireBounds(nodes, 0x67c9f2), wireBounds(this.physics.colliders, 0xf3c76a));
      return group;
    }
    if (mode === 7) {
      const vertices = [];
      const position = new THREE.Vector3();
      for (let i = 0; i < this.nav.walkable.length; i++) {
        if (this.nav.edges[i]) {
          this.nav.point(i, position);
          vertices.push(position.x, position.y + .065, position.z);
        }
      }
      return pointCloud(vertices, 0x7ce8ce, .17);
    }
    if (mode === 8) {
      return pointCloud(this.nav.cover.flatMap(({ point: p }) => [p.x, p.y + .61, p.z]), 0xf6c877, .19);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(7 * 6), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(7 * 6), 3));
    const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
      vertexColors: true, depthTest: false, depthWrite: false,
    }));
    lines.frustumCulled = false;
    lines.renderOrder = 20;
    return lines;
  }

  audioRay(index, start, direction, hit) {
    if (this.mode !== 9) return;
    const { position, color } = this.items.get(9).geometry.attributes;
    const d = hit ? hit.distance : 9;
    const base = index * 2;
    position.setXYZ(base, start.x, start.y - .13, start.z);
    position.setXYZ(base + 1, start.x + direction.x * d, start.y + direction.y * d, start.z + direction.z * d);
    color.setXYZ(base, .12, .20, .17);
    if (hit) color.setXYZ(base + 1, .96, .31, .16);
    else color.setXYZ(base + 1, .21, .95, .73);
    position.needsUpdate = color.needsUpdate = true;
  }

  dispose() {
    for (const root of this.items.values()) {
      root.traverse(node => { node.geometry?.dispose(); node.material?.dispose(); });
      root.removeFromParent();
    }
    this.items.clear();
  }
}
