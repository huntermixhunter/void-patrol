'use strict';
// Void Patrol desktop shell. The game is a static web app in ../game; this window serves it
// from a private app:// origin so ES modules, sample loading, and saved progress all work offline.
const { app, BrowserWindow, Menu, net, protocol, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const GAME_DIR = path.join(__dirname, '..', 'game');
const ORIGIN = 'app://void-patrol';
const SMOKE = process.env.VOID_PATROL_SMOKE || '';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

if (!SMOKE && !app.requestSingleInstanceLock()) app.quit();

function serve(request) {
  const url = new URL(request.url);
  if (url.host !== 'void-patrol') return new Response('Not found', { status: 404 });
  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(GAME_DIR, relative);
  // Never serve anything outside the game folder.
  if (file !== GAME_DIR && !file.startsWith(GAME_DIR + path.sep)) return new Response('Forbidden', { status: 403 });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return new Response('Not found', { status: 404 });
  return net.fetch(pathToFileURL(file).toString());
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 800, minHeight: 500,
    show: !SMOKE, backgroundColor: '#000000', title: 'Void Patrol', autoHideMenuBar: true,
    icon: path.join(GAME_DIR, 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  // Links to other sites open in the normal browser, never inside the game window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(ORIGIN + '/')) { event.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });
  win.loadURL(ORIGIN + '/index.html');
  return win;
}

// Headless self-test: load the game, launch a run, fly briefly, then report errors and a screenshot.
async function smoke(win) {
  const errors = [];
  win.webContents.on('console-message', (...args) => {
    const detail = args[0] && typeof args[0] === 'object' && 'level' in args[0] ? args[0] : { level: args[1], message: args[2] };
    if (detail.level === 'error' || detail.level === 3) errors.push(String(detail.message));
  });
  win.webContents.on('did-fail-load', (_e, code, description, url) => errors.push(`load failed ${code} ${description} ${url}`));
  win.webContents.on('render-process-gone', (_e, details) => errors.push('renderer gone: ' + details.reason));
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const run = code => win.webContents.executeJavaScript(code, true);
  await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
  await wait(1500);
  const before = await run(`({ state: document.body.dataset.state, font: document.fonts.check('16px Antonio'),
    images: [...document.images].filter(img => !img.complete || !img.naturalWidth).map(img => img.src) })`);
  await run(`document.getElementById('launch').click()`);
  await wait(2500);
  const after = await run(`({ state: document.body.dataset.state, laser: document.getElementById('laser-name').textContent,
    score: document.getElementById('score').textContent })`);
  const assets = await run(`Promise.all(['assets/ship.webp','assets/fortress.webp','assets/sounds/laser-shot.wav','assets/fonts/Antonio.woff2']
    .map(u => fetch(u).then(r => r.status + ' ' + u)))`);
  fs.mkdirSync(SMOKE, { recursive: true });
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(SMOKE, 'smoke.png'), image.toPNG());
  const ok = errors.length === 0 && before.state === 'menu' && after.state === 'playing' && before.font
    && after.laser === 'RED LASERS' && assets.every(line => line.startsWith('200'));
  const report = { ok, before, after, assets, errors, version: app.getVersion(), electron: process.versions.electron };
  fs.writeFileSync(path.join(SMOKE, 'smoke.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  app.exit(ok ? 0 : 1);
}

app.whenReady().then(() => {
  protocol.handle('app', serve);
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  const win = createWindow();
  if (SMOKE) smoke(win).catch(error => { console.error(error); app.exit(1); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('second-instance', () => {
  const [win] = BrowserWindow.getAllWindows();
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
