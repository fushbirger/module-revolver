import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const MODEL_PATH = new URL('./assets/blockbench/', import.meta.url);
const BLOCKBENCH_SCALE = 1 / 16;
export const PLAYER_SCALE = 1;
export const MODEL_STYLES = ['realistic', 'lowpoly'];

const modelTemplates = new Map();
const textureCache = new Map();
const eyeGeometry = new THREE.SphereGeometry(0.2, 12, 10);
const noseGeometry = new THREE.ConeGeometry(0.28, 1.0, 6);
let activeStyle = 'lowpoly';

export function resolveModelStyle(value) {
  return MODEL_STYLES.includes(value) ? value : 'lowpoly';
}

export function mk(geometry, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, cast = true) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  return mesh;
}

function makeMaterial(maps, name, style) {
  const lowpoly = style === 'lowpoly';
  const material = new THREE.MeshStandardMaterial({
    map: maps.albedo,
    normalMap: maps.normal || null,
    roughnessMap: maps.roughness || null,
    metalnessMap: maps.metalness || null,
    roughness: maps.roughness ? 1 : 0.8,
    metalness: maps.metalness ? 1 : 0.08,
    flatShading: lowpoly,
    side: THREE.DoubleSide,
    envMapIntensity: 0.45
  });
  if (maps.normal) material.normalScale.set(1.1, 1.1);
  if (/fortuna lettering/i.test(name)) {
    material.emissive.setHex(0xffffff);
    material.emissiveMap = maps.albedo;
    material.emissiveIntensity = 1.5;
    material.toneMapped = false;
  }
  if (/status lamp|life lamp/i.test(name)) {
    material.emissive.setHex(0x9a8f74);
    material.emissiveIntensity = 0.5;
  }
  if (/gauge dial/i.test(name)) {
    material.emissive.setHex(0x8d8468);
    material.emissiveIntensity = 0.22;
  }
  return material;
}

function setTransform(object, position, rotation = [0, 0, 0]) {
  object.position.set(...position);
  object.rotation.set(...rotation.map(value => THREE.MathUtils.degToRad(value)));
}

function buildCube(element, maps, dimensions, parentOrigin, style) {
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
    const rect = face?.uv;
    if (!rect || face.texture === null) return;
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
  const origin = element.origin || element.from.map((value, i) => (value + element.to[i]) / 2);
  setTransform(pivot, origin.map((value, i) => value - parentOrigin[i]), element.rotation);
  const mesh = new THREE.Mesh(geometry, makeMaterial(maps, element.name, style));
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

function buildMesh(element, maps, dimensions, parentOrigin, style) {
  const positions = [];
  const uvs = [];
  const vertices = element.vertices || {};
  for (const face of Object.values(element.faces || {})) {
    const keys = face.vertices || [];
    if (keys.length < 3) continue;
    for (let triangle = 1; triangle < keys.length - 1; triangle++) {
      for (const key of [keys[0], keys[triangle], keys[triangle + 1]]) {
        const point = vertices[key];
        if (!point) continue;
        const uv = face.uv?.[key] || [0, 0];
        positions.push(
          point[0] - (element.origin?.[0] || 0),
          point[1] - (element.origin?.[1] || 0),
          point[2] - (element.origin?.[2] || 0)
        );
        uvs.push(uv[0] / dimensions.width, 1 - uv[1] / dimensions.height);
      }
    }
  }
  let geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  if (style === 'realistic') {
    geometry = mergeVertices(geometry, 1e-3);
  }
  geometry.computeVertexNormals();

  const pivot = new THREE.Group();
  pivot.name = element.name;
  const origin = element.origin || [0, 0, 0];
  setTransform(pivot, origin.map((value, i) => value - parentOrigin[i]), element.rotation);
  const mesh = new THREE.Mesh(geometry, makeMaterial(maps, element.name, style));
  mesh.name = element.name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  pivot.add(mesh);
  return pivot;
}

function createProject(project, maps, style) {
  const elements = new Map(project.elements.map(element => [element.uuid, element]));
  const groups = new Map((project.groups || []).map(group => [group.uuid, group]));
  const root = new THREE.Group();
  root.name = project.name;

  const addOutlinerNode = (node, parent, parentOrigin = [0, 0, 0]) => {
    if (typeof node === 'string') {
      const element = elements.get(node);
      if (!element) throw new Error(`Blockbench project "${project.name}" references missing element "${node}"`);
      const object = element.type === 'mesh'
        ? buildMesh(element, maps, project.resolution, parentOrigin, style)
        : buildCube(element, maps, project.resolution, parentOrigin, style);
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

async function loadMap(url, srgb) {
  const key = `${url}|${srgb}`;
  const cached = textureCache.get(key);
  if (cached) return cached;
  const texture = await new THREE.TextureLoader().loadAsync(url);
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.anisotropy = 8;
  textureCache.set(key, texture);
  return texture;
}

async function loadProject(filename, style) {
  const response = await fetch(new URL(filename, MODEL_PATH));
  if (!response.ok) throw new Error(`Unable to load Blockbench asset ${filename}: HTTP ${response.status}`);
  const project = await response.json();
  if (project.meta?.model_format !== 'free' || !Array.isArray(project.elements) || !Array.isArray(project.textures)) {
    throw new Error(`Invalid Blockbench project: ${filename}`);
  }

  const albedoPath = project.textures[0]?.path || `textures/${style}_albedo.png`;
  const maps = { albedo: await loadMap(new URL(albedoPath, MODEL_PATH), true) };
  if (style === 'realistic') {
    maps.roughness = await loadMap(new URL('textures/realistic_roughness.png', MODEL_PATH), false);
    maps.metalness = await loadMap(new URL('textures/realistic_metalness.png', MODEL_PATH), false);
    maps.normal = await loadMap(new URL('textures/realistic_normal.png', MODEL_PATH), false);
  }
  return createProject(project, maps, style);
}

export async function preloadBlockbenchAssets(style = 'lowpoly') {
  activeStyle = resolveModelStyle(style);
  const assets = [
    ['casino_environment', `casino_environment_${activeStyle}.bbmodel`],
    ['seated_mafioso', `seated_mafioso_${activeStyle}.bbmodel`],
    ['chess_clock_monitor', `chess_clock_monitor_${activeStyle}.bbmodel`],
    ['twin_chamber_revolver', `twin_chamber_revolver_${activeStyle}.bbmodel`]
  ];
  const loaded = await Promise.all(assets.map(async ([key, filename]) =>
    [key, await loadProject(filename, activeStyle)]));
  loaded.forEach(([key, model]) => modelTemplates.set(key, model));
  return activeStyle;
}

function cloneModel(key) {
  const template = modelTemplates.get(key);
  if (!template) throw new Error(`Blockbench asset "${key}" was not preloaded`);
  return template.clone(true);
}

// A whisper of self-illumination from the albedo so a figure sitting 8 m from the
// pendant still reads as a silhouette instead of a hole in the frame.
function liftFromBlack(root, color = 0x4a423a, intensity = 0.9) {
  root.traverse(object => {
    if (!object.isMesh || !object.material || !object.material.map) return;
    object.material.emissiveMap = object.material.map;
    object.material.emissive = new THREE.Color(color);
    object.material.emissiveIntensity = intensity;
    object.material.needsUpdate = true;
  });
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
  const root = new THREE.Group();
  root.name = 'Fortuna Twin-chamber Revolver';
  const model = cloneModel('twin_chamber_revolver');
  model.scale.setScalar(BLOCKBENCH_SCALE);
  model.traverse(object => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });
  root.position.set(0, 0.88, 0.35);
  root.add(model);
  scene.add(root);
  return { root, model };
}

export function createMachine(scene) {
  const root = cloneModel('chess_clock_monitor');
  cloneMaterials(root);
  const gauge = findObject(root, 'Gauge');
  const needleTemplate = findObject(gauge, 'Needle');
  needleTemplate.removeFromParent();
  const needles = [];
  for (let index = 0; index < 3; index++) {
    const needle = needleTemplate.clone(true);
    needle.name = `Life needle ${index + 1}`;
    needle.rotation.z = (index - 1) * 0.22;
    cloneMaterials(needle);
    const pointer = findMesh(needle, 'Red gauge needle');
    pointer.material.emissive.setHex(0x8e1119);
    pointer.material.emissiveIntensity = 1.6;
    gauge.add(needle);
    needles.push(needle);
    findObject(root, `LifeSegment${index + 1}`).visible = false;
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
  liftFromBlack(root);
  root.position.set(x, y, z);
  root.rotation.y = rotY;
  root.scale.setScalar(BLOCKBENCH_SCALE);
  const variantIndex = Math.abs(Math.trunc(variant)) % 12;
  root.scale.y *= [0.985, 1.02, 1, 0.975, 1.03, 1.01, 0.99, 1.015, 0.97, 1.035, 0.995, 1.012][variantIndex];
  root.scale.x *= [0.99, 1.015, 0.975, 1.03, 1, 1.02, 1.035, 0.985, 1.01, 0.98, 1.025, 0.995][variantIndex];
  root.scale.z *= [1.01, 0.985, 1.03, 0.99, 1.02, 0.98, 0.975, 1.025, 1, 1.035, 0.99, 1.015][variantIndex];

  const body = findObject(root, 'Body');
  const head = findObject(root, 'Head');
  const headTilts = [-0.035, 0.022, 0.045, -0.018, 0.032, -0.028, 0.012, -0.046, 0.038, -0.008, 0.05, -0.024];
  const headTilt = headTilts[variantIndex];
  head.rotation.z = headTilt;

  const eyeMaterial = new THREE.MeshStandardMaterial({
    color: 0x2b1411,
    emissive: 0xff4a2c,
    emissiveIntensity: 1.9,
    roughness: 0.34
  });
  const eyes = [-0.62, 0.62].map(ex => {
    const eye = mk(eyeGeometry, eyeMaterial, ex, 2.25, 1.52, 0, 0, 0, false);
    eye.scale.set(1, 0.55, 0.4);
    eye.userData.openScaleY = 0.55;
    head.add(eye);
    return eye;
  });
  head.add(mk(
    noseGeometry,
    new THREE.MeshStandardMaterial({ color: 0x5a463c, roughness: 0.9 }),
    0, 1.7, 1.78, Math.PI / 2, 0, 0, false
  ));

  const arm = findObject(root, 'GunArm');
  const hand = findObject(root, 'Hand');
  const coat = findMesh(root, 'Trench coat');
  coat.material.emissive.setHex(0x8a7f68);
  coat.material.emissiveIntensity = 0;
  const coatVariants = [
    0x4a4b4c, 0x3d4145, 0x4c4741, 0x3b3d42, 0x494346, 0x3f4744,
    0x504a43, 0x41474b, 0x4f4446, 0x46433d, 0x3c3a42, 0x434a44
  ];
  coat.material.color.setHex(coatVariants[variantIndex]);
  const tieColors = [
    0x6a2026, 0x5a4a38, 0x2c3d36, 0x4a2430, 0x554a3c, 0x2b3b42,
    0x6b4030, 0x414c54, 0x5c2429, 0x545033, 0x4f3a54, 0x3a4f40
  ];
  findMesh(root, 'Oxblood tie').material.color.setHex(tieColors[variantIndex]);
  findMesh(root, 'Oxblood fedora band').material.color.setHex(tieColors[variantIndex]);

  scene.add(root);
  return {
    root,
    body,
    bodyHeightScale: 1,
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
      findObject(root, 'High-backed Casino Chair'),
      findObject(root, 'Coat upper arm'),
      findObject(root, 'Coat forearm')
    ],
    lives: 3,
    isDead: false,
    glow: coat.material
  };
}
