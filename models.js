import * as THREE from 'three';

const MODEL_PATH = new URL('./assets/blockbench/', import.meta.url);
const modelTemplates = new Map();
const textureCache = new Map();

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
    roughness: metal ? 0.42 : fabric ? 0.94 : wood ? 0.66 : 0.82,
    metalness: metal ? 0.68 : 0.02,
    side: THREE.DoubleSide
  });
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
  for (const face of Object.values(element.faces || {})) {
    const vertices = face.vertices || [];
    if (vertices.length < 3) continue;
    for (let triangle = 1; triangle < vertices.length - 1; triangle++) {
      for (const key of [vertices[0], vertices[triangle], vertices[triangle + 1]]) {
        const point = element.vertices[key];
        const uv = face.uv?.[key] || [0, 0];
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
  root.scale.setScalar(1 / 16);
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
    ['twin_chamber_revolver', 'twin_chamber_revolver.bbmodel'],
    ['chess_clock_monitor', 'chess_clock_monitor.bbmodel']
  ];
  const loaded = await Promise.all(assets.map(async ([key, filename]) => [key, await loadProject(filename)]));
  loaded.forEach(([key, model]) => modelTemplates.set(key, model));
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
  scene.add(environment);
  return environment;
}

export function createGun(scene) {
  const root = cloneModel('twin_chamber_revolver');
  root.position.set(0, 0.62, 0.35);
  scene.add(root);
  return {
    root,
    cyl: findObject(root, 'Cylinder'),
    hammer: findObject(root, 'Hammer'),
    trigger: findObject(root, 'Trigger'),
    primer: findObject(root, 'Primer')
  };
}

export function createMachine(scene, playerCount = 3) {
  const root = cloneModel('chess_clock_monitor');
  const housing = findObject(root, 'Housing');
  const gaugeTemplate = findObject(root, 'Gauge');
  gaugeTemplate.removeFromParent();

  const width = Math.max(1.3, playerCount * 0.4 + 0.2);
  housing.scale.x = width * 16 / 84;
  const spacing = ((width - 0.2) / playerCount) * 16;
  const radius = Math.min(0.155, spacing / 16 * 0.39);
  const needles = [];
  const lifeSegments = [];
  const lifeLevels = Array(playerCount).fill(null);

  for (let index = 0; index < playerCount; index++) {
    const gauge = gaugeTemplate.clone(true);
    gauge.name = `Gauge ${index + 1}`;
    gauge.position.set((index - (playerCount - 1) / 2) * spacing, 5, 0);
    gauge.scale.setScalar(radius / 0.169);
    cloneMaterials(gauge);
    root.add(gauge);
    needles.push(findObject(gauge, 'Needle'));
    lifeSegments.push([1, 2, 3].map(segment => findMesh(gauge, `Life indicator lamp ${segment}`).material));
  }

  root.position.set(0, 0.14, 1.85);
  scene.add(root);
  return {
    root,
    screenMat: findMesh(root, 'Front status lamp').material,
    needles,
    lifeSegments,
    lifeLevels
  };
}

export function createMafiaPlayer(scene, x, y, z, rotY, variant = 0) {
  const root = cloneModel('seated_mafioso');
  cloneMaterials(root);
  root.position.set(x, y, z);
  root.rotation.y = rotY;
  root.scale.y *= [0.97, 1.03, 1, 0.96, 1.04, 1][Math.abs(Math.trunc(variant)) % 6];

  const body = findObject(root, 'Body');
  const head = findObject(root, 'Head');
  const arm = findObject(root, 'LeftArm');
  const hand = findObject(root, 'Hand');
  const coat = findMesh(root, 'Low-poly trenchcoat silhouette');
  coat.material.emissive.setHex(0x390b10);
  coat.material.emissiveIntensity = 0;
  const coatVariants = [0x424144, 0x474342, 0x3e4144, 0x45413c, 0x3f3d41, 0x49443f];
  coat.material.color.setHex(coatVariants[Math.abs(Math.trunc(variant)) % coatVariants.length]);

  scene.add(root);
  return {
    root,
    body,
    head,
    hand,
    arm,
    eyes: [],
    nextBlinkAt: performance.now() + 1200 + Math.random() * 4000,
    blinkUntil: 0,
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
