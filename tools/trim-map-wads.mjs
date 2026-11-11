// Writes web/assets/maps/<map>.wad holding only the textures that map's BSP
// references. narutowad.wad carries 204 textures (10.8 MB) but a map uses a few
// dozen of them, so every player downloaded roughly ten times what they needed.
//
// Run from the repository root:  node tools/trim-map-wads.mjs
//
// The loader falls back to the full archives when a trimmed one is missing or
// does not cover every texture the map asks for, so re-running this is optional
// and deleting the output is always safe.
import {readFileSync, writeFileSync, readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';

const WEB = 'web';
const MAPS = join(WEB, 'assets/maps');
const SOURCES = ['assets/narutowad.wad', 'assets/nnk_rooftop.wad'].map(p => join(WEB, p));

const read = path => {
  const buffer = readFileSync(path);
  return {buffer, view: new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)};
};
const name16 = (view, at) => {
  let out = '';
  for (let i = 0; i < 16; i++) {
    const code = view.getUint8(at + i);
    if (!code) break;
    out += String.fromCharCode(code);
  }
  return out.toLowerCase();
};

function readWad(path) {
  const {buffer, view} = read(path);
  if (String.fromCharCode(...[0, 1, 2, 3].map(i => view.getUint8(i))) !== 'WAD3') {
    throw Error(`${path} is not a WAD3 archive`);
  }
  const count = view.getInt32(4, true), directory = view.getInt32(8, true);
  const lumps = new Map();
  for (let i = 0; i < count; i++) {
    const entry = directory + i * 32;
    lumps.set(name16(view, entry + 16), {
      data: buffer.subarray(view.getInt32(entry, true), view.getInt32(entry, true) + view.getInt32(entry + 4, true)),
      size: view.getInt32(entry + 8, true),
      type: view.getUint8(entry + 12),
      compression: view.getUint8(entry + 13),
    });
  }
  return lumps;
}

// Lump 2 of a GoldSrc BSP is the miptex lump. A texture whose first mip offset is
// zero lives in a WAD rather than in the map itself.
function externalTextures(path) {
  const {view} = read(path);
  if (view.getInt32(0, true) !== 30) throw Error(`${path} is not a GoldSrc BSP`);
  const lump = view.getInt32(4 + 2 * 8, true);
  const count = view.getInt32(lump, true);
  const names = [];
  for (let i = 0; i < count; i++) {
    const relative = view.getInt32(lump + 4 + i * 4, true);
    if (relative < 0) continue;
    const miptex = lump + relative;
    if (view.getInt32(miptex + 24, true) === 0) names.push(name16(view, miptex));
  }
  return [...new Set(names)];
}

function writeWad(path, lumps) {
  const body = [...lumps.values()].reduce((total, lump) => total + lump.data.length, 0);
  const out = Buffer.alloc(12 + body + lumps.size * 32);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  out.write('WAD3', 0, 'ascii');
  view.setInt32(4, lumps.size, true);
  view.setInt32(8, 12 + body, true);
  let at = 12, entry = 12 + body;
  for (const [name, lump] of lumps) {
    out.set(lump.data, at);
    view.setInt32(entry, at, true);
    view.setInt32(entry + 4, lump.data.length, true);
    view.setInt32(entry + 8, lump.size, true);
    view.setUint8(entry + 12, lump.type);
    view.setUint8(entry + 13, lump.compression);
    out.write(name.slice(0, 15), entry + 16, 'ascii');
    at += lump.data.length;
    entry += 32;
  }
  writeFileSync(path, out);
  return out.length;
}

const library = new Map();
for (const source of SOURCES) {
  for (const [name, lump] of readWad(source)) if (!library.has(name)) library.set(name, lump);
}
console.log(`source archives: ${library.size} textures`);

let before = 0, after = 0;
for (const file of readdirSync(MAPS).filter(f => f.endsWith('.bsp'))) {
  const needed = externalTextures(join(MAPS, file));
  const missing = needed.filter(n => !library.has(n));
  if (missing.length) {
    console.warn(`  ${file}: SKIPPED, ${missing.length} texture(s) not in the archives: ${missing.join(', ')}`);
    continue;
  }
  const lumps = new Map(needed.map(n => [n, library.get(n)]));
  const out = join(MAPS, file.replace(/\.bsp$/, '.wad'));
  const size = writeWad(out, lumps);
  const full = SOURCES.reduce((total, p) => total + statSync(p).size, 0);
  before += full;
  after += size;
  console.log(`  ${file}: ${needed.length} textures -> ${(size / 1048576).toFixed(2)} MB (was ${(full / 1048576).toFixed(2)} MB)`);
}
console.log(`per-map download: ${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB across all maps`);
