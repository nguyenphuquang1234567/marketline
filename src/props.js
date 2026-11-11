import * as THREE from 'three';

const TINS = [
  [-1.9, 43.8], [3.2, 43.1], [-3.8, 35.8], [2.9, 32.9], [-2.2, 24.7],
  [3.5, 18.4], [1.2, 13.8], [-4, -2.1], [2, -16.3], [-1.7, -20.6],
  [-6.7, -29.3], [4, -41.5], [-29.3, 30.9], [29.2, -18.5],
];
const BOXES = [[-3.6, 38.2], [3.9, 34.5], [-3.2, 18.9], [4.8, -8.2], [-4.1, -30.9], [2.8, -46.2]];

export function makeLooseProps(scene, rigid, physics, random) {
  const props = [];
  const shared = {
    tin: new THREE.CylinderGeometry(.085, .078, .185, 14, 1),
    rim: new THREE.CylinderGeometry(.088, .088, .013, 14, 1),
    grip: new THREE.TorusGeometry(.024, .0048, 4, 10),
    box: new THREE.BoxGeometry(1, 1, 1),
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x77746a, metalness: .65, roughness: .47 }),
    paleWood: new THREE.MeshStandardMaterial({ color: 0x927355, roughness: .92 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x73563f, roughness: .89 }),
    endWood: new THREE.MeshStandardMaterial({ color: 0x574637, roughness: .93 }),
    paintedTin: [0x78776c, 0x894f37, 0x47666e, 0x827346].map(color => new THREE.MeshStandardMaterial({
      color, metalness: .41, roughness: .61,
    })),
  };
  const at = new THREE.Vector3();
  const down = new THREE.Vector3(0, -1, 0);
  function bodyPart(group, geometry, material, x, y, z, sx = 1, sy = 1, sz = 1) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }
  function ground(x, z, y) {
    at.set(x, 2, z);
    const hit = physics.raycast(at, down, 2.2);
    if (!hit || hit.point.y > 1.15) return null;
    return at.clone().setY(hit.point.y + y + .006);
  }
  for (const [x, z] of TINS) {
    const position = ground(x, z, .102);
    if (!position || physics.overlapsCapsule(position.clone().setY(position.y - .095), .115, .22)) continue;
    const mesh = new THREE.Group();
    bodyPart(mesh, shared.tin, shared.paintedTin[Math.floor(random() * shared.paintedTin.length)], 0, 0, 0);
    bodyPart(mesh, shared.rim, shared.darkMetal, 0, .092, 0);
    bodyPart(mesh, shared.rim, shared.darkMetal, 0, -.09, 0);
    bodyPart(mesh, shared.grip, shared.darkMetal, -.017, .102, 0).rotation.x = Math.PI / 2;
    scene.add(mesh);
    props.push(rigid.add({
      shape: 'box', position, halfExtents: new THREE.Vector3(.087, .102, .087),
      mass: .3, surface: 'metal', mesh,
    }));
  }
  for (const [x, z] of BOXES) {
    const position = ground(x, z, .154);
    if (!position || physics.overlapsCapsule(position.clone().setY(position.y - .15), .29, .31)) continue;
    const mesh = new THREE.Group();
    bodyPart(mesh, shared.box, shared.endWood, 0, -.126, 0, .56, .047, .43);
    for (const side of [-1, 1]) {
      bodyPart(mesh, shared.box, shared.wood, side * .251, -.035, 0, .042, .13, .43);
      bodyPart(mesh, shared.box, shared.paleWood, 0, -.035, side * .2, .56, .12, .032);
      bodyPart(mesh, shared.box, shared.wood, 0, .086, side * .203, .56, .084, .037);
      bodyPart(mesh, shared.box, shared.paleWood, side * .252, .088, 0, .045, .09, .43);
      for (const end of [-1, 1]) bodyPart(mesh, shared.box, shared.endWood, side * .255, 0, end * .207, .054, .31, .041);
    }
    scene.add(mesh);
    props.push(rigid.add({
      shape: 'box', position, halfExtents: new THREE.Vector3(.281, .154, .224),
      mass: 1.8, surface: 'wood', mesh,
    }));
  }
  return props;
}
