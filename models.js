import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MODEL_PATH = new URL('./assets/blockbench/', import.meta.url);
const modelTemplates = new Map();
const textureCache = new Map();
const BLOCKBENCH_SCALE = 1 / 16;
export const PLAYER_SCALE = 3.2;

export function mk(geometry, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, cast = true) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  return mesh;
}

function textureFace(face) {
  const uv = face?.uv;
  if (!uv) return;
  if (face.texture === null) return;
  return uv;
}

function makeMaterial(texture, name) {
  const metal = /steel|metal|brass|iron|oxide|enamel/i.test(name);
  const fabric = /fabric|velvet|coat|lining|cloth/i.test(name);
  const wood = /wood|veneer|chair|pedestal/i.test(name);
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: metal ? 0.72 : fabric ? 0.99 : wood ? 0.84 : 0.92,
    metalness: metal ? 0.5 : 0.01,
    side: THREE.DoubleSide
  });
  if (texture && (metal || fabric || wood)) {
    material.bumpMap = texture;
    material.bumpScale = metal ? 0.007 : fabric ? 0.024 : 0.016;
  }
  if (/fortuna lettering|status lamp/i.test(name)) {
    material.emissive.setHex(0x49321c);
    material.emissiveIntensity = 0.65;
  }
  return material;
}

function setTransform(object, position, rotation = [0, 0, 0]) {
  object.position.set(...position);
  object.rotation.set(...rotation.map(value => THREE.MathUtils.degToRad(value)));
}

function buildCube(element, texture, dimensions, parentOrigin) {
  const geometry = new THREE.BoxGeometry(
    element.to[0] - element.from[0],
    element.to[1] - element.from[1],
    element.to[2] - element.from[2]
  );
  const faceNames = ['east', 'west', 'up', 'down', 'south', 'north'];
  const index = geometry.getIndex();
  const uvAttribute = geometry.getAttribute('uv');
  const original = Array.from({ length: uvAttribute.count }, (_, i) => [uvAttribute.getX(i), uvAttribute.getY(i)]);
  geometry.groups.forEach((group, groupIndex) => {
    const face = element.faces?.[faceNames[groupIndex]];
    const rect = textureFace(face);
    if (!rect) return;
    const vertices = new Set();
    for (let i = group.start; i < group.start + group.count; i++) vertices.add(index.getX(i));
    for (const vertex of vertices) {
      const [u, v] = original[vertex];
      uvAttribute.setXY(
        vertex,
        (rect[0] + u * (rect[2] - rect[0])) / dimensions.width,
        1 - (rect[1] + (1 - v) * (rect[3] - rect[1])) / dimensions.height
      );
    }
  });
  uvAttribute.needsUpdate = true;
  geometry.computeVertexNormals();

  const pivot = new THREE.Group();
  pivot.name = element.name;
  const origin = element.origin || element.from.map((value, index) => (value + element.to[index]) / 2);
  setTransform(pivot, origin.map((value, index) => value - parentOrigin[index]), element.rotation);
  const mesh = new THREE.Mesh(geometry, makeMaterial(texture, element.name));
  mesh.name = element.name;
  mesh.position.set(
    (element.from[0] + element.to[0]) / 2 - origin[0],
    (element.from[1] + element.to[1]) / 2 - origin[1],
    (element.from[2] + element.to[2]) / 2 - origin[2]
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  pivot.add(mesh);
  return pivot;
}

function buildMesh(element, texture, dimensions, parentOrigin) {
  const positions = [];
  const uvs = [];
  const vertices = element.vertices || {};
  const cylinder = Object.hasOwn(vertices, 'top_center') && Object.hasOwn(vertices, 'bottom_center');
  const coordinateValues = Object.values(vertices);
  const ranges = [0, 1, 2].map(axis => {
    const values = coordinateValues.map(point => point[axis]);
    return [Math.min(...values), Math.max(...values)];
  });
  const cylinderAxis = cylinder
    ? [0, 1, 2].reduce((axis, candidate) =>
      Math.abs(vertices['1_0'][candidate] - vertices['0_0'][candidate])
        > Math.abs(vertices['1_0'][axis] - vertices['0_0'][axis])
        ? candidate
        : axis, 0)
    : -1;
  const cylinderPlane = [0, 1, 2].filter(axis => axis !== cylinderAxis);
  const torusFaces = !cylinder && Object.keys(vertices).length === Object.keys(element.faces || {}).length
    && Object.keys(vertices).every(key => /^\d+_\d+$/.test(key))
    && Object.values(element.faces || {}).every(face => face.vertices?.length === 4);
  const torusAround = torusFaces
    ? Math.max(...Object.keys(vertices).map(key => Number(key.split('_')[0]))) + 1
    : 0;
  const torusSides = torusFaces
    ? Math.max(...Object.keys(vertices).map(key => Number(key.split('_')[1]))) + 1
    : 0;
  const faceUvs = (face) => {
    const faceKeys = face.vertices || [];
    const faceUvValues = Object.values(face.uv || {});
    if (!faceUvValues.length) return null;
    const u0 = Math.min(...faceUvValues.map(uv => uv[0]));
    const v0 = Math.min(...faceUvValues.map(uv => uv[1]));
    const u1 = Math.max(...faceUvValues.map(uv => uv[0]));
    const v1 = Math.max(...faceUvValues.map(uv => uv[1]));
    const mapUv = (u, v) => [u0 + u * (u1 - u0), v0 + v * (v1 - v0)];

    if (cylinder) {
      const points = faceKeys.map(key => vertices[key]);
      const center = ranges.map(([min, max]) => (min + max) / 2);
      if (faceKeys.includes('top_center') || faceKeys.includes('bottom_center')) {
        return Object.fromEntries(faceKeys.map((key, index) => {
          const point = points[index];
          return [key, mapUv(
            (point[cylinderPlane[0]] - ranges[cylinderPlane[0]][0])
              / (ranges[cylinderPlane[0]][1] - ranges[cylinderPlane[0]][0]),
            (point[cylinderPlane[1]] - ranges[cylinderPlane[1]][0])
              / (ranges[cylinderPlane[1]][1] - ranges[cylinderPlane[1]][0])
          )];
        }));
      }

      const angles = points.map(point => Math.atan2(
        point[cylinderPlane[1]] - center[cylinderPlane[1]],
        point[cylinderPlane[0]] - center[cylinderPlane[0]]
      ));
      if (Math.max(...angles) - Math.min(...angles) > Math.PI) {
        angles.forEach((angle, index) => { if (angle < 0) angles[index] += Math.PI * 2; });
      }
      return Object.fromEntries(faceKeys.map((key, index) => [
        key,
        mapUv(
          angles[index] / (Math.PI * 2),
          (points[index][cylinderAxis] - ranges[cylinderAxis][0])
            / (ranges[cylinderAxis][1] - ranges[cylinderAxis][0])
        )
      ]));
    }

    if (torusFaces) {
      const indices = faceKeys.map(key => key.split('_').map(Number));
      const unwrap = (values, size) => {
        const result = values.map(([around]) => around);
        if (Math.max(...result) - Math.min(...result) > size / 2) {
          result.forEach((value, index) => { if (value < size / 2) result[index] += size; });
        }
        return result;
      };
      const around = unwrap(indices, torusAround);
      const sides = unwrap(indices.map(([, side]) => [side]), torusSides);
      return Object.fromEntries(faceKeys.map((key, index) => [
        key,
        mapUv(around[index] / torusAround, sides[index] / torusSides)
      ]));
    }

    return null;
  };
  for (const face of Object.values(element.faces || {})) {
    const vertices = face.vertices || [];
    if (vertices.length < 3) continue;
    const mappedUvs = faceUvs(face);
    for (let triangle = 1; triangle < vertices.length - 1; triangle++) {
      for (const key of [vertices[0], vertices[triangle], vertices[triangle + 1]]) {
        const point = element.vertices[key];
        const uv = mappedUvs?.[key] || face.uv?.[key] || [0, 0];
        positions.push(point[0] - (element.origin?.[0] || 0), point[1] - (element.origin?.[1] || 0), point[2] - (element.origin?.[2] || 0));
        uvs.push(uv[0] / dimensions.width, 1 - uv[1] / dimensions.height);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();

  const pivot = new THREE.Group();
  pivot.name = element.name;
  const origin = element.origin || [0, 0, 0];
  setTransform(pivot, origin.map((value, index) => value - parentOrigin[index]), element.rotation);
  const mesh = new THREE.Mesh(geometry, makeMaterial(texture, element.name));
  mesh.name = element.name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  pivot.add(mesh);
  return pivot;
}

function createProject(project, texture) {
  const elements = new Map(project.elements.map(element => [element.uuid, element]));
  const groups = new Map((project.groups || []).map(group => [group.uuid, group]));
  const root = new THREE.Group();
  root.name = project.name;

  const addOutlinerNode = (node, parent, parentOrigin = [0, 0, 0]) => {
    if (typeof node === 'string') {
      const element = elements.get(node);
      if (!element) throw new Error(`Blockbench project "${project.name}" references missing element "${node}"`);
      const object = element.type === 'mesh'
        ? buildMesh(element, texture, project.resolution, parentOrigin)
        : buildCube(element, texture, project.resolution, parentOrigin);
      parent.add(object);
      return;
    }

    const definition = groups.get(node.uuid) || node;
    const origin = definition.origin || [0, 0, 0];
    const group = new THREE.Group();
    group.name = definition.name;
    setTransform(group, origin.map((value, index) => value - parentOrigin[index]), definition.rotation);
    parent.add(group);
    for (const child of node.children || []) addOutlinerNode(child, group, origin);
  };

  for (const node of project.outliner || []) addOutlinerNode(node, root);
  root.scale.setScalar(BLOCKBENCH_SCALE);
  return root;
}

async function loadProject(filename) {
  const response = await fetch(new URL(filename, MODEL_PATH));
  if (!response.ok) throw new Error(`Unable to load Blockbench asset ${filename}: HTTP ${response.status}`);
  const project = await response.json();
  if (project.meta?.model_format !== 'free' || !Array.isArray(project.elements) || !Array.isArray(project.textures)) {
    throw new Error(`Invalid Blockbench project: ${filename}`);
  }

  const source = project.textures[0]?.source;
  if (typeof source !== 'string' || !source.startsWith('data:image/')) {
    throw new Error(`Blockbench project has no embedded texture: ${filename}`);
  }
  let texture = textureCache.get(source);
  if (!texture) {
    texture = await new THREE.TextureLoader().loadAsync(source);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    textureCache.set(source, texture);
  }
  return createProject(project, texture);
}

export async function preloadBlockbenchAssets() {
  const assets = [
    ['casino_environment', 'casino_environment.bbmodel'],
    ['seated_mafioso', 'seated_mafioso.bbmodel'],
    ['chess_clock_monitor', 'chess_clock_monitor.bbmodel']
  ];
  const loaded = await Promise.all(assets.map(async ([key, filename]) => [key, await loadProject(filename)]));
  loaded.forEach(([key, model]) => modelTemplates.set(key, model));

  const gunAsset = await new GLTFLoader().loadAsync(new URL('iron_phantom.glb', MODEL_PATH).href);
  modelTemplates.set('iron_phantom', gunAsset.scene);
}

function cloneModel(key) {
  const template = modelTemplates.get(key);
  if (!template) throw new Error(`Blockbench asset "${key}" was not preloaded`);
  return template.clone(true);
}

function cloneMaterials(root) {
  root.traverse(object => {
    if (!object.isMesh) return;
    object.material = object.material.clone();
  });
}

function findObject(root, name) {
  const object = root.getObjectByName(name);
  if (!object) throw new Error(`Blockbench asset is missing required part "${name}"`);
  return object;
}

function findMesh(root, name) {
  let mesh = null;
  root.traverse(object => {
    if (!mesh && object.isMesh && object.name === name) mesh = object;
  });
  if (!mesh) throw new Error(`Blockbench asset is missing required mesh "${name}"`);
  return mesh;
}

export function createEnvironment(scene) {
  const environment = cloneModel('casino_environment');
  const backgroundOffset = 64; // child transforms are in Blockbench units; the model root is scaled by 1/16.
  const roomShell = findObject(environment, 'Room Shell');
  roomShell.position.z -= backgroundOffset;
  findObject(roomShell, 'Stained concrete floor').position.z += backgroundOffset;
  findObject(environment, 'Fortuna Sign').position.z -= backgroundOffset;
  findObject(environment, 'Wall Roulette').position.z -= backgroundOffset;
  const fixtures = findObject(environment, 'Casino Fixtures');
  fixtures.position.z -= backgroundOffset;
  fixtures.children
    .filter(object => object.name.startsWith('Pendant '))
    .forEach(object => { object.position.z += backgroundOffset; });
  scene.add(environment);
  return environment;
}

export function createGun(scene) {
  const root = new THREE.Group();
  root.name = 'Iron Phantom';
  const model = cloneModel('iron_phantom');
  model.rotation.y = Math.PI / 2;
  model.scale.setScalar(0.36);
  model.traverse(object => {
    if (!object.isMesh) return;
    object.material = new THREE.MeshStandardMaterial({
      color: 0x626568,
      metalness: 0.72,
      roughness: 0.56
    });
    object.castShadow = true;
    object.receiveShadow = true;
  });
  root.position.set(0, 0.42, 0.35);
  root.add(model);
  scene.add(root);
  return { root };
}

export function createMachine(scene) {
  const root = cloneModel('chess_clock_monitor');
  cloneMaterials(root);
  const gaugeTemplate = findObject(root, 'Gauge');
  gaugeTemplate.removeFromParent();
  const needles = [];
  const needleTemplate = findObject(gaugeTemplate, 'Needle');
  needleTemplate.removeFromParent();
  gaugeTemplate.scale.setScalar(4);
  for (let index = 0; index < 3; index++) {
    const needle = needleTemplate.clone(true);
    needle.name = `Life needle ${index + 1}`;
    needle.rotation.z = (index - 1) * 0.22;
    cloneMaterials(needle);
    const pointer = findMesh(needle, 'Red gauge needle');
    pointer.material.emissive.setHex(0x681018);
    pointer.material.emissiveIntensity = 0.7;
    gaugeTemplate.add(needle);
    needles.push(needle);
    findObject(gaugeTemplate, `LifeSegment${index + 1}`).visible = false;
  }

  scene.add(root);
  return {
    root,
    screenMat: findMesh(root, 'Front status lamp').material,
    needles
  };
}

export function createMafiaPlayer(scene, x, y, z, rotY, variant = 0) {
  const root = cloneModel('seated_mafioso');
  cloneMaterials(root);
  root.position.set(x, y, z);
  root.rotation.y = rotY;
  root.scale.setScalar(BLOCKBENCH_SCALE * PLAYER_SCALE);
  const variantIndex = Math.abs(Math.trunc(variant)) % 12;
  root.scale.y *= [0.97, 1.03, 1, 0.96, 1.04, 1.01, 0.98, 1.02, 0.95, 1.05, 0.99, 1.015][variantIndex];
  root.scale.x *= [0.98, 1.02, 0.95, 1.04, 0.99, 1.03, 1.05, 0.97, 1.01, 0.96, 1.025, 0.985][variantIndex];
  root.scale.z *= [1.01, 0.97, 1.04, 0.98, 1.02, 0.96, 0.95, 1.03, 0.99, 1.05, 0.975, 1.015][variantIndex];

  const body = findObject(root, 'Body');
  body.scale.y = 1.15;
  body.position.y += 0.1;
  const head = findObject(root, 'Head');
  head.scale.setScalar(0.82);
  const headTilts = [-0.035, 0.022, 0.045, -0.018, 0.032, -0.028, 0.012, -0.046, 0.038, -0.008, 0.05, -0.024];
  const headTilt = headTilts[variantIndex];
  head.rotation.z = headTilt;
  const eyeMaterial = new THREE.MeshStandardMaterial({
    color: 0x291311,
    emissive: 0x5b2017,
    emissiveIntensity: 0.16,
    roughness: 0.36
  });
  const eyeGeometry = new THREE.SphereGeometry(0.018, 10, 8);
  const eyes = [-1.35, 1.35].map(x => {
    const eye = mk(eyeGeometry, eyeMaterial, x / 16, 0.055, 0.205, 0, 0, 0, false);
    eye.scale.set(1, 0.7, 0.42);
    eye.userData.openScaleY = 0.7;
    head.add(eye);
    return eye;
  });
  head.add(mk(
    new THREE.ConeGeometry(0.022, 0.068, 5),
    new THREE.MeshStandardMaterial({ color: 0x35231f, roughness: 0.95 }),
    0, 0, 0.224, Math.PI / 2, 0, 0, false
  ));
  const arm = findObject(root, 'LeftArm');
  const hand = findObject(root, 'Hand');
  const coat = findMesh(root, 'Low-poly trenchcoat silhouette');
  coat.material.emissive.setHex(0x390b10);
  coat.material.emissiveIntensity = 0;
  const coatVariants = [
    0x49393d, 0x374047, 0x4a4135, 0x373741, 0x493b43, 0x39423f,
    0x53463c, 0x3e4549, 0x574044, 0x464239, 0x383440, 0x41483e
  ];
  coat.material.color.setHex(coatVariants[variantIndex]);
  const tieColors = [
    0x76232b, 0x7d6943, 0x29433a, 0x512637, 0x645746, 0x2d4149,
    0x814b32, 0x4a5b66, 0x6e2930, 0x68643b, 0x68476e, 0x42624c
  ];
  findMesh(root, 'Oxblood tie').material.color.setHex(tieColors[variantIndex]);
  findMesh(root, 'Oxblood fedora band').material.color.setHex(tieColors[variantIndex]);

  scene.add(root);
  return {
    root,
    body,
    bodyHeightScale: 1.15,
    head,
    headTilt,
    hand,
    arm,
    eyes,
    nextBlinkAt: performance.now() + 1200 + Math.random() * 4000,
    blinkUntil: 0,
    hitAt: 0,
    firstPersonParts: [
      findObject(root, 'Torso'),
      findObject(root, 'Legs'),
      findObject(root, 'High-backed Casino Chair')
    ],
    lives: 3,
    isDead: false,
    glow: coat.material
  };
}
