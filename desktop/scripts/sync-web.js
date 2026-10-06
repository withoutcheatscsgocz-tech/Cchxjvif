#!/usr/bin/env node
/*
 * Copies the web game (index.html, js/, fonts/) from the repository root into
 * desktop/web/, which the app serves and electron-builder packs. Run by
 * "npm start" and by scripts/build-win.js; desktop/web/ is not committed.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.resolve(__dirname, '..', 'web');

function sync() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(OUT, 'index.html'));
  for (const dir of ['js', 'fonts']) {
    fs.cpSync(path.join(ROOT, dir), path.join(OUT, dir), {
      recursive: true,
      filter: (src) => !path.basename(src).startsWith('.'),
    });
  }
  return OUT;
}

module.exports = { sync };

if (require.main === module) {
  sync();
  console.log(`web game copied to ${path.relative(process.cwd(), OUT) || '.'}`);
}
