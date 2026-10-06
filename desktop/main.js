/*
 * Time Moves When You Draw: the desktop app (Windows .exe, also runs on Linux/macOS).
 *
 * One window running the web game from web/ (copied in by scripts/sync-web.js).
 * The files are served on the app://game/ scheme rather than file://, which
 * gives the page a stable origin, so stars saved in localStorage survive
 * restarts. Every network request is refused: the game needs none.
 *
 * Keys on top of the game's own: F11 or Alt+Enter toggles fullscreen.
 */
'use strict';

const { app, BrowserWindow, Menu, protocol, screen, session, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const SCHEME = 'app';
const HOST = 'game';
const ORIGIN = `${SCHEME}://${HOST}`;
const WEB_ROOT = path.join(__dirname, 'web');
const PAPER = '#eceef1';
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

// Lets tools/playtest.js run the app with a throwaway profile; Chromium knows the switch too.
const userDataDir = app.commandLine.getSwitchValue('user-data-dir');
if (userDataDir) app.setPath('userData', path.resolve(userDataDir));

// Must happen before the app is ready: app:// behaves like https (secure, has an origin, storage).
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

if (process.platform === 'win32') app.setAppUserModelId('io.github.withoutcheatscsgocz_tech.timemoves');

let win = null;

/* Serve web/ at app://game/. Anything outside it is a 404. */
function serveGame(ses) {
  ses.protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== HOST) return new Response('Not found', { status: 404 });
    let rel;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch (e) {
      return new Response('Bad request', { status: 400 });
    }
    if (rel === '/') rel = '/index.html';
    const file = path.join(WEB_ROOT, path.normalize(rel));
    if (!file.startsWith(WEB_ROOT + path.sep)) return new Response('Not found', { status: 404 });
    try {
      const body = await fs.promises.readFile(file); // works inside app.asar too
      const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
      return new Response(body, { headers: { 'content-type': type, 'cache-control': 'no-cache' } });
    } catch (e) {
      return new Response('Not found', { status: 404 });
    }
  });
}

/* No network, no permissions: the game is entirely local. */
function lockDown(ses) {
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, done) =>
    done({ cancel: true })
  );
  ses.setPermissionRequestHandler((webContents, permission, done) => done(false));
  ses.setPermissionCheckHandler(() => false);
}

/* Remember where the window was, and only reuse it if it is still on a screen. */
const boundsFile = () => path.join(app.getPath('userData'), 'window.json');

function savedBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(boundsFile(), 'utf8'));
    if (![b.x, b.y, b.width, b.height].every(Number.isFinite)) return null;
    const visible = screen.getAllDisplays().some(({ workArea: a }) =>
      b.x < a.x + a.width - 80 && b.x + b.width > a.x + 80 && b.y >= a.y - 8 && b.y < a.y + a.height - 80
    );
    return visible ? b : null;
  } catch (e) {
    return null;
  }
}

function defaultBounds() {
  // A portrait window, like the phone the game was designed for, filling most of the screen's height.
  const { workArea } = screen.getPrimaryDisplay();
  const height = Math.max(600, Math.min(1000, Math.round(workArea.height * 0.9)));
  const width = Math.round(height * 0.6);
  return {
    width,
    height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
  };
}

function saveBounds() {
  if (!win || win.isDestroyed()) return;
  try {
    const b = win.getNormalBounds();
    fs.writeFileSync(boundsFile(), JSON.stringify({ ...b, fullscreen: win.isFullScreen() }));
  } catch (e) {
    // Not being able to remember the window is no reason to fail.
  }
}

function createWindow() {
  const saved = savedBounds();
  const bounds = saved || defaultBounds();
  win = new BrowserWindow({
    ...bounds,
    minWidth: 360,
    minHeight: 600,
    backgroundColor: PAPER,
    title: 'Time Moves When You Draw',
    icon: path.join(__dirname, 'build', 'icon.png'), // Linux taskbar; on Windows the .exe's own icon is used
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  if (saved && saved.fullscreen) win.setFullScreen(true);
  win.once('ready-to-show', () => win.show());
  win.on('close', saveBounds);

  const wc = win.webContents;
  wc.setVisualZoomLevelLimits(1, 1); // no pinch zoom on touch screens
  wc.on('zoom-changed', () => wc.setZoomFactor(1)); // nor Ctrl + mouse wheel
  // Links leave the app for the default browser; the game itself never navigates away.
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${ORIGIN}/`)) event.preventDefault();
  });
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.key === 'Enter' && input.alt)) {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });

  win.loadURL(`${ORIGIN}/index.html`);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null); // no menu bar, and none of its reload or devtools shortcuts
    const ses = session.defaultSession;
    serveGame(ses);
    lockDown(ses);
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('web-contents-created', (event, contents) => {
    contents.on('will-attach-webview', (e) => e.preventDefault());
  });

  app.on('window-all-closed', () => app.quit());
}
