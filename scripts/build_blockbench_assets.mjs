import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const output = new URL('../assets/blockbench/', import.meta.url);
const textureDir = new URL('textures/', output);

/* ================================================================ materials */

const MATERIALS = [
  { name: 'concrete',      color: [64, 64, 63],   kind: 'concrete', rough: 0.95, metal: 0.0 },
  { name: 'concrete_dark', color: [46, 47, 47],   kind: 'concrete', rough: 0.97, metal: 0.0 },
  { name: 'steel',         color: [96, 99, 101],  kind: 'metal',    rough: 0.44, metal: 0.93 },
  { name: 'steel_worn',    color: [132, 132, 128], kind: 'metal',   rough: 0.31, metal: 0.95 },
  { name: 'oxide',         color: [64, 64, 62],   kind: 'metal',    rough: 0.68, metal: 0.86 },
  { name: 'brass',         color: [138, 122, 90], kind: 'metal',    rough: 0.36, metal: 0.92 },
  { name: 'walnut',        color: [54, 43, 36],   kind: 'wood',     rough: 0.68, metal: 0.0 },
  { name: 'walnut_dark',   color: [34, 28, 24],   kind: 'wood',     rough: 0.76, metal: 0.0 },
  { name: 'velvet',        color: [48, 19, 22],   kind: 'velvet',   rough: 0.96, metal: 0.0 },
  { name: 'fabric',        color: [58, 60, 62],   kind: 'fabric',   rough: 0.99, metal: 0.0 },
  { name: 'leather',       color: [38, 36, 34],   kind: 'leather',  rough: 0.8,  metal: 0.0 },
  { name: 'enamel',        color: [25, 26, 28],   kind: 'metal',    rough: 0.5,  metal: 0.55 },
  { name: 'bone',          color: [178, 172, 154], kind: 'paper',   rough: 0.66, metal: 0.0 },
  { name: 'blood',         color: [108, 19, 23],  kind: 'blood',    rough: 0.52, metal: 0.0 },
  { name: 'skin',          color: [88, 74, 66],   kind: 'leather',  rough: 0.85, metal: 0.0 },
  { name: 'shadow',        color: [13, 13, 15],   kind: 'paper',    rough: 0.94, metal: 0.0 }
];

const MATERIAL_INDEX = Object.fromEntries(MATERIALS.map((material, index) => [material.name, index]));
const TILE_SIZE = { realistic: 128, lowpoly: 32 };
const NORMAL_STRENGTH = {
  metal: 2.6, concrete: 3.0, wood: 1.9, fabric: 1.4,
  velvet: 1.15, leather: 2.1, paper: 0.7, blood: 1.0
};

function atlasMetrics(style) {
  const tile = TILE_SIZE[style];
  return { tile, width: tile * 4, height: tile * 5 };
}

function tileRect(style, key) {
  const { tile, width, height } = atlasMetrics(style);
  if (key === 'sign') return [0, tile * 4, width, height];
  const index = MATERIAL_INDEX[key];
  if (index === undefined) throw new Error(`Unknown atlas surface "${key}"`);
  const x = (index % 4) * tile;
  const y = Math.floor(index / 4) * tile;
  return [x, y, x + tile, y + tile];
}

/* ================================================================ png writer */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let value = n;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[n] = value >>> 0;
  }
  return table;
})();

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}

function encodePNG(width, height, channels, data) {
  const colorType = channels === 4 ? 6 : channels === 3 ? 2 : 0;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = colorType;
  const stride = width * channels;
  const rows = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    rows[y * (stride + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride)
      .copy(rows, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(rows, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

/* ================================================================ noise */

function hash2(x, y, seed) {
  let value = Math.imul(x + seed * 374761393, 0x45d9f3b) ^ Math.imul(y - seed * 668265263, 0x119de1f3);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(x, y, seed, octaves = 3) {
  let sum = 0, amplitude = 0.5, frequency = 1, total = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * frequency, y * frequency, seed + i * 31) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum / total;
}

const clamp255 = (value) => value < 0 ? 0 : value > 255 ? 255 : Math.round(value);
const clamp01 = (value) => value < 0 ? 0 : value > 1 ? 1 : value;

/* ================================================================ atlas tiles */

function generateTile(material, tileSize, seed) {
  const albedo = new Uint8Array(tileSize * tileSize * 3);
  const roughness = new Uint8Array(tileSize * tileSize);
  const metalness = new Uint8Array(tileSize * tileSize);
  const height = new Float32Array(tileSize * tileSize);
  const normal = new Uint8Array(tileSize * tileSize * 3);
  const scratchCount = material.kind === 'metal' ? 26 : material.kind === 'concrete' ? 18 : 14;
  const strokes = Array.from({ length: scratchCount }, (_, index) => {
    const x = hash2(index, 1, seed) * tileSize;
    const y = hash2(index, 2, seed + 1) * tileSize;
    const angle = (hash2(index, 3, seed + 2) - 0.5) * Math.PI;
    const length = (0.07 + hash2(index, 4, seed + 3) * 0.4) * tileSize;
    return {
      x, y,
      dx: Math.cos(angle) * length,
      dy: Math.sin(angle) * length,
      width: Math.max(0.45, (hash2(index, 5, seed + 4) > 0.78 ? 1.7 : 0.75) * tileSize / 128),
      shade: hash2(index, 6, seed + 5) > 0.44 ? 26 : -26
    };
  });

  for (let y = 0; y < tileSize; y++) {
    for (let x = 0; x < tileSize; x++) {
      const nx = x / tileSize, ny = y / tileSize;
      let shade = 0, h = 0, rough = material.rough, metal = material.metal, rust = 0;

      switch (material.kind) {
        case 'concrete': {
          const broad = fbm(nx * 5, ny * 5, seed + 1);
          const fine = fbm(nx * 26, ny * 26, seed + 2);
          shade = (broad - 0.5) * 30 + (fine - 0.5) * 13;
          h = broad * 0.55 + fine * 0.45;
          const crack = Math.abs(fbm(nx * 3 + 2, ny * 3, seed + 3) - 0.5);
          if (crack < 0.013) { shade -= 30; h -= 0.5; }
          if (hash2(x, y, seed + 4) > 0.988) { shade -= 20; h -= 0.6; }
          break;
        }
        case 'metal': {
          const brushed = valueNoise(nx * 4, ny * 74, seed + 1);
          const grain = valueNoise(nx * 120, ny * 8, seed + 2);
          shade = (brushed - 0.5) * 11 + (grain - 0.5) * 19;
          h = brushed * 0.4 + grain * 0.6;
          if (hash2(x, y, seed + 3) > 0.982) { shade -= 22; h -= 0.65; rough = 0.84; metal *= 0.4; }
          if (material.name === 'oxide') {
            const corrosion = fbm(nx * 7, ny * 7, seed + 5);
            if (corrosion > 0.62) { rust = (corrosion - 0.62) * 1.6; rough = 0.93; metal = 0.16; h += 0.18; }
          }
          if (material.name === 'brass') {
            const patina = fbm(nx * 9, ny * 9, seed + 6);
            if (patina > 0.7) { shade -= 5; rough = 0.76; metal = 0.58; }
          }
          break;
        }
        case 'wood': {
          const warp = fbm(nx * 3, ny * 1.4, seed + 1) * 2.2;
          const grain = 0.5 + 0.5 * Math.sin((ny * 34 + warp) * Math.PI * 2);
          const pores = valueNoise(nx * 46, ny * 7, seed + 2);
          shade = (grain - 0.5) * 12 + (pores - 0.5) * 7;
          h = grain * 0.58 + pores * 0.42;
          const knot = Math.hypot(nx * 2 - 0.62, ny * 2 - 0.44);
          if (knot < 0.15) { shade -= (0.15 - knot) * 95; h -= 0.22; }
          break;
        }
        case 'fabric': {
          const weave = ((Math.floor(nx * tileSize / 2) + Math.floor(ny * tileSize / 2)) % 2) * 6;
          const fuzz = valueNoise(nx * 34, ny * 34, seed + 1);
          shade = (fuzz - 0.5) * 12 + weave - 3;
          h = (weave / 6) * 0.42 + fuzz * 0.58;
          break;
        }
        case 'velvet': {
          const nap = valueNoise(nx * 8, ny * 28, seed + 1);
          shade = (nap - 0.5) * 17 + Math.sin(ny * 21) * 3;
          h = nap;
          break;
        }
        case 'leather': {
          const pebble = valueNoise(nx * 36, ny * 36, seed + 1);
          shade = (pebble - 0.5) * 15;
          h = pebble;
          if (valueNoise(nx * 9, ny * 9, seed + 2) > 0.82) { shade -= 11; h -= 0.32; }
          break;
        }
        case 'paper': {
          shade = (valueNoise(nx * 42, ny * 42, seed + 1) - 0.5) * 7
            + (valueNoise(nx * 6, ny * 6, seed + 2) - 0.5) * 11;
          h = valueNoise(nx * 42, ny * 42, seed + 1);
          break;
        }
        case 'blood': {
          const wet = valueNoise(nx * 6, ny * 6, seed + 1);
          shade = (wet - 0.5) * 15;
          h = wet * 0.3;
          if (wet > 0.66) { rough = 0.22; shade += 9; }
          break;
        }
        default: break;
      }

      let wear = 0;
      for (const stroke of strokes) {
        const along = clamp01(((x - stroke.x) * stroke.dx + (y - stroke.y) * stroke.dy)
          / (stroke.dx * stroke.dx + stroke.dy * stroke.dy || 1));
        const distance = Math.hypot(x - stroke.x - stroke.dx * along, y - stroke.y - stroke.dy * along);
        if (distance < stroke.width) {
          wear += stroke.shade * (1 - distance / stroke.width);
          rough = Math.max(0.05, rough - 0.16);
        }
      }

      const stain = Math.max(0, fbm(nx * 3 + 5, ny * 3 + 9, seed + 17) - 0.6) * 2.2;
      const grain = (hash2(x, y, seed + 11) - 0.5) * 6;
      const value = shade + wear + grain - stain * 42;
      const rustTint = rust * 26;

      const offset = (y * tileSize + x) * 3;
      albedo[offset] = clamp255(material.color[0] + value + rustTint);
      albedo[offset + 1] = clamp255(material.color[1] + value + rustTint * 0.32);
      albedo[offset + 2] = clamp255(material.color[2] + value + rustTint * 0.12);
      roughness[y * tileSize + x] = clamp255((rough + (hash2(x, y, seed + 21) - 0.5) * 0.09) * 255);
      metalness[y * tileSize + x] = clamp255(clamp01(metal) * 255);
      height[y * tileSize + x] = h - wear * 0.004;
    }
  }

  const strength = NORMAL_STRENGTH[material.kind] || 1.5;
  const sample = (x, y) => height[Math.min(tileSize - 1, Math.max(0, y)) * tileSize + Math.min(tileSize - 1, Math.max(0, x))];
  for (let y = 0; y < tileSize; y++) {
    for (let x = 0; x < tileSize; x++) {
      const dx = (sample(x + 1, y) - sample(x - 1, y)) * strength;
      const dy = (sample(x, y + 1) - sample(x, y - 1)) * strength;
      const length = Math.hypot(dx, dy, 1) || 1;
      const offset = (y * tileSize + x) * 3;
      normal[offset] = clamp255(((-dx / length) * 0.5 + 0.5) * 255);
      normal[offset + 1] = clamp255(((dy / length) * 0.5 + 0.5) * 255);
      normal[offset + 2] = clamp255(((1 / length) * 0.5 + 0.5) * 255);
    }
  }

  return { albedo, roughness, metalness, normal };
}

const GLYPHS = {
  F: ['11111', '10000', '11110', '10000', '10000', '10000', '10000'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  N: ['10001', '11001', '11001', '10101', '10011', '10011', '10001'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001']
};

function generateMarquee(style, width, height) {
  const albedo = new Uint8Array(width * height * 3);
  const edge = Math.max(2, Math.round(height * 0.045));
  const panel = { x0: edge * 3, y0: edge * 2.2, x1: width - edge * 3, y1: height - edge * 2.2 };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const border = x < edge || x >= width - edge || y < edge || y >= height - edge;
      const inset = x > panel.x0 && x < panel.x1 && y > panel.y0 && y < panel.y1;
      const distress = (valueNoise(x / (height / 9), y / (height / 9), 501) - 0.5) * (inset ? 26 : 12);
      const color = border ? [108, 100, 82] : inset ? [114, 21, 25] : [15, 16, 18];
      const offset = (y * width + x) * 3;
      albedo[offset] = clamp255(color[0] + distress);
      albedo[offset + 1] = clamp255(color[1] + distress);
      albedo[offset + 2] = clamp255(color[2] + distress);
    }
  }

  const scale = style === 'realistic' ? 8 : 2;
  const title = 'FORTUNA';
  const advance = 6 * scale;
  const total = title.length * advance - scale;
  let cursor = Math.floor((width - total) / 2);
  const top = Math.floor((height - 7 * scale) / 2);
  for (const letter of title) {
    GLYPHS[letter].forEach((row, rowIndex) => {
      for (let column = 0; column < row.length; column++) {
        if (row[column] !== '1') continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const x = cursor + column * scale + sx;
            const y = top + rowIndex * scale + sy;
            if (x < 0 || x >= width || y < 0 || y >= height) continue;
            const grime = (hash2(x, y, 811) - 0.5) * 22;
            const offset = (y * width + x) * 3;
            albedo[offset] = clamp255(222 + grime);
            albedo[offset + 1] = clamp255(214 + grime);
            albedo[offset + 2] = clamp255(194 + grime);
          }
        }
      }
    });
    cursor += advance;
  }
  return albedo;
}

function buildAtlas(style) {
  const { tile, width, height } = atlasMetrics(style);
  const albedo = new Uint8Array(width * height * 3);
  const roughness = new Uint8Array(width * height).fill(220);
  const metalness = new Uint8Array(width * height).fill(10);
  const normal = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    normal[i * 3] = 128;
    normal[i * 3 + 1] = 128;
    normal[i * 3 + 2] = 255;
  }

  MATERIALS.forEach((material, index) => {
    const generated = generateTile(material, tile, index * 97 + 13);
    const ox = (index % 4) * tile;
    const oy = Math.floor(index / 4) * tile;
    for (let y = 0; y < tile; y++) {
      for (let x = 0; x < tile; x++) {
        const source = (y * tile + x);
        const target = ((oy + y) * width + ox + x);
        albedo[target * 3] = generated.albedo[source * 3];
        albedo[target * 3 + 1] = generated.albedo[source * 3 + 1];
        albedo[target * 3 + 2] = generated.albedo[source * 3 + 2];
        roughness[target] = generated.roughness[source];
        metalness[target] = generated.metalness[source];
        normal[target * 3] = generated.normal[source * 3];
        normal[target * 3 + 1] = generated.normal[source * 3 + 1];
        normal[target * 3 + 2] = generated.normal[source * 3 + 2];
      }
    }
  });

  const marquee = generateMarquee(style, width, tile);
  for (let y = 0; y < tile; y++) {
    for (let x = 0; x < width; x++) {
      const source = (y * width + x) * 3;
      const target = ((tile * 4 + y) * width + x) * 3;
      albedo[target] = marquee[source];
      albedo[target + 1] = marquee[source + 1];
      albedo[target + 2] = marquee[source + 2];
    }
  }

  return { tile, width, height, albedo, roughness, metalness, normal };
}

/* ================================================================ project builder */

const DETAIL = {
  realistic: { segments: 40, mid: 24, small: 14, tiny: 8, tube: 12, bevel: true, extra: true },
  lowpoly:   { segments: 14, mid: 9,  small: 6,  tiny: 4, tube: 5,  bevel: false, extra: false }
};
const FACE_NAMES = ['east', 'west', 'up', 'down', 'south', 'north'];

function createProject(name, description, style, atlas) {
  const D = DETAIL[style];
  const elements = [];
  const root = { name: 'Model', origin: [0, 0, 0], rotation: [0, 0, 0], children: [] };

  const group = (groupName, origin = [0, 0, 0], parent = root) => {
    const node = { name: groupName, uuid: randomUUID(), origin, rotation: [0, 0, 0], children: [] };
    parent.children.push(node);
    return node;
  };

  const uvIn = (surface, u, v, repeatU = 1, repeatV = 1) => {
    const rect = tileRect(style, surface);
    const pad = (rect[2] - rect[0]) * 0.02;
    const map = (value, repeat) => repeat <= 1
      ? clamp01(value)
      : value * repeat - Math.floor(value * repeat);
    return [
      rect[0] + pad + map(u, repeatU) * (rect[2] - rect[0] - pad * 2),
      rect[1] + pad + map(v, repeatV) * (rect[3] - rect[1] - pad * 2)
    ];
  };

  const addCube = (parent, cubeName, from, to, surface, rotation = [0, 0, 0], origin = null) => {
    const rect = tileRect(style, surface);
    const pad = (rect[2] - rect[0]) * 0.02;
    const uv = [rect[0] + pad, rect[1] + pad, rect[2] - pad, rect[3] - pad];
    const center = from.map((value, index) => (value + to[index]) / 2);
    const id = randomUUID();
    elements.push({
      name: cubeName, uuid: id, type: 'cube', from, to,
      origin: origin || center, rotation,
      box_uv: false, autouv: 0, color: 0, rescale: false,
      faces: Object.fromEntries(FACE_NAMES.map(face => [face, { uv, texture: 0 }]))
    });
    parent.children.push(id);
    return id;
  };

  const addMesh = (parent, meshName, vertices, faces, surface, mapFaceUv = null) => {
    const meshFaces = {};
    faces.forEach((keys, index) => {
      const mapped = mapFaceUv ? mapFaceUv(keys, index) : null;
      const uvs = {};
      keys.forEach((key, pointIndex) => {
        uvs[key] = mapped && mapped[pointIndex] ? mapped[pointIndex] : uvIn(surface, 0.5, 0.5);
      });
      meshFaces[index] = { vertices: keys, uv: uvs, texture: 0 };
    });
    const id = randomUUID();
    elements.push({
      name: meshName, uuid: id, type: 'mesh', origin: [0, 0, 0], rotation: [0, 0, 0],
      vertices, faces: meshFaces
    });
    parent.children.push(id);
    return id;
  };

  const wrapUs = (keys, segments) => {
    const indices = keys.map(key => Number(key.split('_')[1]));
    const values = indices.map(index => index / segments);
    if (Math.max(...values) - Math.min(...values) > 0.5) {
      values.forEach((value, index) => { if (value < 0.5) values[index] = value + 1; });
    }
    return values;
  };

  const cylinder = (parent, cylinderName, cx, cy, cz, radius, depth, surface, segments = D.mid, axis = 'y', repeat = {}) => {
    const [rx, rz] = Array.isArray(radius) ? radius : [radius, radius];
    const axisIndex = axis === 'y' ? 1 : axis === 'z' ? 2 : 0;
    const planeAxes = [0, 1, 2].filter(index => index !== axisIndex);
    const vertices = {};
    const faces = [];
    const lower = [cx, cy, cz];
    const upper = [cx, cy, cz];
    lower[axisIndex] -= depth / 2;
    upper[axisIndex] += depth / 2;
    for (let end = 0; end < 2; end++) {
      const center = end ? upper : lower;
      for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        const a = Math.cos(angle), b = Math.sin(angle);
        const point = [...center];
        if (axis === 'y') { point[0] = cx + a * rx; point[2] = cz + b * rz; }
        else if (axis === 'z') { point[0] = cx + a * rx; point[1] = cy + b * rx; }
        else { point[1] = cy + a * rx; point[2] = cz + b * rx; }
        vertices[`${end}_${i}`] = point;
      }
    }
    const bottomKey = 'bottom_center';
    const topKey = 'top_center';
    vertices[bottomKey] = [...lower];
    vertices[topKey] = [...upper];

    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const point of Object.values(vertices)) {
      for (let axis2 = 0; axis2 < 3; axis2++) {
        min[axis2] = Math.min(min[axis2], point[axis2]);
        max[axis2] = Math.max(max[axis2], point[axis2]);
      }
    }
    const span = (axis2) => Math.max(1e-4, max[axis2] - min[axis2]);
    const capUv = (point) => uvIn(
      surface,
      (point[planeAxes[0]] - min[planeAxes[0]]) / span(planeAxes[0]),
      (point[planeAxes[1]] - min[planeAxes[1]]) / span(planeAxes[1]),
      repeat.cap || 1, repeat.cap || 1
    );

    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      faces.push([`0_${i}`, `1_${i}`, `1_${next}`, `0_${next}`]);
      faces.push([topKey, `1_${next}`, `1_${i}`]);
      faces.push([bottomKey, `0_${i}`, `0_${next}`]);
    }

    const mapFaceUv = (keys) => {
      if (keys.some(key => key.endsWith('_center'))) return keys.map(key => capUv(vertices[key]));
      const us = wrapUs(keys, segments);
      return keys.map((key, index) => {
        const point = vertices[key];
        return uvIn(
          surface,
          us[index],
          (point[axisIndex] - min[axisIndex]) / span(axisIndex),
          repeat.around || 1, repeat.along || 1
        );
      });
    };

    return addMesh(parent, cylinderName, vertices, faces, surface, mapFaceUv);
  };

  const superLoft = (parent, loftName, cx, cz, profiles, surface, segments = D.mid, power = 2, repeatU = 1, repeatV = 1) => {
    const vertices = {};
    const faces = [];
    const ys = profiles.map(profile => profile[0]);
    const yMin = Math.min(...ys), yMax = Math.max(...ys);
    const exponent = 2 / power;
    profiles.forEach(([y, rx, rz], ring) => {
      for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        const c = Math.cos(angle), s = Math.sin(angle);
        const dx = Math.sign(c) * Math.pow(Math.abs(c), exponent) * rx;
        const dz = Math.sign(s) * Math.pow(Math.abs(s), exponent) * rz;
        vertices[`${ring}_${i}`] = [cx + dx, y, cz + dz];
      }
    });
    for (let ring = 0; ring < profiles.length - 1; ring++) {
      for (let i = 0; i < segments; i++) {
        const next = (i + 1) % segments;
        faces.push([`${ring}_${i}`, `${ring + 1}_${i}`, `${ring + 1}_${next}`, `${ring}_${next}`]);
      }
    }
    const last = profiles.length - 1;
    for (let i = 1; i < segments - 1; i++) {
      faces.push(['0_0', `0_${i + 1}`, `0_${i}`]);
      faces.push([`${last}_0`, `${last}_${i}`, `${last}_${i + 1}`]);
    }
    const mapFaceUv = (keys) => {
      if (keys.length === 3) {
        const ring = Number(keys[0].split('_')[0]);
        const [, rx, rz] = profiles[ring];
        return keys.map(key => {
          const point = vertices[key];
          return uvIn(
            surface,
            (point[0] - (cx - rx)) / (rx * 2 || 1),
            (point[2] - (cz - rz)) / (rz * 2 || 1),
            repeatU, repeatV
          );
        });
      }
      const us = wrapUs(keys, segments);
      return keys.map((key, index) => {
        const point = vertices[key];
        return uvIn(
          surface,
          us[index],
          (point[1] - yMin) / (yMax - yMin || 1),
          repeatU, repeatV
        );
      });
    };
    return addMesh(parent, loftName, vertices, faces, surface, mapFaceUv);
  };

  const torus = (parent, torusName, cx, cy, cz, radius, tube, surface, around = D.mid, sides = 6, axis = 'y') => {
    const vertices = {};
    const faces = [];
    for (let i = 0; i < around; i++) {
      const a = (i / around) * Math.PI * 2;
      for (let j = 0; j < sides; j++) {
        const b = (j / sides) * Math.PI * 2;
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
          `${i}_${(j + 1) % sides}`,
          `${(i + 1) % around}_${(j + 1) % sides}`,
          `${(i + 1) % around}_${j}`
        ]);
      }
    }
    const mapFaceUv = (keys) => {
      const indices = keys.map(key => key.split('_').map(Number));
      const aroundValues = indices.map(([i]) => i / around);
      if (Math.max(...aroundValues) - Math.min(...aroundValues) > 0.5) {
        aroundValues.forEach((value, index) => { if (value < 0.5) aroundValues[index] = value + 1; });
      }
      return keys.map((key, index) => uvIn(surface, aroundValues[index], indices[index][1] / sides, 1, 1));
    };
    return addMesh(parent, torusName, vertices, faces, surface, mapFaceUv);
  };

  const tubeBetween = (parent, tubeName, a, b, radius, surface, segments = D.tube) => {
    const start = [...a], end = [...b];
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
        const angle = (i / segments) * Math.PI * 2;
        const point = center.map((value, axis) =>
          value + radius * (Math.cos(angle) * u[axis] + Math.sin(angle) * v[axis]));
        vertices[`${cap}_${i}`] = point;
      }
    }
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      faces.push([`0_${i}`, `0_${next}`, `1_${next}`, `1_${i}`]);
      faces.push(['start_center', `0_${next}`, `0_${i}`]);
      faces.push(['end_center', `1_${i}`, `1_${next}`]);
    }
    const mapFaceUv = (keys) => {
      if (keys.some(key => key.endsWith('_center'))) {
        return keys.map(key => uvIn(surface, 0.5, 0.5));
      }
      const us = wrapUs(keys, segments);
      return keys.map((key, index) => {
        const cap = Number(key.split('_')[0]);
        return uvIn(surface, us[index], cap, 1, 1);
      });
    };
    return addMesh(parent, tubeName, vertices, faces, surface, mapFaceUv);
  };

  const box = (parent, boxName, from, to, surface, bevel = 0.35, rotation = [0, 0, 0]) => {
    const size = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    const minSize = Math.min(...size);
    const rotated = rotation.some(value => value !== 0);
    if (!D.bevel || rotated || minSize < bevel * 2.6) {
      return addCube(parent, boxName, from, to, surface, rotation);
    }
    const cx = (from[0] + to[0]) / 2, cz = (from[2] + to[2]) / 2;
    const rx = size[0] / 2, rz = size[2] / 2;
    const radius = Math.min(bevel, size[1] / 2.4, rx * 0.5, rz * 0.5);
    const inset = 1 - Math.min(0.3, (radius / Math.max(rx, rz)) * 0.85);
    return superLoft(parent, boxName, cx, cz, [
      [from[1], rx * inset, rz * inset],
      [from[1] + radius, rx, rz],
      [to[1] - radius, rx, rz],
      [to[1], rx * inset, rz * inset]
    ], surface, D.mid, 4.2);
  };

  const plane = (parent, planeName, points, surface, uvs) => {
    const keys = points.map((_, index) => String.fromCharCode(97 + index));
    const vertices = Object.fromEntries(points.map((point, index) => [keys[index], point]));
    return addMesh(parent, planeName, vertices, [keys], surface, () => uvs);
  };

  const serializeGroup = (node) => ({
    uuid: node.uuid, name: node.name, origin: node.origin, rotation: node.rotation, export: true, isOpen: true
  });
  const serializeOutliner = (node) => ({
    uuid: node.uuid, isOpen: true,
    children: node.children.map(child => typeof child === 'string' ? child : serializeOutliner(child))
  });
  const collectGroups = (nodes) => nodes.flatMap(child => typeof child === 'string' ? [] : [serializeGroup(child), ...collectGroups(child.children)]);

  const save = async (filename) => {
    const model = {
      name,
      model_identifier: name.toLowerCase().replaceAll(' ', '_'),
      meta: { format_version: '4.10', model_format: 'free', box_uv: false, style },
      resolution: { width: atlas.width, height: atlas.height },
      elements,
      groups: collectGroups(root.children),
      outliner: root.children.map(serializeOutliner),
      textures: [{
        path: `textures/${style}_albedo.png`,
        relative_path: `textures/${style}_albedo.png`,
        name: `${style}_albedo.png`, folder: '', namespace: '', id: '0',
        width: atlas.width, height: atlas.height,
        uv_width: atlas.width, uv_height: atlas.height,
        particle: false, use_as_default: true, internal: false, saved: true,
        pbr_channel: 'color', uuid: randomUUID(), source: ''
      }],
      description
    };
    await writeFile(new URL(filename, output), `${JSON.stringify(model)}\n`);
  };

  return { group, addCube, addMesh, cylinder, superLoft, torus, tubeBetween, box, plane, save, D, style, atlas };
}

function subtract(a, b) { return a.map((value, index) => value - b[index]); }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function normalize(value) {
  const length = Math.hypot(...value) || 1;
  return value.map(component => component / length);
}

/* ================================================================ models */

async function buildModels(style, atlas) {
  /* -------------------------------------------------------------- casino */
  const casino = createProject(
    'Fortuna Casino Interior',
    'Fortuna casino interior: stained concrete, oxblood velvet panelling, brass reveals, a marquee, a wall roulette wheel and a round veneer table. Units are 1/16 m; the floor is y = 0.',
    style, atlas
  );
  const room = casino.group('Room Shell');
  casino.addCube(room, 'Stained concrete floor', [-160, -4, -160], [160, 0, 160], 'concrete');
  casino.addCube(room, 'Ceiling slab', [-160, 100, -160], [160, 106, 160], 'concrete_dark');
  for (const x of [-80, 0, 80]) {
    casino.addCube(room, 'Floor seam', [x - 0.35, 0, -160], [x + 0.35, 0.3, 160], 'concrete_dark');
  }
  for (const z of [-80, 0, 80]) {
    casino.addCube(room, 'Floor seam', [-160, 0, z - 0.35], [160, 0.3, z + 0.35], 'concrete_dark');
  }
  casino.addCube(room, 'Far wall', [-160, 0, -160], [160, 100, -154], 'concrete');
  casino.addCube(room, 'Left wall', [-160, 0, -154], [-154, 100, 160], 'concrete');
  casino.addCube(room, 'Right wall', [154, 0, -154], [160, 100, 160], 'concrete');
  for (const x of [-80, 0, 80]) {
    casino.addCube(room, 'Ceiling beam', [x - 4, 94, -160], [x + 4, 100, 160], 'walnut_dark');
  }

  casino.addCube(room, 'Walnut wainscot', [-154, 0, -154], [154, 16, -152.1], 'walnut');
  casino.addCube(room, 'Wainscot rail', [-154, 16, -154], [154, 18, -151.6], 'walnut_dark');
  casino.addCube(room, 'Wainscot brass cap', [-154, 18, -154], [154, 19, -151.3], 'brass');
  for (let i = 0; i < 7; i++) {
    const x0 = -147 + i * 42;
    casino.box(room, `Oxblood wall panel ${i + 1}`, [x0, 22, -153.7], [x0 + 36, 72, -152.3], 'velvet', 0.6);
    casino.addCube(room, `Brass reveal ${i + 1}`, [x0 + 36, 22, -153.5], [x0 + 39, 72, -152.1], 'brass');
  }
  for (let i = 0; i < 3; i++) {
    const z0 = -96 + i * 72;
    casino.box(room, 'Left wall panel', [-153.7, 22, z0], [-152.3, 72, z0 + 56], 'velvet', 0.6);
    casino.box(room, 'Right wall panel', [152.3, 22, z0], [153.7, 72, z0 + 56], 'velvet', 0.6);
  }

  const signGroup = casino.group('Fortuna Sign');
  casino.box(signGroup, 'Marquee housing', [-52, 74, -153.8], [52, 96, -150.4], 'enamel', 0.6);
  casino.box(signGroup, 'Marquee inset', [-47, 77.5, -150.6], [47, 92.5, -149.9], 'blood', 0.4);
  casino.plane(signGroup, 'FORTUNA lettering', [
    [-44, 79, -149.85], [44, 79, -149.85], [44, 91, -149.85], [-44, 91, -149.85]
  ], 'sign', [
    [0, atlas.height], [atlas.width, atlas.height],
    [atlas.width, atlas.height - atlas.tile], [0, atlas.height - atlas.tile]
  ]);

  const roulette = casino.group('Wall Roulette');
  casino.cylinder(roulette, 'Roulette housing', 0, 42, -150.8, 18, 2.4, 'walnut_dark', casino.D.segments, 'z');
  casino.torus(roulette, 'Roulette brass rim', 0, 42, -149.5, 16.6, 1.1, 'brass', casino.D.segments, 6, 'z');
  casino.cylinder(roulette, 'Roulette velvet field', 0, 42, -149.2, 10.5, 0.8, 'velvet', casino.D.segments, 'z');
  casino.cylinder(roulette, 'Roulette spindle', 0, 42, -148.6, 2.2, 1.0, 'brass', casino.D.small, 'z');
  for (let i = 0; i < 24; i++) {
    const angle = (i / 24) * Math.PI * 2;
    const x = Math.sin(angle) * 13.4;
    const y = 42 + Math.cos(angle) * 13.4;
    casino.addCube(roulette, `Roulette pocket ${i + 1}`,
      [x - 1.1, y - 2.4, -148.9], [x + 1.1, y + 2.4, -148.3],
      i % 2 ? 'brass' : 'blood', [0, 0, (-angle * 180) / Math.PI]);
  }

  const fixtures = casino.group('Casino Fixtures');
  for (const x of [-104, 104]) {
    casino.box(fixtures, 'Sconce backplate', [x - 5, 44, -153.6], [x + 5, 56, -151.6], 'brass', 0.4);
    casino.box(fixtures, 'Sconce shade', [x - 4.5, 40, -152.6], [x + 4.5, 49, -150.8], 'velvet', 0.5);
    casino.cylinder(fixtures, 'Sconce glass', x, 43, -150.6, 1.7, 3.2, 'bone', casino.D.small, 'y');
  }
  casino.box(fixtures, 'Bar counter', [-153.4, 0, -60], [-140, 28, 40], 'walnut_dark', 0.8);
  casino.addCube(fixtures, 'Bar brass rail', [-153.6, 28, -60], [-139.8, 30, 40], 'brass');
  if (casino.D.extra) {
    for (let i = 0; i < 7; i++) {
      casino.cylinder(fixtures, 'Bottle', -148, 31, -52 + i * 13, 1.1, 6, i % 3 ? 'bone' : 'brass', casino.D.small, 'y');
    }
  }
  casino.cylinder(fixtures, 'Pendant stem', 0, 88, 0, 0.55, 24, 'brass', casino.D.small, 'y');
  casino.torus(fixtures, 'Pendant shade', 0, 76, 0, 13.5, 1.8, 'brass', casino.D.segments, 8, 'y');
  casino.cylinder(fixtures, 'Pendant glass', 0, 74.8, 0, 8, 2.2, 'bone', casino.D.segments, 'y');

  const table = casino.group('Round Pedestal Table');
  casino.cylinder(table, 'Pedestal foot', 0, 1.5, 0, 12, 3, 'enamel', casino.D.segments);
  casino.torus(table, 'Pedestal foot ring', 0, 3, 0, 11.6, 0.7, 'brass', casino.D.segments, 6);
  casino.cylinder(table, 'Pedestal column', 0, 7.2, 0, 4.2, 8.4, 'enamel', casino.D.mid);
  casino.cylinder(table, 'Pedestal collar', 0, 11.4, 0, 5.6, 1.0, 'brass', casino.D.mid);
  casino.cylinder(table, 'Table apron', 0, 12.2, 0, 20, 1.2, 'walnut_dark', casino.D.segments, 'y');
  casino.cylinder(table, 'Veneer tabletop', 0, 13.0, 0, 21.6, 1.4, 'walnut', casino.D.segments, 'y');
  casino.torus(table, 'Table edge molding', 0, 13.0, 0, 21.6, 0.55, 'walnut_dark', casino.D.segments, 6);
  casino.torus(table, 'Brass table inlay', 0, 13.7, 0, 20.4, 0.22, 'brass', casino.D.segments, 5);
  casino.cylinder(table, 'Suede playing field', 0, 13.74, 0, 14, 0.2, 'velvet', casino.D.segments, 'y');
  casino.torus(table, 'Inner pinstripe', 0, 13.84, 0, 14.1, 0.1, 'brass', casino.D.segments, 4);

  const props = casino.group('Table Props');
  const chipColors = ['blood', 'bone', 'brass', 'enamel'];
  for (let i = 0; i < 5; i++) {
    casino.cylinder(props, 'Casino chip', 12, 13.9 + i * 0.3, 4.5, 1.1, 0.26, chipColors[i % 4], casino.D.small, 'y');
  }
  for (let i = 0; i < 4; i++) {
    casino.cylinder(props, 'Casino chip', -12.5, 13.9 + i * 0.3, -4, 1.1, 0.26, chipColors[(i + 2) % 4], casino.D.small, 'y');
  }
  for (let i = 0; i < 3; i++) {
    casino.addCube(props, 'Playing card', [10.2, 13.76 + i * 0.05, -5.4], [12.4, 13.79 + i * 0.05, -3.2], 'bone', [0, (i - 1) * 9, 0]);
  }
  casino.cylinder(props, 'Ashtray', -11.5, 14.05, 6.5, 2.2, 0.7, 'steel', casino.D.small, 'y');
  casino.cylinder(props, 'Ashtray well', -11.5, 14.3, 6.5, 1.5, 0.3, 'enamel', casino.D.small, 'y');
  casino.cylinder(props, 'Cigar', -11.5, 14.55, 6.5, 0.45, 3.2, 'leather', casino.D.tiny, 'x');
  casino.cylinder(props, 'Cigar ember', -9.95, 14.55, 6.5, 0.42, 0.25, 'blood', casino.D.tiny, 'x');
  casino.cylinder(props, 'Whiskey glass', 11.5, 14.8, 6.8, 1.2, 2.0, 'bone', casino.D.small, 'y');
  casino.cylinder(props, 'Whiskey', 11.5, 14.3, 6.8, 1.0, 1.2, 'brass', casino.D.small, 'y');

  await casino.save(`casino_environment_${style}.bbmodel`);

  /* -------------------------------------------------------------- player */
  const player = createProject(
    'Seated Trenchcoat Mafioso',
    'Faceless seated mafia silhouette in a tailored trench coat on a high-backed casino chair. Units are 1/16 m, feet at y = 0, facing +Z.',
    style, atlas
  );
  const chair = player.group('High-backed Casino Chair');
  for (const [sx, sz] of [[-3.6, -3.4], [3.6, -3.4], [-3.6, 3.4], [3.6, 3.4]]) {
    player.cylinder(chair, 'Chair turned leg', sx, 3.5, sz, 0.75, 7, 'walnut_dark', player.D.small);
    player.cylinder(chair, 'Chair brass ferrule', sx, 0.6, sz, 0.95, 1.2, 'brass', player.D.small);
  }
  player.box(chair, 'Chair seat frame', [-4.4, 6.8, -4.2], [4.4, 7.7, 4.4], 'walnut_dark', 0.45);
  player.box(chair, 'Oxblood seat cushion', [-4.1, 7.7, -3.9], [4.1, 8.6, 4.1], 'velvet', 0.5);
  player.box(chair, 'Chair back post left', [-4.4, 7.4, -4.6], [-3.4, 18.6, -3.4], 'walnut_dark', 0.4);
  player.box(chair, 'Chair back post right', [3.4, 7.4, -4.6], [4.4, 18.6, -3.4], 'walnut_dark', 0.4);
  player.box(chair, 'Upholstered back', [-3.5, 9.2, -4.4], [3.5, 17.3, -3.6], 'velvet', 0.45);
  player.box(chair, 'Chair crest rail', [-4.4, 17.3, -4.6], [4.4, 18.7, -3.2], 'walnut_dark', 0.4);
  player.box(chair, 'Chair brass crest', [-2.6, 17.8, -3.35], [2.6, 18.4, -3.05], 'brass', 0.2);
  for (const sx of [-4.6, 4.6]) {
    player.box(chair, 'Chair arm rail', [sx - 0.9, 11.7, -2.4], [sx + 0.9, 12.5, 4.2], 'walnut_dark', 0.3);
    player.box(chair, 'Chair arm pad', [sx - 1.0, 12.5, -2.0], [sx + 1.0, 13.1, 3.8], 'leather', 0.25);
  }
  if (player.D.extra) {
    for (let i = 0; i < 9; i++) {
      const x = -3.3 + (i / 8) * 6.6;
      player.cylinder(chair, 'Chair brass tack', x, 9.6, -4.35, 0.14, 0.2, 'brass', player.D.tiny, 'z');
      player.cylinder(chair, 'Chair brass tack', x, 16.9, -4.35, 0.14, 0.2, 'brass', player.D.tiny, 'z');
    }
  }

  const body = player.group('Body', [0, 7.4, 0]);
  const torso = player.group('Torso', [0, 7.4, 0], body);
  player.superLoft(torso, 'Trench coat', 0, 0.3, [
    [7.1, 3.5, 2.5], [8.2, 3.9, 2.75], [10.4, 4.0, 2.8],
    [12.4, 4.15, 2.9], [14.2, 4.5, 2.95], [15.4, 4.1, 2.6]
  ], 'fabric', player.D.mid, 3.0, 1, 1.2);
  player.superLoft(torso, 'Coat skirt', 0, 0.3, [
    [5.0, 4.5, 3.2], [6.2, 4.2, 3.0], [7.3, 3.8, 2.7]
  ], 'fabric', player.D.mid, 3.0, 1, 1.2);
  player.cylinder(torso, 'Neck', 0, 15.9, 0.25, 0.95, 1.6, 'skin', player.D.small);
  player.box(torso, 'Shirt front', [-1.35, 12.3, 2.72], [1.35, 15.4, 2.98], 'bone', 0.15);
  player.box(torso, 'Oxblood tie', [-0.42, 12.1, 2.96], [0.42, 15.1, 3.12], 'blood', 0.1);
  player.box(torso, 'Collar left', [-2.7, 15.1, 2.1], [-0.35, 16.2, 2.95], 'fabric', 0.18);
  player.box(torso, 'Collar right', [0.35, 15.1, 2.1], [2.7, 16.2, 2.95], 'fabric', 0.18);
  player.box(torso, 'Lapel left', [-3.3, 12.6, 2.6], [-1.1, 15.6, 3.02], 'leather', 0.14);
  player.box(torso, 'Lapel right', [1.1, 12.6, 2.6], [3.3, 15.6, 3.02], 'leather', 0.14);
  player.box(torso, 'Trench belt', [-3.9, 10.0, 2.35], [3.9, 10.9, 3.0], 'leather', 0.15);
  player.box(torso, 'Belt buckle', [-0.65, 9.9, 3.0], [0.65, 11.0, 3.2], 'brass', 0.12);
  for (const y of [12.0, 13.3, 14.6]) {
    player.cylinder(torso, 'Coat button', 0, y, 3.06, 0.3, 0.18, 'brass', player.D.tiny, 'z');
  }
  if (player.D.extra) {
    for (const sx of [-4.4, 4.4]) {
      player.box(torso, 'Epaulette', [sx - 1.0, 14.9, -0.7], [sx + 0.6, 15.4, 1.1], 'fabric', 0.12);
    }
  }

  const legs = player.group('Legs', [0, 7.4, 0], body);
  for (const sx of [-1.7, 1.7]) {
    player.tubeBetween(legs, 'Trouser thigh', [sx, 7.5, 0.8], [sx, 7.3, 6.2], 1.2, 'fabric', player.D.tube);
    player.tubeBetween(legs, 'Trouser shin', [sx, 7.1, 6.2], [sx, 1.2, 7.5], 0.95, 'fabric', player.D.tube);
    player.box(legs, 'Polished shoe', [sx - 1.05, 0, 6.5], [sx + 1.05, 1.6, 10.4], 'leather', 0.35);
  }

  const head = player.group('Head', [0, 15.6, 0], body);
  player.superLoft(head, 'Head', 0, 0.25, [
    [15.7, 1.0, 1.1], [16.2, 1.5, 1.55], [17.4, 1.68, 1.72], [18.5, 1.5, 1.55], [19.2, 1.05, 1.15]
  ], 'skin', player.D.mid, 2.5);
  player.box(head, 'Brow shadow', [-1.5, 17.5, 1.4], [1.5, 18.15, 1.78], 'shadow', 0.08);
  player.box(head, 'Mouth shadow', [-0.9, 16.15, 1.35], [0.9, 16.6, 1.72], 'shadow', 0.08);
  player.cylinder(head, 'Ear left', -1.62, 17.5, 0.1, 0.34, 0.5, 'skin', player.D.small, 'x');
  player.cylinder(head, 'Ear right', 1.62, 17.5, 0.1, 0.34, 0.5, 'skin', player.D.small, 'x');
  player.superLoft(head, 'Fedora brim', 0, 0.25, [[19.15, 3.05, 3.2], [19.45, 2.9, 3.05]], 'leather', player.D.mid, 2.6);
  player.superLoft(head, 'Fedora crown', 0, 0.25, [
    [19.35, 1.95, 2.05], [20.1, 2.05, 2.15], [21.3, 1.85, 1.95], [21.6, 1.15, 1.25]
  ], 'fabric', player.D.mid, 2.6);
  player.superLoft(head, 'Oxblood fedora band', 0, 0.25, [[19.85, 2.12, 2.22], [20.45, 2.12, 2.22]], 'blood', player.D.mid, 2.6);

  const gunArm = player.group('GunArm', [-4.4, 14.9, 0], body);
  player.tubeBetween(gunArm, 'Coat upper arm', [-4.4, 14.9, 0], [-4.7, 12.1, 2.3], 1.0, 'fabric', player.D.tube);
  player.tubeBetween(gunArm, 'Coat forearm', [-4.7, 12.1, 2.3], [-3.5, 15.8, 7.7], 0.85, 'fabric', player.D.tube);
  player.cylinder(gunArm, 'Coat cuff', -3.5, 15.8, 7.5, 0.95, 0.9, 'leather', player.D.small, 'z');
  const hand = player.group('Hand', [-3.5, 16.0, 7.9], gunArm);
  player.box(hand, 'Gloved palm', [-4.55, 15.4, 7.5], [-2.35, 16.6, 9.3], 'leather', 0.28);
  for (let finger = 0; finger < 4; finger++) {
    const fx = -4.4 + finger * 0.52;
    player.box(hand, 'Gloved finger', [fx, 15.5, 9.2], [fx + 0.42, 16.4, 10.5], 'leather', 0.14);
  }
  player.box(hand, 'Gloved thumb', [-2.5, 15.5, 7.9], [-1.9, 16.4, 9.1], 'leather', 0.14);

  const otherArm = player.group('OtherArm', [4.4, 14.9, 0], body);
  player.tubeBetween(otherArm, 'Coat upper arm right', [4.4, 14.9, 0], [4.7, 12.3, 1.7], 1.0, 'fabric', player.D.tube);
  player.tubeBetween(otherArm, 'Coat forearm right', [4.7, 12.3, 1.7], [4.5, 12.9, 3.3], 0.85, 'fabric', player.D.tube);
  player.box(otherArm, 'Resting glove', [3.5, 12.2, 3.0], [5.5, 13.2, 4.8], 'leather', 0.28);

  await player.save(`seated_mafioso_${style}.bbmodel`);

  /* -------------------------------------------------------------- revolver */
  const gun = createProject(
    'Fortuna Twin-chamber Revolver',
    'Dark-oxide twin-chamber revolver: hexagonal barrel, fluted drum, trigger guard, spur hammer and checkered oxblood grips. Units are 1/16 m, muzzle toward +Z.',
    style, atlas
  );
  const gunBody = gun.group('Body');
  gun.box(gunBody, 'Revolver frame', [-0.55, -0.4, -1.5], [0.55, 0.85, 1.2], 'oxide', 0.16);
  gun.box(gunBody, 'Top strap', [-0.4, 0.85, -1.3], [0.4, 1.12, 1.5], 'steel', 0.1);
  gun.box(gunBody, 'Rear sight', [-0.3, 1.12, -1.45], [0.3, 1.32, -1.15], 'enamel', 0.05);
  gun.cylinder(gunBody, 'Barrel', 0, 0.72, 2.7, 0.4, 3.4, 'steel_worn', gun.D.mid, 'z');
  gun.box(gunBody, 'Vent rib', [-0.15, 1.1, 1.0], [0.15, 1.28, 4.0], 'steel', 0.05);
  gun.box(gunBody, 'Front sight', [-0.11, 1.28, 3.6], [0.11, 1.66, 3.9], 'steel_worn', 0.04);
  gun.cylinder(gunBody, 'Muzzle crown', 0, 0.72, 4.4, 0.32, 0.24, 'enamel', gun.D.mid, 'z');
  gun.cylinder(gunBody, 'Ejector rod', 0, -0.08, 2.2, 0.15, 2.8, 'steel', gun.D.small, 'z');
  gun.cylinder(gunBody, 'Ejector head', 0, -0.08, 3.55, 0.28, 0.35, 'steel_worn', gun.D.small, 'z');

  const drum = gun.group('Cylinder', [0, 0.1, 0.2]);
  gun.cylinder(drum, 'Revolver drum', 0, 0.1, 0.2, 0.95, 1.5, 'steel_worn', gun.D.segments, 'z');
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    gun.addCube(drum, 'Drum flute', [0.72, -0.12, -0.5], [0.98, 0.12, 0.9], 'enamel',
      [0, 0, (angle * 180) / Math.PI], [0, 0.1, 0.2]);
  }
  for (const chamberY of [0.55, -0.35]) {
    for (const chamberZ of [-0.55, 0.95]) {
      gun.cylinder(drum, 'Chamber mouth', 0, chamberY, chamberZ, 0.26, 0.18, 'shadow', gun.D.small, 'z');
    }
  }

  gun.torus(gunBody, 'Trigger guard', 0, -0.62, 0.45, 0.62, 0.12, 'steel', gun.D.mid, 5, 'z');
  gun.tubeBetween(gunBody, 'Trigger', [0, -0.5, 0.5], [0, -1.05, 0.18], 0.1, 'steel', gun.D.tiny);
  gun.tubeBetween(gunBody, 'Hammer spur', [0, 0.8, -1.4], [0, 1.75, -2.1], 0.15, 'steel_worn', gun.D.small);
  gun.box(gunBody, 'Hammer cap', [-0.22, 1.68, -2.35], [0.22, 1.98, -1.95], 'brass', 0.06);

  const grip = gun.group('Grip', [0, -0.2, -1.2]);
  gun.box(grip, 'Grip frame', [-0.5, -0.3, -1.65], [0.5, -2.5, -0.85], 'oxide', 0.16, [16, 0, 0]);
  gun.box(grip, 'Grip panel left', [-0.56, -0.55, -1.55], [-0.44, -2.2, -0.95], 'blood', 0.08, [16, 0, 0]);
  gun.box(grip, 'Grip panel right', [0.44, -0.55, -1.55], [0.56, -2.2, -0.95], 'blood', 0.08, [16, 0, 0]);
  gun.cylinder(grip, 'Grip medallion', 0, -1.35, -1.22, 0.2, 0.1, 'brass', gun.D.small, 'z');
  gun.torus(grip, 'Lanyard ring', 0, -2.5, -1.5, 0.22, 0.06, 'brass', gun.D.small, 4, 'x');
  await gun.save(`twin_chamber_revolver_${style}.bbmodel`);

  /* -------------------------------------------------------------- monitor */
  const clock = createProject(
    'Fortuna Chess-clock Life Monitor',
    'Industrial chess-clock life monitor. Three needles share one dial; the runtime duplicates the gauge for every seat. Units are 1/16 m; the dial faces -Z.',
    style, atlas
  );
  const housing = clock.group('Housing');
  clock.box(housing, 'Monitor base', [-2.4, -0.35, -1.3], [2.4, 0.2, 1.3], 'enamel', 0.15);
  clock.box(housing, 'Monitor body', [-2.2, 0.2, -1.1], [2.2, 2.4, 1.1], 'oxide', 0.18);
  clock.box(housing, 'Upper case', [-2.0, 2.4, -0.9], [2.0, 3.0, 0.9], 'enamel', 0.15);
  clock.addCube(housing, 'Brass lower rail', [-2.5, -0.45, -1.4], [2.5, -0.25, 1.4], 'brass');
  clock.box(housing, 'Front status lamp', [-0.9, 2.48, -1.02], [0.9, 2.82, -0.9], 'bone', 0.06);

  const gauge = clock.group('Gauge', [0, 1.35, -1.12]);
  clock.cylinder(gauge, 'Gauge bezel', 0, 1.35, -1.12, 0.95, 0.24, 'steel', clock.D.mid, 'z');
  clock.cylinder(gauge, 'Gauge dial', 0, 1.35, -1.26, 0.78, 0.1, 'bone', clock.D.mid, 'z');
  clock.cylinder(gauge, 'Dial shadow', 0, 1.35, -1.32, 0.56, 0.06, 'enamel', clock.D.mid, 'z');

  const needle = clock.group('Needle', [0, 1.35, -1.36], gauge);
  clock.addCube(needle, 'Red gauge needle', [-0.05, 1.35, -1.38], [0.05, 2.15, -1.34], 'blood',
    [0, 0, 0], [0, 1.35, -1.36]);
  clock.cylinder(needle, 'Needle pivot', 0, 1.35, -1.37, 0.12, 0.08, 'brass', clock.D.tiny, 'z');

  for (let i = 0; i < 3; i++) {
    const segment = clock.group(`LifeSegment${i + 1}`, [0, 0, 0], housing);
    clock.cylinder(segment, `Life lamp ${i + 1}`, (i - 1) * 1.1, 0.8, -1.15, 0.3, 0.18,
      i === 2 ? 'blood' : 'bone', clock.D.small, 'z');
  }
  if (clock.D.extra) {
    for (const [sx, sy] of [[-1.9, 0.5], [1.9, 0.5], [-1.9, 2.1], [1.9, 2.1]]) {
      clock.cylinder(housing, 'Housing screw', sx, sy, -1.12, 0.14, 0.12, 'brass', clock.D.tiny, 'z');
    }
  }
  await clock.save(`chess_clock_monitor_${style}.bbmodel`);
}

/* ================================================================ main */

await mkdir(output, { recursive: true });
await mkdir(textureDir, { recursive: true });

for (const style of ['realistic', 'lowpoly']) {
  const atlas = buildAtlas(style);
  await writeFile(new URL(`${style}_albedo.png`, textureDir),
    encodePNG(atlas.width, atlas.height, 3, atlas.albedo));
  if (style === 'realistic') {
    await writeFile(new URL('realistic_roughness.png', textureDir),
      encodePNG(atlas.width, atlas.height, 1, atlas.roughness));
    await writeFile(new URL('realistic_metalness.png', textureDir),
      encodePNG(atlas.width, atlas.height, 1, atlas.metalness));
    await writeFile(new URL('realistic_normal.png', textureDir),
      encodePNG(atlas.width, atlas.height, 3, atlas.normal));
  }
  await buildModels(style, atlas);
  console.log(`Generated ${style} models and ${style} albedo atlas (${atlas.width}x${atlas.height})`);
}

console.log('Done: casino_environment, seated_mafioso, twin_chamber_revolver, chess_clock_monitor (realistic + lowpoly)');
