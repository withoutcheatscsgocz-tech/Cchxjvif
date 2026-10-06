#!/usr/bin/env node
/*
 * Builds the Windows app, from Windows, Linux or macOS (no Wine needed):
 *
 *   desktop/dist/win-unpacked/                              the app folder
 *   desktop/dist/TimeMovesWhenYouDraw-<version>-win-x64.zip  that folder, zipped (itch.io, butler)
 *   desktop/dist/TimeMovesWhenYouDraw-<version>-portable.exe one .exe that runs without installing
 *
 * Steps: take the version from the root package.json, copy the web game in,
 * package Electron for Windows x64, write the icon and version details into
 * TimeMovesWhenYouDraw.exe with resedit (plain JavaScript, so this works where
 * electron-builder would need Wine for it), then build the zip and the
 * portable .exe from that finished folder.
 *
 *   cd desktop && npm ci && npm run dist:win
 */
'use strict';

const fs = require('fs');
const path = require('path');
const builder = require('electron-builder');
const ResEdit = require('resedit');
const { sync } = require('./sync-web.js');

const DESKTOP = path.resolve(__dirname, '..');
const DIST = path.join(DESKTOP, 'dist');
const UNPACKED = path.join(DIST, 'win-unpacked');

function syncVersion() {
  const root = JSON.parse(fs.readFileSync(path.join(DESKTOP, '..', 'package.json'), 'utf8')).version;
  const file = path.join(DESKTOP, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(root)) throw new Error(`package.json version must be x.y.z, got ${root}`);
  if (pkg.version !== root) {
    pkg.version = root;
    fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`desktop/package.json version set to ${root} (from the root package.json)`);
  }
  return { version: root, pkg };
}

/* Icon and the details Windows shows in Properties and Task Manager. */
function brandExe(exe, version, pkg) {
  const image = ResEdit.NtExecutable.from(fs.readFileSync(exe), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(image);

  const icon = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(DESKTOP, 'build', 'icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  if (!groups.length) throw new Error(`${exe} has no icon group to replace`);
  for (const g of groups) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, g.id, g.lang, icon.icons.map((i) => i.data));
  }

  const info = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0] || ResEdit.Resource.VersionInfo.createEmpty();
  const [major, minor, patch] = version.split('.').map(Number);
  const langs = info.getAllLanguagesForStringValues();
  const targets = langs.length ? langs : [{ lang: 1033, codepage: 1200 }];
  for (const t of targets) {
    info.setFileVersion(major, minor, patch, 0, t.lang);
    info.setProductVersion(major, minor, patch, 0, t.lang);
    info.setStringValues(t, {
      CompanyName: pkg.author,
      FileDescription: pkg.build.productName,
      FileVersion: `${version}.0`,
      InternalName: pkg.build.executableName,
      LegalCopyright: pkg.build.copyright,
      OriginalFilename: `${pkg.build.executableName}.exe`,
      ProductName: pkg.build.productName,
      ProductVersion: version,
    });
  }
  info.outputToResourceEntries(res.entries);
  res.outputResource(image);
  fs.writeFileSync(exe, Buffer.from(image.generate()));
}

(async () => {
  const { version, pkg } = syncVersion();
  sync();
  fs.rmSync(DIST, { recursive: true, force: true });

  const { Platform, Arch } = builder;
  // publish: 'never', or electron-builder uploads to GitHub by itself when CI builds a tag.
  await builder.build({ projectDir: DESKTOP, publish: 'never', targets: Platform.WINDOWS.createTarget(['dir'], Arch.x64) });
  const exe = path.join(UNPACKED, `${pkg.build.executableName}.exe`);
  if (!fs.existsSync(exe)) throw new Error(`expected ${exe}`);
  brandExe(exe, version, pkg);

  await builder.build({
    projectDir: DESKTOP,
    prepackaged: UNPACKED,
    publish: 'never',
    targets: Platform.WINDOWS.createTarget(['zip', 'portable'], Arch.x64),
  });

  const out = fs
    .readdirSync(DIST)
    .filter((f) => /\.(exe|zip)$/.test(f))
    .map((f) => `  ${f}  ${(fs.statSync(path.join(DIST, f)).size / 1048576).toFixed(1)} MB`);
  console.log(`\nWindows build ${version}:\n  win-unpacked/${path.basename(exe)}\n${out.join('\n')}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
