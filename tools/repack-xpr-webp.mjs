// Rewrites the .xpr jutsu effect archives with WebP frames instead of PNG.
// An .xpr is a zip of numbered sprite frames; the 20 archives are 17.3 MB, do not
// compress any further on the wire because PNG is already deflated, and are by far
// the largest thing a match downloads. Re-encoded as WebP they lose about 74%.
//
// Run from the repository root:  node tools/repack-xpr-webp.mjs [--quality 85]
//
// Frames are stored uncompressed inside the zip, since WebP is already compressed.
// decodeXpr() in web/assets.js reads both .png and .webp entries, so an archive
// that has not been repacked, or one Sites regenerates, keeps working.
import {readFileSync, writeFileSync, readdirSync, mkdtempSync, rmSync, statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join, basename} from 'node:path';
import {tmpdir} from 'node:os';

const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const QUALITY = Number(process.argv[process.argv.indexOf('--quality') + 1]) || 85;
const ROOTS = ['web/assets/sprites/jutsus', 'web/assets/sprites/general'];

const crcTable = Int32Array.from({length: 256}, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = buffer => {
  let c = -1;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

// Only the local headers matter to the game, but write a complete zip anyway.
function buildZip(files) {
  const locals = [], central = [];
  let offset = 0;
  for (const {name, data} of files) {
    const nameBytes = Buffer.from(name, 'ascii'), sum = crc32(data);
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30);
    locals.push(local, data);

    const entry = Buffer.alloc(46 + nameBytes.length);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(sum, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    nameBytes.copy(entry, 46);
    central.push(entry);
    offset += local.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

// The game walks local headers from byte 0, so read them the same way rather than
// trusting a central directory the archives may not have.
function readZip(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const entries = [];
  let at = 0;
  while (at + 30 <= buffer.length && view.getUint32(at, true) === 0x04034b50) {
    const flags = view.getUint16(at + 6, true), method = view.getUint16(at + 8, true);
    const length = view.getUint32(at + 18, true), size = view.getUint32(at + 22, true);
    const nameLength = view.getUint16(at + 26, true), extra = view.getUint16(at + 28, true);
    const name = buffer.toString('ascii', at + 30, at + 30 + nameLength);
    const start = at + 30 + nameLength + extra;
    if (flags & 9) throw Error(`${name}: encrypted or streamed entry`);
    entries.push({name, method, size, data: buffer.subarray(start, start + length)});
    at = start + length;
  }
  return entries;
}

const {inflateRawSync} = await import('node:zlib');

let before = 0, after = 0, archives = 0;
for (const root of ROOTS) {
  let listing;
  try { listing = readdirSync(root); } catch { continue; }
  for (const file of listing.filter(f => f.toLowerCase().endsWith('.xpr'))) {
    const path = join(root, file);
    const entries = readZip(readFileSync(path));
    const frames = entries.filter(e => /\.png$/i.test(e.name));
    if (!frames.length) {
      console.log(`  ${file}: no PNG frames, left alone`);
      continue;
    }
    const work = mkdtempSync(join(tmpdir(), 'xpr-'));
    try {
      const repacked = frames.map(frame => {
        const raw = frame.method === 8 ? inflateRawSync(frame.data) : frame.data;
        if (frame.method === 8 && raw.length !== frame.size) throw Error(`${file}/${frame.name}: bad inflate`);
        const png = join(work, basename(frame.name));
        const webp = png.replace(/\.png$/i, '.webp');
        writeFileSync(png, raw);
        execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', png,
          '-c:v', 'libwebp', '-quality', String(QUALITY), '-compression_level', '6', webp]);
        return {name: frame.name.replace(/\.png$/i, '.webp'), data: readFileSync(webp)};
      });
      const original = statSync(path).size;
      const zip = buildZip(repacked);
      if (zip.length >= original) {
        console.log(`  ${file}: WebP is not smaller, left alone`);
        continue;
      }
      writeFileSync(path, zip);
      before += original;
      after += zip.length;
      archives++;
      console.log(`  ${file}: ${frames.length} frames, ${(original / 1048576).toFixed(2)} MB -> ${(zip.length / 1048576).toFixed(2)} MB`);
    } finally {
      rmSync(work, {recursive: true, force: true});
    }
  }
}
console.log(`${archives} archives: ${(before / 1048576).toFixed(2)} MB -> ${(after / 1048576).toFixed(2)} MB (quality ${QUALITY})`);
