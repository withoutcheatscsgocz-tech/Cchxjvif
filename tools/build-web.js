#!/usr/bin/env node
/*
 * Builds the browser version for itch.io (or any static host):
 *
 *   dist/web/                                     index.html, js/, fonts/: push this folder with butler
 *   dist/time-moves-when-you-draw-web-<ver>.zip   the same files with index.html at the zip root,
 *                                                 for uploading by hand ("played in the browser")
 *
 *   node tools/build-web.js        (or: npm run build:web)
 *
 * The files are the ones the Android app packs (index.html, js/**, fonts/**), with one change:
 * the page's scripts, stylesheet and fonts are linked as file?v=<content hash>. itch.io serves
 * them with a month-long cache and only cache-busts index.html, so without this a returning
 * player could get a new page with last month's game code.
 *
 * It fails loudly (exit 1) if the build breaks itch.io's HTML5 rules: index.html at the root,
 * at most 1,000 files, 240 characters per path, 200 MB per file, 500 MB in total. It also fails
 * if a file the page loads is missing, is an absolute /path, is on another server (the game
 * must work offline), or only matches with different letter case (itch.io's servers are
 * case-sensitive even when your disk isn't).
 *
 * No dependencies: the zip is written here (deflate from zlib), with fixed timestamps, so the
 * same sources always give the same zip.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(DIST, 'web');
const SLUG = 'time-moves-when-you-draw';
const INCLUDE = ['index.html', 'js', 'fonts'];
// https://itch.io/docs/creators/html5#zip-file-requirements (decimal MB, to stay on the safe side)
const LIMITS = { files: 1000, pathChars: 240, fileBytes: 200e6, totalBytes: 500e6 };

function fail(msg) {
  console.error(`build-web: ${msg}`);
  process.exit(1);
}

const { version } = require('../package.json');
if (!/^[0-9A-Za-z.+-]+$/.test(String(version))) fail(`package.json version "${version}" can't go in a file name`);
const ZIP = path.join(DIST, `${SLUG}-web-${version}.zip`);

/* ---------- collect ---------- */

// Repo-relative path (forward slashes) -> contents. Dotfiles (.DS_Store and friends) stay out.
const files = new Map();
function add(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) fail(`${rel} is missing`);
  if (fs.statSync(abs).isDirectory()) {
    for (const name of fs.readdirSync(abs).sort()) if (!name.startsWith('.')) add(`${rel}/${name}`);
  } else {
    files.set(rel, fs.readFileSync(abs));
  }
}
INCLUDE.forEach(add);

/* ---------- check references, add cache-busters ---------- */

const hash = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);
const problems = [];

// Resolve a reference made from file `from`; returns the reference with ?v=<hash> appended.
function bust(from, ref) {
  if (/^data:/i.test(ref) || ref.startsWith('#')) return ref;
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(ref)) {
    problems.push(`${from} loads ${ref} from another server (the game must work offline)`);
    return ref;
  }
  if (ref.startsWith('/')) {
    problems.push(`${from} uses the absolute path ${ref} (itch.io serves the game from a subfolder)`);
    return ref;
  }
  const [file, query] = ref.split(/(?=[?#])/);
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(from), decodeURIComponent(file)));
  if (!files.has(target)) {
    const other = [...files.keys()].find((k) => k.toLowerCase() === target.toLowerCase());
    problems.push(`${from} loads ${ref}: ${other ? `the file is ${other} (letter case differs)` : 'no such file in the build'}`);
    return ref;
  }
  return query ? ref : `${file}?v=${hash(files.get(target))}`;
}

// Stylesheets first, so the page's link to fonts.css gets the hash of the rewritten file.
const order = [...files.keys()].sort((a, b) => (a.endsWith('.css') ? 0 : 1) - (b.endsWith('.css') ? 0 : 1));
for (const rel of order) {
  let text;
  if (rel.endsWith('.css')) {
    text = files.get(rel).toString('utf8');
    text = text.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, ref) => `url(${q}${bust(rel, ref.trim())}${q})`);
  } else if (rel.endsWith('.html')) {
    text = files.get(rel).toString('utf8');
    // Only what the browser loads (scripts, stylesheets, icons, media); plain <a href> links are left alone.
    text = text.replace(
      /(<(?:script|link|img|source|audio|video)\b[^>]*?\s(?:src|href)\s*=\s*)(["'])(.*?)\2/gi,
      (m, head, q, ref) => `${head}${q}${bust(rel, ref.trim())}${q}`
    );
  } else continue;
  files.set(rel, Buffer.from(text, 'utf8'));
}

/* ---------- itch.io limits ---------- */

const names = [...files.keys()].sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a < b ? -1 : 1));
const total = names.reduce((n, k) => n + files.get(k).length, 0);
const largest = names.reduce((m, k) => (files.get(k).length > files.get(m).length ? k : m), names[0]);
const longest = names.reduce((m, k) => (k.length > m.length ? k : m), names[0]);
const seen = new Map();
if (!files.has('index.html')) problems.push('index.html must be at the root of the build');
if (names.length > LIMITS.files) problems.push(`${names.length} files (itch.io allows ${LIMITS.files})`);
if (total > LIMITS.totalBytes) problems.push(`${total} bytes in total (itch.io allows ${LIMITS.totalBytes})`);
for (const k of names) {
  if (k.length > LIMITS.pathChars) problems.push(`${k}: path longer than ${LIMITS.pathChars} characters`);
  if (files.get(k).length > LIMITS.fileBytes) problems.push(`${k}: larger than ${LIMITS.fileBytes} bytes`);
  if (/\\|(^|\/)\.\.?(\/|$)|^\//.test(k)) problems.push(`${k}: not a clean relative path`);
  const low = k.toLowerCase();
  if (seen.has(low)) problems.push(`${k} and ${seen.get(low)} differ only in letter case`);
  seen.set(low, k);
}
if (problems.length) fail(`the build would break on itch.io:\n  ${problems.join('\n  ')}`);

/* ---------- zip ---------- */

const crc32 =
  zlib.crc32 ||
  ((buf) => {
    let c = ~0;
    for (const byte of buf) {
      c ^= byte;
      for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  });

const DOS_TIME = 0; // 00:00:00
const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01, the earliest date a zip can hold
const UTF8 = 0x0800; // general purpose flag 11: names are UTF-8
const MODE = 0o100644 * 0x10000; // external attributes: regular file, rw-r--r--

function zip(entries) {
  const body = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const fname = Buffer.from(name, 'utf8');
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const method = deflated.length < data.length ? 8 : 0; // fonts are already compressed: store them
    const stored = method === 8 ? deflated : data;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed to extract: 2.0
    local.writeUInt16LE(UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fname.length, 26);
    local.writeUInt16LE(0, 28); // extra field length

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE((3 << 8) | 20, 4); // made by: Unix, 2.0 (so the file mode counts)
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(UTF8, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt16LE(DOS_TIME, 12);
    entry.writeUInt16LE(DOS_DATE, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(stored.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(fname.length, 28);
    // 30 extra length, 32 comment length, 34 disk number, 36 internal attributes: all 0
    entry.writeUInt32LE(MODE, 38);
    entry.writeUInt32LE(offset, 42);

    body.push(local, fname, stored);
    central.push(entry, fname);
    offset += local.length + fname.length + stored.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8); // entries on this disk
  end.writeUInt16LE(entries.length, 10); // entries in total
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16); // where the central directory starts
  if (offset + dir.length >= 2 ** 32 || entries.length > 0xffff) fail('too big for a plain zip');
  return Buffer.concat([...body, dir, end]);
}

/* Read the archive back the way an unzipper does (end record -> central directory -> local
 * headers -> inflate -> CRC) and compare every entry with its source, so a writer bug fails here
 * instead of on itch.io. */
function checkZip(buf, entries) {
  const end = buf.length - 22;
  if (buf.readUInt32LE(end) !== 0x06054b50) return 'no end-of-central-directory record';
  const count = buf.readUInt16LE(end + 10);
  if (count !== entries.length) return `${count} entries, expected ${entries.length}`;
  let p = buf.readUInt32LE(end + 16);
  for (const { name, data } of entries) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return `bad central directory entry for ${name}`;
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const at = buf.readUInt32LE(p + 42);
    if (buf.toString('utf8', p + 46, p + 46 + nameLen) !== name) return `entry name mismatch for ${name}`;
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    if (buf.readUInt32LE(at) !== 0x04034b50) return `bad local header for ${name}`;
    const from = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
    const raw = buf.subarray(from, from + size);
    const out = method === 8 ? zlib.inflateRawSync(raw) : raw;
    if (!out.equals(data) || crc32(out) !== buf.readUInt32LE(at + 14)) return `${name} doesn't unpack to its source`;
  }
  return null;
}

/* ---------- write ---------- */

fs.rmSync(OUT, { recursive: true, force: true });
for (const f of fs.existsSync(DIST) ? fs.readdirSync(DIST) : []) {
  if (f.startsWith(`${SLUG}-web-`) && f.endsWith('.zip')) fs.rmSync(path.join(DIST, f));
}
for (const k of names) {
  fs.mkdirSync(path.join(OUT, path.dirname(k)), { recursive: true });
  fs.writeFileSync(path.join(OUT, k), files.get(k));
}
const entries = names.map((name) => ({ name, data: files.get(name) }));
const archive = zip(entries);
const broken = checkZip(archive, entries);
if (broken) fail(`the zip writer made a bad archive: ${broken}`);
fs.writeFileSync(ZIP, archive);

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const bytes = (n) => `${n.toLocaleString('en-US')} bytes`;
const rel = (p) => path.relative(process.cwd(), p) || '.';
const count = (dir) => names.filter((k) => k.startsWith(dir + '/')).length;
console.log(
  `${rel(OUT)}/  ${names.length} files, ${bytes(total)} (${kb(total)})  (index.html, js/ ${count('js')}, fonts/ ${count('fonts')})`
);
console.log(`${rel(ZIP)}  ${bytes(archive.length)} (${kb(archive.length)}), index.html at the root`);
console.log(
  `itch.io limits ok: ${names.length}/${LIMITS.files} files, longest path ${longest.length}/${LIMITS.pathChars} chars ` +
    `(${longest}), largest file ${kb(files.get(largest).length)} (${largest})`
);
