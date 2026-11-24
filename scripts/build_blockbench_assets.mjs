import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const output = new URL('../assets/blockbench/', import.meta.url);
const size = 256;
const tileSize = 64;
const materials = [
  { name: 'charcoal_fabric', color: [37, 39, 42], kind: 'fabric' },
  { name: 'oxide_steel', color: [57, 59, 61], kind: 'metal' },
  { name: 'worn_steel', color: [112, 111, 106], kind: 'metal' },
  { name: 'dark_veneer', color: [47, 35, 29], kind: 'wood' },
  { name: 'oxblood_velvet', color: [57, 13, 19], kind: 'velvet' },
  { name: 'black_leather', color: [25, 20, 20], kind: 'leather' },
  { name: 'aged_brass', color: [125, 105, 69], kind: 'metal' },
  { name: 'dial_ivory', color: [164, 157, 139], kind: 'paper' },
  { name: 'stained_concrete', color: [38, 39, 41], kind: 'concrete' },
  { name: 'red_lining', color: [89, 20, 27], kind: 'fabric' },
  { name: 'face_shadow', color: [12, 13, 15], kind: 'concrete' },
  { name: 'black_enamel', color: [19, 20, 22], kind: 'metal' }
];

function hash(x, y, seed) {
  let value = Math.imul(x + seed, 0x45d9f3b) ^ Math.imul(y - seed, 0x119de1f3);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function pixelAtlas() {
  const rgba = Buffer.alloc(size * size * 4);
  for (let index = 0; index < materials.length; index++) {
    const material = materials[index];
    const x0 = (index % 4) * tileSize;
    const y0 = Math.floor(index / 4) * tileSize;
    for (let y = 0; y < tileSize; y++) {
      for (let x = 0; x < tileSize; x++) {
        const noise = (hash(x, y, index + 29) - 0.5) * 21;
        const grain = material.kind === 'wood'
          ? Math.sin(y * 0.39 + Math.sin(x * 0.13) * 2) * 9
          : material.kind === 'fabric'
            ? ((x + y) % 4 === 0 ? 5 : -2)
            : material.kind === 'metal' && (y + Math.floor(x * 0.12)) % 19 === 0
              ? 17
              : 0;
        const shade = Math.round(noise + grain);
        const offset = ((y0 + y) * size + x0 + x) * 4;
        rgba[offset] = Math.max(0, Math.min(255, material.color[0] + shade));
        rgba[offset + 1] = Math.max(0, Math.min(255, material.color[1] + shade));
        rgba[offset + 2] = Math.max(0, Math.min(255, material.color[2] + shade));
        rgba[offset + 3] = 255;
      }
    }
  }

  const signY = tileSize * 3;
  for (let y = signY; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const border = x < 3 || x >= size - 3 || y < signY + 3 || y >= size - 3;
      const panel = y >= signY + 15 && y < signY + 50 && x >= 12 && x < size - 12;
      const color = border ? [132, 112, 75] : panel ? [110, 22, 30] : [19, 20, 22];
      const offset = (y * size + x) * 4;
      rgba[offset] = color[0];
      rgba[offset + 1] = color[1];
      rgba[offset + 2] = color[2];
      rgba[offset + 3] = 255;
    }
  }
  const glyphs = {
    F: ['11111','10000','11110','10000','10000','10000','10000'],
    O: ['01110','10001','10001','10001','10001','10001','01110'],
    R: ['11110','10001','10001','11110','10100','10010','10001'],
    T: ['11111','00100','00100','00100','00100','00100','00100'],
    U: ['10001','10001','10001','10001','10001','10001','01110'],
    N: ['10001','11001','11001','10101','10011','10011','10001'],
    A: ['01110','10001','10001','11111','10001','10001','10001']
  };
  const title = 'FORTUNA';
  const scale = 4;
  const width = title.length * 6 * scale - scale;
  let xStart = Math.floor((size - width) / 2);
  for (const letter of title) {
    glyphs[letter].forEach((row, rowIndex) => {
      for (let column = 0; column < row.length; column++) {
        if (row[column] !== '1') continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const x = xStart + column * scale + sx;
            const y = signY + 22 + rowIndex * scale + sy;
            const offset = (y * size + x) * 4;
            rgba[offset] = 222;
            rgba[offset + 1] = 213;
            rgba[offset + 2] = 190;
          }
        }
      }
    });
    xStart += 6 * scale;
  }

  const crcTable = Array.from({ length: 256 }, (_, value) => {
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
  });
  const crc32 = (data) => {
    let crc = 0xffffffff;
    for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const name = Buffer.from(type);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([length, name, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const atlas = pixelAtlas();
const atlasData = `data:image/png;base64,${atlas.toString('base64')}`;
const faceNames = ['north', 'east', 'south', 'west', 'up', 'down'];
const materialIndex = Object.fromEntries(materials.map((material, index) => [material.name, index]));

function tileUv(index) {
  if (index === 'sign') return [0, 192, 256, 256];
  const material = typeof index === 'string' ? materialIndex[index] : index;
  const x = (material % 4) * tileSize;
  const y = Math.floor(material / 4) * tileSize;
  return [x, y, x + tileSize, y + tileSize];
}

function project(name, description) {
  const elements = [];
  const root = { name: 'Model', origin: [0, 0, 0], rotation: [0, 0, 0], children: [] };
  const group = (name, origin = [0, 0, 0], parent = root) => {
    const node = { name, uuid: randomUUID(), origin, rotation: [0, 0, 0], children: [] };
    parent.children.push(node);
    return node;
  };
  const addCube = (parent, name, from, to, surface, rotation = [0, 0, 0], origin = from.map((value, i) => (value + to[i]) / 2)) => {
    const id = randomUUID();
    const uv = tileUv(surface);
    elements.push({
      name, uuid: id, type: 'cube', from, to, origin, rotation,
      box_uv: false, autouv: 0, color: 0, rescale: false,
      faces: Object.fromEntries(faceNames.map(face => [face, { uv, texture: 0 }]))
    });
    parent.children.push(id);
    return id;
  };
  const addMesh = (parent, name, vertices, faces, surface) => {
    const uvRect = tileUv(surface);
    const meshFaces = {};
    for (const [index, points] of faces.entries()) {
      const uvs = {};
      points.forEach((key, pointIndex) => {
        const [u0, v0, u1, v1] = uvRect;
        const corners = [
          [u0, v0], [u0, v1], [u1, v1], [u1, v0]
        ];
        uvs[key] = corners[pointIndex] || [(u0 + u1) / 2, (v0 + v1) / 2];
      });
      meshFaces[index] = { vertices: points, uv: uvs, texture: 0 };
    }
    const id = randomUUID();
    elements.push({
      name, uuid: id, type: 'mesh', origin: [0, 0, 0], rotation: [0, 0, 0],
      vertices, faces: meshFaces
    });
    parent.children.push(id);
    return id;
  };
  const cylinder = (parent, name, cx, cy, cz, radius, depth, surface, segments = 12, axis = 'y') => {
    const vertices = {};
    const faces = [];
    for (let end = 0; end < 2; end++) {
      for (let i = 0; i < segments; i++) {
        const angle = i / segments * Math.PI * 2;
        const a = Math.cos(angle) * radius, b = Math.sin(angle) * radius;
        const key = `${end}_${i}`;
        if (axis === 'y') vertices[key] = [cx + a, cy + (end ? depth / 2 : -depth / 2), cz + b];
        else if (axis === 'z') vertices[key] = [cx + a, cy + b, cz + (end ? depth / 2 : -depth / 2)];
        else vertices[key] = [cx + (end ? depth / 2 : -depth / 2), cy + a, cz + b];
      }
    }
    if (axis === 'y') {
      vertices.bottom_center = [cx, cy - depth / 2, cz];
      vertices.top_center = [cx, cy + depth / 2, cz];
    } else if (axis === 'z') {
      vertices.bottom_center = [cx, cy, cz - depth / 2];
      vertices.top_center = [cx, cy, cz + depth / 2];
    } else {
      vertices.bottom_center = [cx - depth / 2, cy, cz];
      vertices.top_center = [cx + depth / 2, cy, cz];
    }
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      faces.push([`0_${i}`, `0_${next}`, `1_${next}`, `1_${i}`]);
      faces.push(['top_center', `1_${i}`, `1_${next}`]);
      faces.push(['bottom_center', `0_${next}`, `0_${i}`]);
    }
    return addMesh(parent, name, vertices, faces, surface);
  };
  const torus = (parent, name, cx, cy, cz, radius, tube, surface, around = 24, sides = 6, axis = 'y') => {
    const vertices = {};
    const faces = [];
    for (let i = 0; i < around; i++) {
      const a = i / around * Math.PI * 2;
      for (let j = 0; j < sides; j++) {
        const b = j / sides * Math.PI * 2;
        const r = radius + Math.cos(b) * tube;
        vertices[`${i}_${j}`] = axis === 'z'
          ? [cx + Math.cos(a) * r, cy + Math.sin(a) * r, cz + Math.sin(b) * tube]
          : [cx + Math.cos(a) * r, cy + Math.sin(b) * tube, cz + Math.sin(a) * r];
      }
    }
    for (let i = 0; i < around; i++) {
      for (let j = 0; j < sides; j++) {
        faces.push([
          `${i}_${j}`,
          `${(i + 1) % around}_${j}`,
          `${(i + 1) % around}_${(j + 1) % sides}`,
          `${i}_${(j + 1) % sides}`
        ]);
      }
    }
    return addMesh(parent, name, vertices, faces, surface);
  };
  const tubeBetween = (parent, name, a, b, radius, surface, segments = 8) => {
    const start = new THREEVector(a);
    const end = new THREEVector(b);
    const direction = normalize(subtract(end, start));
    const helper = Math.abs(direction[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = normalize(cross(direction, helper));
    const v = normalize(cross(direction, u));
    const vertices = {};
    const faces = [];
    for (let cap = 0; cap < 2; cap++) {
      const center = cap ? end : start;
      vertices[cap ? 'end_center' : 'start_center'] = center;
      for (let i = 0; i < segments; i++) {
        const angle = i / segments * Math.PI * 2;
        const point = center.map((value, axis) => value + radius * (Math.cos(angle) * u[axis] + Math.sin(angle) * v[axis]));
        vertices[`${cap}_${i}`] = point;
      }
    }
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      faces.push([`0_${i}`, `0_${next}`, `1_${next}`, `1_${i}`]);
      faces.push(['start_center', `0_${next}`, `0_${i}`]);
      faces.push(['end_center', `1_${i}`, `1_${next}`]);
    }
    return addMesh(parent, name, vertices, faces, surface);
  };
  const loft = (parent, name, cx, cz, profiles, surface, segments = 10) => {
    const vertices = {};
    const faces = [];
    profiles.forEach(([y, rx, rz], ring) => {
      for (let i = 0; i < segments; i++) {
        const angle = i / segments * Math.PI * 2;
        vertices[`${ring}_${i}`] = [cx + Math.cos(angle) * rx, y, cz + Math.sin(angle) * rz];
      }
    });
    for (let ring = 0; ring < profiles.length - 1; ring++) {
      for (let i = 0; i < segments; i++) {
        const next = (i + 1) % segments;
        faces.push([`${ring}_${i}`, `${ring}_${next}`, `${ring + 1}_${next}`, `${ring + 1}_${i}`]);
      }
    }
    for (let i = 1; i < segments - 1; i++) {
      faces.push([`0_0`, `0_${i}`, `0_${i + 1}`]);
      const last = profiles.length - 1;
      faces.push([`${last}_0`, `${last}_${i + 1}`, `${last}_${i}`]);
    }
    return addMesh(parent, name, vertices, faces, surface);
  };
  const plane = (parent, name, points, surface) => {
    const vertices = Object.fromEntries(points.map(([key, point]) => [key, point]));
    return addMesh(parent, name, vertices, [points.map(([key]) => key)], surface);
  };
  const serializeGroup = (node) => ({
    uuid: node.uuid,
    name: node.name,
    origin: node.origin,
    rotation: node.rotation,
    export: true,
    isOpen: true
  });
  const serializeOutliner = (node) => ({
    uuid: node.uuid,
    isOpen: true,
    children: node.children.map(child => typeof child === 'string' ? child : serializeOutliner(child))
  });
  const collectGroups = (node) => node.flatMap(child => {
    if (typeof child === 'string') return [];
    return [serializeGroup(child), ...collectGroups(child.children)];
  });
  const save = async (filename) => {
    const model = {
      name, model_identifier: name.toLowerCase().replaceAll(' ', '_'),
      meta: { format_version: '4.10', model_format: 'free', box_uv: false },
      resolution: { width: size, height: size },
      elements,
      groups: collectGroups(root.children),
      outliner: root.children.map(serializeOutliner),
      textures: [{
        path: 'noir_material_atlas.png', relative_path: 'noir_material_atlas.png',
        name: 'noir_material_atlas.png', folder: '', namespace: '', id: '0',
        width: size, height: size, uv_width: size, uv_height: size,
        particle: false, use_as_default: true, internal: true, saved: true,
        pbr_channel: 'color', uuid: randomUUID(), source: atlasData
      }],
      description
    };
    await writeFile(new URL(filename, output), `${JSON.stringify(model)}\n`);
  };
  return { group, addCube, addMesh, cylinder, torus, tubeBetween, loft, plane, save };
}

function THREEVector(value) { return [...value]; }
function subtract(a, b) { return a.map((value, index) => value - b[index]); }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function normalize(value) {
  const length = Math.hypot(...value) || 1;
  return value.map(component => component / length);
}

await mkdir(output, { recursive: true });
await writeFile(new URL('noir_material_atlas.png', output), atlas);

const casino = project(
  'Fortuna Casino Interior',
  'Editable low-poly noir casino environment and round dark-wood-veneer table.'
);
const room = casino.group('Room Shell');
casino.addCube(room, 'Stained concrete floor', [-160, -24, -160], [160, -20, 160], 'stained_concrete');
casino.addCube(room, 'Far wall', [-152, -20, -152], [152, 100, -146], 'stained_concrete');
casino.addCube(room, 'Left wall', [-152, -20, -146], [-146, 100, 152], 'stained_concrete');
casino.addCube(room, 'Right wall', [146, -20, -146], [152, 100, 152], 'stained_concrete');
for (let i = 0; i < 7; i++) {
  const x = -116 + i * 38;
  casino.addCube(room, `Oxblood velvet wall panel ${i + 1}`, [x, -18, -143], [x + 32, 54, -141], 'oxblood_velvet');
  casino.addCube(room, `Antique brass reveal ${i + 1}`, [x - 2, -18, -140], [x, 56, -138], 'aged_brass');
}
for (const x of [-124, -84, 84, 124]) {
  casino.addCube(room, 'Casino pilaster', [x - 4, -18, -124], [x + 4, 88, -116], 'black_enamel');
  casino.addCube(room, 'Pilaster brass cap', [x - 6, 82, -126], [x + 6, 86, -114], 'aged_brass');
}

const signGroup = casino.group('Fortuna Sign');
casino.addCube(signGroup, 'Illuminated FORTUNA placard', [-38, 74, -143], [38, 94, -140], 'black_enamel');
casino.addCube(signGroup, 'FORTUNA red enamel inset', [-34, 78, -139], [34, 90, -138], 'red_lining');
casino.plane(signGroup, 'FORTUNA lettering', [
  ['a', [-34, 90, -137.7]], ['b', [-34, 78, -137.7]],
  ['c', [34, 78, -137.7]], ['d', [34, 90, -137.7]]
], 'sign');

const roulette = casino.group('Wall Roulette');
casino.cylinder(roulette, 'Roulette outer housing', 0, 48, -137, 20, 3, 'dark_veneer', 32, 'z');
casino.torus(roulette, 'Roulette brass rim', 0, 48, -134.5, 18.5, 1.2, 'aged_brass', 32, 6, 'z');
casino.cylinder(roulette, 'Roulette velvet field', 0, 48, -133.6, 11, 1.4, 'oxblood_velvet', 32, 'z');
casino.cylinder(roulette, 'Roulette spindle', 0, 48, -132.4, 2.5, 1.6, 'aged_brass', 12, 'z');
for (let i = 0; i < 24; i++) {
  const angle = i / 24 * Math.PI * 2;
  const radius = 14;
  const x = Math.sin(angle) * radius;
  const y = 48 + Math.cos(angle) * radius;
  casino.addCube(roulette, `Roulette pocket ${String(i + 1).padStart(2, '0')}`,
    [x - 1.1, y - 3.4, -132.7], [x + 1.1, y + 3.4, -131.8],
    i % 2 ? 'aged_brass' : 'red_lining', [0, 0, -angle * 180 / Math.PI]);
}

const mainTable = casino.group('Round Pedestal Table');
casino.cylinder(mainTable, 'Weighted pedestal foot', 0, -18, 0, 16, 3, 'dark_veneer', 24);
casino.cylinder(mainTable, 'Turned pedestal column', 0, -10, 0, 6, 15, 'dark_veneer', 16);
casino.cylinder(mainTable, 'Pedestal brass collar', 0, -5, 0, 7, 1, 'aged_brass', 16);
casino.cylinder(mainTable, 'Round table apron', 0, -2, 0, 40, 4, 'dark_veneer', 48);
casino.cylinder(mainTable, 'Dark wooden veneer tabletop', 0, 0, 0, 41, 3.8, 'dark_veneer', 48);
casino.torus(mainTable, 'Outer brass table inlay', 0, -0.1, 0, 39.4, 0.85, 'aged_brass', 48, 6);
casino.torus(mainTable, 'Inner veneer pinstripe', 0, 0.4, 0, 35, 0.24, 'red_lining', 48, 5);

const fixtures = casino.group('Casino Fixtures');
for (const x of [-98, -50, 50, 98]) {
  casino.addCube(fixtures, 'Sconce backplate', [x - 5, 49, -140], [x + 5, 58, -136], 'aged_brass');
  casino.addCube(fixtures, 'Sconce oxblood shade', [x - 3, 43, -138], [x + 3, 52, -135], 'oxblood_velvet');
  casino.addCube(fixtures, 'Sconce warm glass', [x - 2, 44, -134], [x + 2, 50, -133], 'dial_ivory');
}
for (let i = 0; i < 5; i++) {
  const x = -104 + i * 52;
  casino.addCube(fixtures, 'Art-deco gaming cabinet', [x - 9, -19, -126], [x + 9, 24, -112], 'oxide_steel');
  casino.addCube(fixtures, 'Cabinet inset screen', [x - 7, 2, -110], [x + 7, 17, -109], i % 2 ? 'red_lining' : 'black_enamel');
  casino.addCube(fixtures, 'Cabinet brass foot rail', [x - 10, -17, -110], [x + 10, -14, -108], 'aged_brass');
}
for (const x of [-48, -18, 18, 48]) {
  casino.cylinder(fixtures, 'Pendant stem', x, 82, -34, 0.45, 10, 'aged_brass', 8);
  casino.torus(fixtures, 'Pendant brass shade', x, 77, -34, 4.5, 0.75, 'aged_brass', 12, 5);
  casino.cylinder(fixtures, 'Pendant frosted glass', x, 76, -34, 2.2, 1.6, 'dial_ivory', 12);
}
await casino.save('casino_environment.bbmodel');

const player = project(
  'Seated Trenchcoat Mafioso',
  'Faceless seated mafia silhouette with a tailored trench coat and high-backed casino chair. The faceted forms use the desaturated fever-noir material atlas.'
);
const chair = player.group('High-backed Casino Chair');
player.addCube(chair, 'Chair carved wood seat', [-9, 5, -8], [9, 8, 10], 'dark_veneer');
player.addCube(chair, 'Oxblood seat cushion', [-8, 8, -7], [8, 10, 9], 'oxblood_velvet');
player.addCube(chair, 'Chair back wood frame left', [-9, 9, -10], [-7, 30, -7], 'dark_veneer');
player.addCube(chair, 'Chair back wood frame right', [7, 9, -10], [9, 30, -7], 'dark_veneer');
player.addCube(chair, 'Chair upholstered back', [-7, 11, -9], [7, 28, -8], 'oxblood_velvet');
player.addCube(chair, 'Chair top rail', [-9, 28, -10], [9, 30, -7], 'dark_veneer');
player.addCube(chair, 'Chair brass inset', [-6, 18, -7.5], [6, 19, -7], 'aged_brass');
for (const x of [-8, 8]) {
  player.addCube(chair, 'Chair front leg', [x - 1, -7, 7], [x + 1, 7, 9], 'dark_veneer');
  player.addCube(chair, 'Chair rear leg', [x - 1, -7, -7], [x + 1, 7, -5], 'dark_veneer');
  player.addCube(chair, 'Chair arm rail', [x - 2, 14, -1], [x + 2, 16, 8], 'dark_veneer');
  player.addCube(chair, 'Chair arm leather pad', [x - 2.5, 16, -1], [x + 2.5, 17.5, 8], 'black_leather');
}

const body = player.group('Body', [0, 8, 0]);
const torso = player.group('Torso', [0, 8, 0], body);
player.loft(torso, 'Low-poly trenchcoat silhouette', 0, 1, [
  [7, 7.5, 4.5], [10, 8, 5], [15, 7.2, 4.4], [19, 9.5, 4.8], [21, 8.5, 4]
], 'charcoal_fabric', 12);
player.addCube(torso, 'Black shirt inset', [-2, 14, 5.1], [2, 19, 5.7], 'black_enamel');
player.addCube(torso, 'Oxblood tie', [-1, 13, 5.8], [1, 18, 6.1], 'red_lining');
player.addCube(torso, 'Trench coat belt', [-7.5, 11, 4.8], [7.5, 12, 5.4], 'black_leather');
player.addCube(torso, 'Belt buckle', [-1, 10.7, 5.5], [1, 12.2, 5.8], 'aged_brass');
player.addCube(torso, 'Left tailored lapel', [-7, 18, 5], [-1, 21, 5.8], 'black_leather', [0, 0, -18]);
player.addCube(torso, 'Right tailored lapel', [1, 18, 5], [7, 21, 5.8], 'black_leather', [0, 0, 18]);
player.addCube(torso, 'Visible red coat lining', [-6.5, 6, 4.4], [6.5, 8, 4.9], 'red_lining');
for (const y of [14, 16, 18]) player.cylinder(torso, 'Aged brass coat button', 0, y, 5.9, 0.42, 0.35, 'aged_brass', 8, 'z');

const legs = player.group('Legs', [0, 8, 0], body);
player.tubeBetween(legs, 'Left trouser leg', [-4, 8, 0], [-4, 0, 5], 2.7, 'charcoal_fabric', 8);
player.tubeBetween(legs, 'Right trouser leg', [4, 8, 0], [4, 0, 5], 2.7, 'charcoal_fabric', 8);
player.addCube(legs, 'Left polished shoe', [-7, -1.5, 3], [-1, 1, 11], 'black_leather');
player.addCube(legs, 'Right polished shoe', [1, -1.5, 3], [7, 1, 11], 'black_leather');

const head = player.group('Head', [0, 25, 1], body);
player.loft(head, 'Featureless shadowed face', 0, 1, [
  [20, 3.4, 2.8], [22, 4.4, 3.3], [27, 4.3, 3.2], [30, 3.6, 2.8]
], 'face_shadow', 10);
player.addCube(head, 'Deep shadow face plane', [-3.6, 22, 4], [3.6, 28, 4.2], 'face_shadow');
player.addCube(head, 'Fedora brim', [-7, 29, -1], [7, 30.5, 7], 'black_leather');
player.addCube(head, 'Fedora crown', [-4.6, 30, 0], [4.6, 35.5, 5], 'charcoal_fabric');
player.addCube(head, 'Oxblood fedora band', [-4.7, 31.4, 4.7], [4.7, 32.5, 5.1], 'red_lining');

const leftArm = player.group('LeftArm', [-7, 19, 0], body);
player.tubeBetween(leftArm, 'Left coat upper arm', [-7, 19, 0], [-5, 14, 5], 2.3, 'charcoal_fabric', 8);
player.tubeBetween(leftArm, 'Left coat forearm', [-5, 14, 5], [-2, 10, 11], 1.8, 'charcoal_fabric', 8);
const hand = player.group('Hand', [-2, 10, 11], leftArm);
player.addMesh(hand, 'Gloved palm', {
  a: [-4, 9, 10], b: [0, 9, 10], c: [0, 12, 14], d: [-4, 12, 14],
  e: [-4, 9, 14], f: [0, 9, 14], g: [0, 12, 17], h: [-4, 12, 17]
}, [
  ['a','b','c','d'], ['e','h','g','f'], ['a','e','f','b'],
  ['b','f','g','c'], ['c','g','h','d'], ['d','h','e','a']
], 'black_leather');
for (let finger = 0; finger < 4; finger++) {
  const x = -3.2 + finger * 1.15;
  player.addCube(hand, 'Gloved finger', [x, 8.5, 15], [x + 0.75, 9.6, 19], 'black_leather');
}

const rightArm = player.group('RightArm', [7, 19, 0], body);
player.tubeBetween(rightArm, 'Right coat upper arm', [7, 19, 0], [6, 14, 4], 2.3, 'charcoal_fabric', 8);
player.tubeBetween(rightArm, 'Right coat forearm', [6, 14, 4], [4, 10, 10], 1.8, 'charcoal_fabric', 8);
player.addCube(rightArm, 'Right gloved hand', [2, 8.5, 9], [6, 12, 15], 'black_leather');
await player.save('seated_mafioso.bbmodel');

const gun = project(
  'Fortuna Twin-chamber Revolver',
  'Low-poly dark-oxide revolver with twin exposed chambers, a hexagonal barrel and a worn oxblood grip.'
);
const gunBody = gun.group('Body');
gun.addCube(gunBody, 'Revolver frame', [-2.2, -2.2, -4], [2.2, 2.2, 6], 'oxide_steel');
gun.addCube(gunBody, 'Frame lower rail', [-2, -4, -4], [2, -1.5, 1], 'black_enamel');
gun.addCube(gunBody, 'Upper barrel rail', [-1.4, 2, 0], [1.4, 2.8, 12], 'worn_steel');
gun.addCube(gunBody, 'Lower ejector rod', [-0.7, -2.8, -1], [0.7, -2, 9], 'worn_steel');
gun.addCube(gunBody, 'Ejector rod knurl', [-1, -3.1, 8], [1, -2.4, 10], 'oxide_steel');
gun.cylinder(gunBody, 'Hexagonal barrel', 0, 2, 13, 1.2, 10, 'worn_steel', 6, 'z');
gun.cylinder(gunBody, 'Black muzzle bore', 0, 2, 18.1, 0.58, 0.3, 'face_shadow', 8, 'z');
const grip = gun.group('Grip', [0, -3, -4]);
gun.addCube(grip, 'Grip dark iron backing', [-2.2, -3, -7], [2.2, -12, -3], 'oxide_steel', [18, 0, 0]);
gun.addCube(grip, 'Oxblood leather grip panel', [-2.5, -4, -6.8], [2.5, -11, -4.5], 'red_lining', [18, 0, 0]);
gun.addCube(grip, 'Grip medallion', [-0.8, -7, -4.2], [0.8, -8.5, -3.8], 'aged_brass');
const cylinderGroup = gun.group('Cylinder');
gun.cylinder(cylinderGroup, 'Six-sided revolver drum', 0, 0, 0, 3.6, 5.3, 'worn_steel', 12, 'z');
for (let i = 0; i < 2; i++) {
  const x = 0;
  const y = i === 0 ? 2.45 : -2.45;
  gun.cylinder(cylinderGroup, 'Dark chamber opening', x, y, -2.8, 0.7, 0.35, 'face_shadow', 8, 'z');
  gun.cylinder(cylinderGroup, 'Dark chamber opening', x, y, 2.8, 0.7, 0.35, 'face_shadow', 8, 'z');
}
const hammer = gun.group('Hammer', [0, 2.6, -4]);
gun.tubeBetween(hammer, 'Spur hammer', [0, 2.6, -4], [0, 5.6, -6], 0.6, 'worn_steel', 6);
gun.addCube(hammer, 'Hammer cap', [-1, 5.2, -6.8], [1, 6.1, -5.3], 'aged_brass');
const trigger = gun.group('Trigger', [0, -2, -2]);
gun.tubeBetween(trigger, 'Curved trigger', [0, -2, -2], [0, -5, 0], 0.42, 'worn_steel', 6);
const primer = gun.group('Primer', [0, 1, -1]);
gun.addCube(primer, 'Left thumb lever', [-3.5, 0, -2], [-2.5, 2, 2], 'worn_steel');
gun.addCube(primer, 'Right thumb lever', [2.5, 0, -2], [3.5, 2, 2], 'worn_steel');
await gun.save('twin_chamber_revolver.bbmodel');

const clock = project(
  'Fortuna Chess-clock Life Monitor',
  'Compact chess-clock-shaped industrial life monitor. Player gauges and needles are mounted on the reverse face; the runtime duplicates the editable gauge component for each seat.'
);
const housing = clock.group('Housing');
clock.addCube(housing, 'Chess-clock iron body', [-42, -4, -7], [42, 13, 7], 'oxide_steel');
clock.addCube(housing, 'Upper sloped case', [-40, 12, -6], [40, 18, 6], 'black_enamel');
clock.addCube(housing, 'Brass lower case rail', [-43, -5, -8], [43, -3.5, 8], 'aged_brass');
clock.addCube(housing, 'Central wine-red status strip', [-7, -1, 7.1], [7, 3, 7.6], 'red_lining');
clock.addCube(housing, 'Left chess-clock plunger', [-27, 17, -4], [-19, 21, 4], 'aged_brass');
clock.addCube(housing, 'Right chess-clock plunger', [19, 17, -4], [27, 21, 4], 'aged_brass');
clock.addCube(housing, 'Left plunger cap', [-28, 21, -5], [-18, 23, 5], 'black_enamel');
clock.addCube(housing, 'Right plunger cap', [18, 21, -5], [28, 23, 5], 'black_enamel');
const gauge = clock.group('Gauge');
clock.cylinder(gauge, 'Steel gauge bezel', 0, 0, -7.2, 2.7, 0.8, 'worn_steel', 16, 'z');
clock.cylinder(gauge, 'Ivory gauge dial', 0, 0, -7.8, 2.15, 0.25, 'dial_ivory', 16, 'z');
clock.cylinder(gauge, 'Dial shadow inset', 0, 0, -8, 1.7, 0.15, 'black_enamel', 16, 'z');
const needle = clock.group('Needle', [0, 0, -8.2], gauge);
clock.addCube(needle, 'Red gauge needle', [-0.18, -0.15, -8.35], [0.18, 1.55, -8.05], 'red_lining');
clock.cylinder(needle, 'Needle pivot', 0, 0, -8.0, 0.36, 0.3, 'aged_brass', 10, 'z');
for (let i = 0; i < 3; i++) {
  const segment = clock.group(`LifeSegment${i + 1}`, [0, 0, -8.4], gauge);
  clock.cylinder(segment, `Life indicator lamp ${i + 1}`, (i - 1) * 2.2, -4, -8.4, 0.65, 0.35,
    i === 2 ? 'red_lining' : 'worn_steel', 8, 'z');
}
clock.addCube(housing, 'Front glass status window', [-6, -1.8, -7.2], [6, 2, -6.7], 'black_enamel');
clock.addCube(housing, 'Front status lamp', [-3, -0.7, -7.4], [3, 0.9, -7], 'dial_ivory');
for (const x of [-39, 39]) {
  clock.cylinder(housing, 'Housing screw', x, 4, -7.3, 0.8, 0.4, 'aged_brass', 8, 'z');
}
await clock.save('chess_clock_monitor.bbmodel');

console.log('Generated Blockbench projects: casino_environment, seated_mafioso, twin_chamber_revolver, chess_clock_monitor');
