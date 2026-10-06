#!/usr/bin/env node
/*
 * Renders build/icon.svg into build/icon.png (512 px, for Linux and the
 * window) and build/icon.ico (16 to 256 px, for the Windows .exe), using
 * Chromium through Playwright. The .ico holds PNG images, which Windows has
 * read since Vista. The outputs are committed; rerun this after editing the SVG:
 *
 *   NODE_PATH=$(npm root -g) node desktop/scripts/make-icon.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BUILD = path.resolve(__dirname, '..', 'build');
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];

/* An .ico file: a 6-byte header, a 16-byte entry per image, then the PNGs themselves. */
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // 0 means 256
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // no palette
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

(async () => {
  const svg = fs.readFileSync(path.join(BUILD, 'icon.svg'), 'utf8');
  const browser = await chromium.launch(
    fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {}
  );
  const render = async (size) => {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    const sized = svg.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`);
    await page.setContent(`<html><body style="margin:0;background:transparent">${sized}</body></html>`);
    const data = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    await page.close();
    return data;
  };
  const pngs = [];
  for (const size of SIZES) pngs.push({ size, data: await render(size) });
  fs.writeFileSync(path.join(BUILD, 'icon.png'), await render(512));
  fs.writeFileSync(path.join(BUILD, 'icon.ico'), ico(pngs));
  await browser.close();
  console.log(`build/icon.png (512 px) and build/icon.ico (${SIZES.join(', ')} px)`);
})();
