'use strict';
// AI YT Studio для компьютера: кабинет сервиса в собственном окне.
// Данные и оплата остаются на сервере (закон о персональных данных), интерфейс обновляется сам вместе с сайтом.
const { app, BrowserWindow, Menu, shell, dialog, session, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const pkg = require('./package.json');
// Адрес сервера можно переопределить для теста: AIYT_SERVER=http://localhost:8080
const SERVER = (process.env.AIYT_SERVER || pkg.aiytServer).replace(/\/$/, '');
const ORIGIN = new URL(SERVER).origin;
const START = SERVER + '/app/';
// Страницы, которые открываются внутри окна: свой сервер, оплата ЮKassa и вход через Google.
const INSIDE = [ORIGIN, 'https://yoomoney.ru', 'https://yookassa.ru', 'https://accounts.google.com'];
const isInside = (u) => { try { const x = new URL(u); return INSIDE.some(o => x.origin === o || x.hostname.endsWith('.' + new URL(o).hostname)); } catch (e) { return false; } };
const RU = !String(app.getLocale() || 'ru').startsWith('en'); // меню на русском, кроме английской Windows
const T = RU
  ? { file: 'Файл', home: 'Кабинет', billing: 'Тариф и оплата', site: 'Открыть сайт в браузере', quit: 'Выход', edit: 'Правка', view: 'Вид', reload: 'Обновить', zoomIn: 'Крупнее', zoomOut: 'Мельче', zoomReset: 'Обычный размер', full: 'Во весь экран', help: 'Справка', about: 'О программе', support: 'Поддержка', aboutText: 'AI YT Studio для компьютера, версия ' }
  : { file: 'File', home: 'Dashboard', billing: 'Plan & billing', site: 'Open website in browser', quit: 'Quit', edit: 'Edit', view: 'View', reload: 'Reload', zoomIn: 'Zoom in', zoomOut: 'Zoom out', zoomReset: 'Actual size', full: 'Full screen', help: 'Help', about: 'About', support: 'Support', aboutText: 'AI YT Studio for desktop, version ' };

// Одна копия программы: повторный запуск поднимает уже открытое окно.
if (!app.requestSingleInstanceLock()) { app.quit(); }

let win = null;
const stateFile = () => path.join(app.getPath('userData'), 'window.json');
function loadState() { try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch (e) { return { width: 1280, height: 820 }; } }
function saveState() {
  if (!win || win.isDestroyed()) return;
  try { fs.writeFileSync(stateFile(), JSON.stringify(Object.assign(win.getNormalBounds(), { maximized: win.isMaximized() }))); } catch (e) {}
}

async function serverOk() {
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(SERVER + '/api/health', { signal: ctrl.signal }); clearTimeout(t);
    return r.ok;
  } catch (e) { return false; }
}

async function openStart() {
  if (await serverOk()) win.loadURL(START);
  else win.loadFile(path.join(__dirname, 'offline.html'), { query: { server: SERVER, lang: RU ? 'ru' : 'en' } });
}

function createWindow() {
  const st = loadState();
  win = new BrowserWindow({
    x: st.x, y: st.y, width: st.width || 1280, height: st.height || 820, minWidth: 380, minHeight: 560,
    title: 'AI YT Studio', icon: path.join(__dirname, process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    backgroundColor: '#F4F3EF', show: false, autoHideMenuBar: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true }
  });
  if (st.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  ['resize', 'move', 'close'].forEach(ev => win.on(ev, saveState));

  // Ссылки: внутри окна — сервис, оплата и вход Google; всё остальное — в обычном браузере.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isInside(url)) { win.loadURL(url); return { action: 'deny' }; }
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('file:')) return;
    if (!isInside(url)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });
  // Сервер ответил ошибкой на кабинет (например, ещё не запущен) — тот же понятный экран.
  win.webContents.on('did-navigate', (e, url, code) => {
    if (url.startsWith(SERVER + '/app') && (code === 404 || code >= 500)) win.loadFile(path.join(__dirname, 'offline.html'), { query: { server: SERVER, lang: RU ? 'ru' : 'en' } });
  });
  // Пропала связь посреди работы — показываем понятный экран вместо ошибки браузера.
  win.webContents.on('did-fail-load', (e, code, desc, url, isMain) => {
    if (isMain && code !== -3) win.loadFile(path.join(__dirname, 'offline.html'), { query: { server: SERVER, lang: RU ? 'ru' : 'en' } });
  });
  openStart();
}

function buildMenu() {
  const go = (p) => () => { if (win) win.loadURL(SERVER + p); };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: T.file, submenu: [
      { label: T.home, accelerator: 'CmdOrCtrl+1', click: go('/app/') },
      { label: T.billing, accelerator: 'CmdOrCtrl+2', click: go('/app/#/billing') },
      { type: 'separator' },
      { label: T.site, click: () => shell.openExternal(SERVER + '/') },
      { type: 'separator' },
      { label: T.quit, role: 'quit' }
    ] },
    { label: T.edit, submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: T.view, submenu: [
      { label: T.reload, accelerator: 'F5', click: () => { if (win) { const u = win.webContents.getURL(); if (u.startsWith('file:')) openStart(); else win.webContents.reload(); } } },
      { type: 'separator' },
      { label: T.zoomIn, role: 'zoomIn' }, { label: T.zoomOut, role: 'zoomOut' }, { label: T.zoomReset, role: 'resetZoom' },
      { type: 'separator' }, { label: T.full, role: 'togglefullscreen' }
    ] },
    { label: T.help, submenu: [
      { label: T.support, click: () => shell.openExternal('mailto:support@buykurs.ru') },
      { label: T.about, click: () => dialog.showMessageBox(win, { type: 'info', title: 'AI YT Studio', message: 'AI YT Studio', detail: T.aboutText + app.getVersion() + '\n' + SERVER }) }
    ] }
  ]));
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  nativeTheme.themeSource = 'light';
  // Google не пускает вход из «встроенных браузеров», поэтому окно представляется обычным Chrome.
  const ua = session.defaultSession.getUserAgent().replace(/(Gecko\))\s.*?(Chrome\/)/, '$1 $2').replace(/\s?Electron\/[\d.]+/, '');
  session.defaultSession.setUserAgent(ua);
  // Разрешения (камера, геолокация и т. п.) сервису пока не нужны — запрещаем всё, кроме буфера обмена.
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'clipboard-sanitized-write'));
  buildMenu();
  createWindow();
});
app.on('window-all-closed', () => app.quit());
// Запрещаем любые новые окна/вебвью, кроме нашего.
app.on('web-contents-created', (e, wc) => { wc.on('will-attach-webview', (ev) => ev.preventDefault()); });
