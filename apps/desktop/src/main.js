// NukeDrive ana makine uygulaması: sunucuyu kendi içinde çalıştırır, arayüzü pencerede gösterir, tepside bekler.
// Google Drive tarzı: Hızlı Transfer tepsi penceresi (quick.html), Windows sağ tık menüsü ve başlangıçta açma desteklenir.
const {
  app, BrowserWindow, Menu, Tray, shell, dialog, nativeImage,
  ipcMain, safeStorage, screen, clipboard, Notification
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');

app.setName('NukeDrive'); // veri: %APPDATA%\NukeDrive (paket adı @nukedrive/desktop yerine)
if (!app.requestSingleInstanceLock()) app.quit();

const userData = app.getPath('userData');
const configPath = path.join(userData, 'config.json');
const dataDir = path.join(userData, 'data');
const iconPath = path.join(__dirname, '../build-res/icon.png');
const apkPath = app.isPackaged ? path.join(process.resourcesPath, 'NukeDrive.apk') : path.join(__dirname, '../../../NukeDrive.apk');
const cloudflaredPath = path.join(userData, 'bin', 'cloudflared.exe');
const CLOUDFLARED_URL = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';

let cfg;
let win = null;
let settingsWin = null;
let quickWin = null;
let tray = null;
let quitting = false;
let serverReady = false;
let localUrl = '';
let quickPinned = false;
let quickDialogOpen = false;
let pendingUploadPaths = [];

// ---------- Ayarlar ----------
function loadConfig() {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
  // İlk açılışta kalıcı rastgele anahtar üret; değişirse tüm oturumlar kapanır
  return {
    port: 4000, host: '0.0.0.0', allowRegister: false, maxUploadMb: 102400, setupDone: false,
    notifyOnUpload: true, authTokenEnc: '', authUser: null,
    jwtSecret: crypto.randomBytes(48).toString('hex'), ...c,
    tunnel: { mode: 'off', tokenEnc: '', publicUrl: '', ...(c.tunnel || {}) }
  };
}
function saveConfig() {
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
}
// Hassas veriler Windows kullanıcı hesabına bağlı şifreleme ile saklanır
const encrypt = (s) => s && safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(s).toString('base64') : s;
const decrypt = (s) => { try { return s && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(s, 'base64')) : s; } catch { return ''; } };

function lanUrls() {
  if (cfg.host === '127.0.0.1') return [];
  return Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => `http://${i.address}:${cfg.port}`);
}

// ---------- Windows Sağ Tık Menüsü (Explorer Context Menu) ----------
const CTX_KEYS = [
  'HKCU\\Software\\Classes\\*\\shell\\NukeDriveUpload',
  'HKCU\\Software\\Classes\\Directory\\shell\\NukeDriveUpload',
  'HKCU\\Software\\Classes\\Directory\\Background\\shell\\NukeDriveOpen'
];

function isContextMenuEnabled() {
  if (process.platform !== 'win32') return false;
  try {
    execFileSync('reg', ['query', CTX_KEYS[0]], { stdio: 'ignore', windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function getAppLaunchPrefix() {
  if (app.isPackaged) return `"${process.execPath}"`;
  return `"${process.execPath}" "${app.getAppPath()}"`;
}

function setContextMenuEnabled(enable) {
  if (process.platform !== 'win32') return false;
  const regAdd = (key, name, val) => {
    const args = ['add', key];
    if (name) args.push('/v', name); else args.push('/ve');
    args.push('/t', 'REG_SZ', '/d', val, '/f');
    execFileSync('reg', args, { stdio: 'ignore', windowsHide: true });
  };
  const regDel = (key) => {
    try { execFileSync('reg', ['delete', key, '/f'], { stdio: 'ignore', windowsHide: true }); } catch {}
  };

  if (!enable) {
    CTX_KEYS.forEach(regDel);
    buildTray();
    pushState();
    pushQuickState();
    return false;
  }

  const prefix = getAppLaunchPrefix();
  const iconVal = app.isPackaged ? `${process.execPath},0` : iconPath;

  // Dosyalara sağ tık -> NukeDrive'a Yükle
  regAdd(CTX_KEYS[0], null, "NukeDrive'a Yükle");
  regAdd(CTX_KEYS[0], 'Icon', iconVal);
  regAdd(`${CTX_KEYS[0]}\\command`, null, `${prefix} --upload "%1"`);

  // Klasörlere sağ tık -> NukeDrive'a Yükle
  regAdd(CTX_KEYS[1], null, "NukeDrive'a Yükle");
  regAdd(CTX_KEYS[1], 'Icon', iconVal);
  regAdd(`${CTX_KEYS[1]}\\command`, null, `${prefix} --upload "%1"`);

  // Klasör boşluğuna sağ tık -> NukeDrive'ı Aç
  regAdd(CTX_KEYS[2], null, "NukeDrive'ı Aç");
  regAdd(CTX_KEYS[2], 'Icon', iconVal);
  regAdd(`${CTX_KEYS[2]}\\command`, null, `${prefix}`);

  buildTray();
  pushState();
  pushQuickState();
  return true;
}

// ---------- Cloudflare tüneli ----------
let tunnelProc = null;
const tunnel = { status: 'off', url: '', log: [] };

function setTunnel(patch) {
  Object.assign(tunnel, patch);
  // Paylaşım linkleri bu adresle üretilir
  if (tunnel.url) process.env.PUBLIC_URL = tunnel.url; else delete process.env.PUBLIC_URL;
  pushState();
  pushQuickState();
}
function tlog(line) {
  tunnel.log.push(line);
  if (tunnel.log.length > 200) tunnel.log.shift();
}

async function ensureCloudflared() {
  if (fs.existsSync(cloudflaredPath)) return cloudflaredPath;
  const repoBin = path.join(__dirname, '../../server/data/bin/cloudflared.exe');
  if (fs.existsSync(repoBin)) return repoBin;
  setTunnel({ status: 'downloading' });
  tlog('cloudflared indiriliyor (Cloudflare resmi GitHub sürümü)...');
  const res = await fetch(CLOUDFLARED_URL);
  if (!res.ok) throw new Error(`cloudflared indirilemedi: HTTP ${res.status}`);
  fs.mkdirSync(path.dirname(cloudflaredPath), { recursive: true });
  fs.writeFileSync(cloudflaredPath + '.part', Buffer.from(await res.arrayBuffer()));
  fs.renameSync(cloudflaredPath + '.part', cloudflaredPath);
  tlog('cloudflared indirildi.');
  return cloudflaredPath;
}

function stopTunnel() {
  const p = tunnelProc;
  tunnelProc = null;
  if (p) p.kill();
}

async function startTunnel() {
  stopTunnel();
  const { mode, publicUrl } = cfg.tunnel;
  if (mode === 'off') return setTunnel({ status: 'off', url: '' });
  try {
    const exe = await ensureCloudflared();
    const env = { ...process.env };
    const args = ['tunnel', '--no-autoupdate'];
    if (mode === 'quick') args.push('--url', localUrl);
    else { args.push('run'); env.TUNNEL_TOKEN = decrypt(cfg.tunnel.tokenEnc); } // token komut satırında görünmesin
    setTunnel({ status: 'starting', url: mode === 'token' ? publicUrl : '' });
    const p = spawn(exe, args, { env, windowsHide: true });
    tunnelProc = p;
    const onData = (d) => {
      for (const line of d.toString().split(/\r?\n/)) {
        if (!line.trim()) continue;
        tlog(line);
        const m = mode === 'quick' && line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (m) setTunnel({ url: m[0] });
        if (/Registered tunnel connection/i.test(line)) setTunnel({ status: 'connected' });
      }
      pushState();
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('error', (e) => { tlog(e.message); if (tunnelProc === p) setTunnel({ status: 'error' }); });
    p.on('exit', (code) => {
      if (tunnelProc !== p) return; // bilerek durduruldu
      tunnelProc = null;
      tlog(`cloudflared kapandı (kod ${code}).`);
      setTunnel({ status: 'error' });
    });
  } catch (e) {
    tlog(e.message);
    setTunnel({ status: 'error' });
  }
}

// ---------- Yedekleme ----------
async function backup() {
  const r = await dialog.showOpenDialog(settingsWin, { title: 'Yedeğin kaydedileceği klasör', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled) return null;
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const target = path.join(r.filePaths[0], `NukeDrive-yedek-${stamp}`);
  fs.mkdirSync(target, { recursive: true });
  // Çalışan veritabanının tutarlı kopyası
  const dbFile = path.join(target, 'nukedrive.db');
  require('../build/server.cjs').db.exec(`VACUUM INTO '${dbFile.replace(/'/g, "''")}'`);
  fs.cpSync(path.join(dataDir, 'storage'), path.join(target, 'storage'), { recursive: true });
  return target;
}

// ---------- Hızlı Transfer & Parçalı Yükleme Motoru ----------
const transfers = [];
const transferControllers = new Map();
let cachedFolders = [];
let cachedStats = null;

function notifyUser(title, body) {
  if (!cfg.notifyOnUpload || !Notification.isSupported()) return;
  try {
    new Notification({ title, body, icon: iconPath }).show();
  } catch {}
}

function getAuthToken() {
  return decrypt(cfg.authTokenEnc) || '';
}

async function apiJson(apiPath, opts = {}) {
  const token = getAuthToken();
  const headers = { ...(opts.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body && typeof opts.body === 'string' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${localUrl}${apiPath}`, { ...opts, headers });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    if (res.status === 401) {
      cfg.authTokenEnc = '';
      cfg.authUser = null;
      saveConfig();
      pushQuickState();
    }
    throw new Error(json?.message || res.statusText || 'Sunucu hatası');
  }
  return json;
}

async function refreshQuickMeta() {
  if (!serverReady || !getAuthToken()) return;
  try {
    const [folders, stats] = await Promise.all([
      apiJson('/api/files/folders'),
      apiJson('/api/files/stats')
    ]);
    cachedFolders = Array.isArray(folders) ? folders : [];
    cachedStats = stats || null;
  } catch {}
}

function quickStatePayload() {
  return {
    serverReady,
    loggedIn: !!getAuthToken(),
    user: cfg.authUser,
    tunnelUrl: tunnel.url || '',
    openAtLogin: app.getLoginItemSettings().openAtLogin,
    contextMenuEnabled: isContextMenuEnabled(),
    folders: cachedFolders,
    stats: cachedStats,
    transfers: transfers.slice(0, 30)
  };
}

function pushQuickState() {
  if (quickWin && !quickWin.isDestroyed()) {
    quickWin.webContents.send('quick-state', quickStatePayload());
  }
}

async function uploadSingleFile(filePath, parentId) {
  const stat = fs.statSync(filePath);
  const name = path.basename(filePath);
  const totalBytes = stat.size;
  const id = crypto.randomUUID();
  const controller = new AbortController();
  transferControllers.set(id, controller);

  const tx = {
    id,
    name,
    totalBytes,
    loadedBytes: 0,
    progress: 0,
    speedBps: 0,
    status: 'uploading',
    fileId: null,
    error: ''
  };
  transfers.unshift(tx);
  if (transfers.length > 40) transfers.pop();
  pushQuickState();

  const startTime = Date.now();
  let uploadId = '';

  try {
    const initRes = await apiJson('/api/files/upload/init', {
      method: 'POST',
      body: JSON.stringify({ name, size: totalBytes, mime: 'application/octet-stream', parentId: parentId || null }),
      signal: controller.signal
    });
    uploadId = initRes.uploadId;
    const chunkSize = initRes.chunkSize || 4 * 1024 * 1024;
    const totalChunks = Math.max(1, Math.ceil(totalBytes / chunkSize));
    const token = getAuthToken();

    const fdHandle = fs.openSync(filePath, 'r');
    try {
      for (let i = 0; i < totalChunks; i++) {
        if (controller.signal.aborted) throw new Error('Yükleme iptal edildi');
        const start = i * chunkSize;
        const len = Math.min(chunkSize, totalBytes - start);
        const buf = Buffer.allocUnsafe(len);
        let bytesRead = 0;
        while (bytesRead < len) {
          const r = fs.readSync(fdHandle, buf, bytesRead, len - bytesRead, start + bytesRead);
          if (r === 0) break;
          bytesRead += r;
        }
        const chunkBuf = bytesRead === len ? buf : buf.subarray(0, bytesRead);

        let attempt = 0;
        while (true) {
          try {
            const fd = new FormData();
            fd.append('chunk', new Blob([chunkBuf]), `chunk-${i}`);
            const res = await fetch(`${localUrl}/api/files/upload/chunk?uploadId=${encodeURIComponent(uploadId)}&offset=${start}`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}` },
              body: fd,
              signal: controller.signal
            });
            if (!res.ok) {
              let msg = res.statusText;
              try { msg = (await res.json()).message || msg; } catch {}
              throw new Error(msg || 'Parça yüklenemedi');
            }
            break;
          } catch (err) {
            attempt++;
            if (controller.signal.aborted || attempt >= 3) throw err;
            await new Promise(r => setTimeout(r, 1000 * attempt));
          }
        }

        const loaded = start + bytesRead;
        const elapsed = Math.max(0.1, (Date.now() - startTime) / 1000);
        tx.loadedBytes = loaded;
        tx.progress = totalBytes > 0 ? Math.min(99.9, (loaded / totalBytes) * 100) : 100;
        tx.speedBps = Math.round(loaded / elapsed);
        pushQuickState();
      }
    } finally {
      fs.closeSync(fdHandle);
    }

    const done = await apiJson('/api/files/upload/complete', {
      method: 'POST',
      body: JSON.stringify({ uploadId, name, mime: 'application/octet-stream', parentId: parentId || null, onConflict: 'rename' }),
      signal: controller.signal
    });

    tx.status = 'done';
    tx.progress = 100;
    tx.loadedBytes = totalBytes;
    tx.fileId = done.id;
    pushQuickState();
    await refreshQuickMeta();
    pushQuickState();
    notifyUser('NukeDrive — Aktarım Tamamlandı', `${name} başarıyla yüklendi.`);
  } catch (err) {
    if (uploadId) {
      apiJson(`/api/files/upload/${encodeURIComponent(uploadId)}`, { method: 'DELETE' }).catch(() => {});
    }
    tx.status = controller.signal.aborted ? 'cancelled' : 'error';
    tx.error = err.message || 'Yüklenemedi';
    pushQuickState();
    if (!controller.signal.aborted) {
      notifyUser('NukeDrive — Yükleme Hatası', `${name}: ${tx.error}`);
    }
  } finally {
    transferControllers.delete(id);
  }
}

async function uploadPathRecursive(targetPath, parentId) {
  if (!fs.existsSync(targetPath)) return;
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    await uploadSingleFile(targetPath, parentId);
    return;
  }
  if (stat.isDirectory()) {
    const folderName = path.basename(targetPath);
    const folder = await apiJson('/api/files/folder', {
      method: 'POST',
      body: JSON.stringify({ name: folderName, parentId: parentId || null, reuseExisting: true, onConflict: 'reuse' })
    });
    const entries = fs.readdirSync(targetPath, { withFileTypes: true });
    for (const ent of entries) {
      await uploadPathRecursive(path.join(targetPath, ent.name), folder.id);
    }
  }
}

async function enqueuePaths(paths, parentId = null) {
  const valid = (paths || []).filter(p => p && fs.existsSync(p));
  if (!valid.length) return;

  if (!getAuthToken()) {
    pendingUploadPaths.push(...valid);
    showQuick();
    return;
  }

  showQuick();
  for (const p of valid) {
    try {
      await uploadPathRecursive(p, parentId);
    } catch (e) {
      notifyUser('NukeDrive — Hata', e.message);
    }
  }
}

function extractUploadArgs(argv) {
  const res = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--upload' && argv[i + 1]) {
      res.push(argv[i + 1]);
      i++;
    }
  }
  return res;
}

// ---------- Pencereler ----------
function state() {
  const { jwtSecret, authTokenEnc, tunnel: t, ...rest } = cfg;
  const internetUrl = tunnel.url || '';
  let owner = null;
  try { owner = require('../build/server.cjs').getOwnerAccount?.() || null; } catch {}
  return {
    config: { ...rest, tunnel: { mode: t.mode, publicUrl: t.publicUrl, hasToken: !!t.tokenEnc } },
    owner: owner ? { username: owner.username, name: owner.name } : null,
    localUrl, lanUrls: lanUrls(), internetUrl,
    tunnel: { status: tunnel.status, url: tunnel.url, log: tunnel.log.slice(-40) },
    openAtLogin: app.getLoginItemSettings().openAtLogin,
    contextMenuEnabled: isContextMenuEnabled(),
    dataDir, configPath,
    apk: fs.existsSync(apkPath) ? (internetUrl || lanUrls()[0] || localUrl) + '/NukeDrive.apk' : null,
    version: app.getVersion()
  };
}
function pushState() {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('state', state());
}

function guardLinks(w, base) {
  w.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith(localUrl + '/api/')) w.webContents.downloadURL(target);
    else if (/^https?:/.test(target)) shell.openExternal(target);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e, target) => { if (!target.startsWith(base)) { e.preventDefault(); shell.openExternal(target); } });
}

function showDrive() {
  if (win) { win.show(); win.focus(); return; }
  win = new BrowserWindow({ width: 1280, height: 820, title: 'NukeDrive', icon: iconPath, webPreferences: { contextIsolation: true, sandbox: true } });
  win.setMenu(null);
  win.loadURL(localUrl);
  guardLinks(win, localUrl);
  // Pencere kapanınca sunucu tepside çalışmaya devam eder
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
  win.on('closed', () => { win = null; });
}

function showSettings() {
  if (settingsWin) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 860, height: 900, title: 'NukeDrive — Kurulum ve Ayarlar', icon: iconPath,
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.js') }
  });
  settingsWin.setMenu(null);
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
  guardLinks(settingsWin, 'file://');
  settingsWin.on('closed', () => { settingsWin = null; });
}

function positionQuickWindow() {
  if (!quickWin || quickWin.isDestroyed()) return;
  const wa = screen.getPrimaryDisplay().workArea;
  const [w, h] = quickWin.getSize();
  quickWin.setPosition(Math.round(wa.x + wa.width - w - 12), Math.round(wa.y + wa.height - h - 12));
}

function showQuick() {
  refreshQuickMeta().then(pushQuickState);
  if (quickWin && !quickWin.isDestroyed()) {
    positionQuickWindow();
    quickWin.show();
    quickWin.focus();
    pushQuickState();
    return;
  }
  quickWin = new BrowserWindow({
    width: 390,
    height: 540,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    title: 'NukeDrive — Hızlı Transfer',
    icon: iconPath,
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.js') }
  });
  quickWin.setMenu(null);
  quickWin.loadFile(path.join(__dirname, 'quick.html'));
  guardLinks(quickWin, 'file://');
  quickWin.once('ready-to-show', () => {
    positionQuickWindow();
    quickWin.show();
    quickWin.focus();
    pushQuickState();
  });
  quickWin.on('blur', () => {
    if (!quickPinned && !quickDialogOpen && quickWin && !quickWin.isDestroyed()) {
      quickWin.hide();
    }
  });
  quickWin.on('closed', () => { quickWin = null; });
}

function toggleQuick() {
  if (quickWin && !quickWin.isDestroyed() && quickWin.isVisible()) {
    quickWin.hide();
  } else {
    showQuick();
  }
}

function buildTray() {
  if (!tray) {
    tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }));
    tray.setToolTip('NukeDrive — Kişisel Bulut');
    tray.on('click', toggleQuick);
    tray.on('double-click', showDrive);
  }
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Hızlı Transfer Penceresi', click: showQuick },
    { label: 'NukeDrive\'ı aç', click: showDrive },
    { label: 'Tarayıcıda aç', click: () => shell.openExternal(localUrl) },
    { type: 'separator' },
    { label: 'Dosya Gönder…', click: () => { showQuick(); pickAndUploadFiles(null); } },
    { label: 'Klasör Gönder…', click: () => { showQuick(); pickAndUploadFolder(null); } },
    { type: 'separator' },
    {
      label: 'Windows açılışında başlat',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] });
        buildTray();
        pushState();
        pushQuickState();
      }
    },
    {
      label: 'Sağ tık menüsüne ekle ("NukeDrive\'a Yükle")',
      type: 'checkbox',
      checked: isContextMenuEnabled(),
      click: (item) => setContextMenuEnabled(item.checked)
    },
    { label: 'Kurulum ve ayarlar', click: showSettings },
    { type: 'separator' },
    { label: 'Çıkış (sunucuyu durdur)', click: () => { quitting = true; app.quit(); } }
  ]));
}

async function pickAndUploadFiles(parentId) {
  quickDialogOpen = true;
  try {
    const r = await dialog.showOpenDialog(quickWin || win, {
      title: 'NukeDrive\'a yüklenecek dosyaları seçin',
      properties: ['openFile', 'multiSelections']
    });
    if (!r.canceled && r.filePaths.length) {
      await enqueuePaths(r.filePaths, parentId);
    }
  } finally {
    quickDialogOpen = false;
  }
}

async function pickAndUploadFolder(parentId) {
  quickDialogOpen = true;
  try {
    const r = await dialog.showOpenDialog(quickWin || win, {
      title: 'NukeDrive\'a yüklenecek klasörü seçin',
      properties: ['openDirectory', 'multiSelections']
    });
    if (!r.canceled && r.filePaths.length) {
      await enqueuePaths(r.filePaths, parentId);
    }
  } finally {
    quickDialogOpen = false;
  }
}

// ---------- Ayarlar ve Hızlı Transfer IPC komutları ----------
ipcMain.handle('state', () => state());
ipcMain.handle('save-account', (_e, a) => {
  const srv = require('../build/server.cjs');
  srv.setOwnerAccount(a.username, a.password, a.name);
  return state();
});
ipcMain.handle('save-server', (_e, s) => {
  const port = Number(s.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port 1024-65535 arası olmalı');
  const mb = Number(s.maxUploadMb);
  if (!Number.isFinite(mb) || mb < 1 || mb > 102400) throw new Error('Yükleme sınırı 1-102400 MB arası olmalı');
  Object.assign(cfg, { port, host: s.host === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1', allowRegister: !!s.allowRegister, maxUploadMb: mb });
  saveConfig();
  quitting = true;
  app.relaunch({ args: process.argv.slice(1).filter(a => a !== '--hidden').concat('--settings') });
  app.exit(0);
});
ipcMain.handle('save-tunnel', async (_e, t) => {
  const mode = ['off', 'quick', 'token'].includes(t.mode) ? t.mode : 'off';
  let publicUrl = String(t.publicUrl || '').trim().replace(/\/+$/, '');
  if (publicUrl && !/^https:\/\//.test(publicUrl)) publicUrl = 'https://' + publicUrl.replace(/^http:\/\//, '');
  const token = String(t.token || '').trim();
  if (mode === 'token' && !token && !cfg.tunnel.tokenEnc) throw new Error('Tünel token\'ı gerekli');
  if (mode === 'token' && !publicUrl) throw new Error('Genel adres gerekli (ör. https://drive.alanadiniz.com)');
  cfg.tunnel = { mode, publicUrl, tokenEnc: token ? encrypt(token) : cfg.tunnel.tokenEnc };
  saveConfig();
  startTunnel();
  return state();
});
ipcMain.handle('autostart', (_e, on) => {
  app.setLoginItemSettings({ openAtLogin: !!on, args: ['--hidden'] });
  buildTray();
  pushState();
  pushQuickState();
  return _e.sender === quickWin?.webContents ? quickStatePayload() : state();
});
ipcMain.handle('context-menu', (_e, on) => {
  setContextMenuEnabled(!!on);
  return _e.sender === quickWin?.webContents ? quickStatePayload() : state();
});
ipcMain.handle('set-prefs', (_e, p) => {
  if (typeof p?.notifyOnUpload === 'boolean') cfg.notifyOnUpload = p.notifyOnUpload;
  saveConfig();
  pushState();
  return state();
});
ipcMain.handle('backup', () => backup());
ipcMain.handle('finish-setup', () => { cfg.setupDone = true; saveConfig(); showDrive(); });
ipcMain.handle('open', (_e, what) => {
  if (what === 'drive') return showDrive();
  if (what === 'settings') return showSettings();
  if (what === 'quick') return showQuick();
  if (what === 'data') return shell.openPath(dataDir);
  const urls = { browser: localUrl, cloudflare: 'https://one.dash.cloudflare.com/', apk: state().apk };
  if (urls[what]) shell.openExternal(urls[what]);
});

// Hızlı Transfer IPC
ipcMain.handle('quick-state', async () => {
  await refreshQuickMeta();
  return quickStatePayload();
});
ipcMain.handle('quick-login', async (_e, creds) => {
  const res = await fetch(`${localUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: creds.username, username: creds.username, password: creds.password })
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.message || 'Giriş yapılamadı');
  cfg.authTokenEnc = encrypt(j.token);
  cfg.authUser = { username: j.user.username, name: j.user.name };
  saveConfig();
  await refreshQuickMeta();
  pushQuickState();
  if (pendingUploadPaths.length) {
    const todo = pendingUploadPaths.splice(0);
    enqueuePaths(todo, null);
  }
  return quickStatePayload();
});
ipcMain.handle('quick-logout', () => {
  cfg.authTokenEnc = '';
  cfg.authUser = null;
  cachedFolders = [];
  cachedStats = null;
  saveConfig();
  pushQuickState();
  return quickStatePayload();
});
ipcMain.handle('quick-upload-paths', (_e, { paths, parentId }) => {
  enqueuePaths(paths, parentId || null);
  return quickStatePayload();
});
ipcMain.handle('quick-pick-files', (_e, parentId) => pickAndUploadFiles(parentId || null));
ipcMain.handle('quick-pick-folder', (_e, parentId) => pickAndUploadFolder(parentId || null));
ipcMain.handle('quick-cancel-transfer', (_e, id) => {
  const ctrl = transferControllers.get(id);
  if (ctrl) ctrl.abort();
});
ipcMain.handle('quick-clear-transfers', () => {
  for (let i = transfers.length - 1; i >= 0; i--) {
    if (transfers[i].status !== 'uploading') transfers.splice(i, 1);
  }
  pushQuickState();
});
ipcMain.handle('quick-copy-share', async (_e, fileId) => {
  const share = await apiJson(`/api/files/${fileId}/share`, { method: 'POST', body: '{}' });
  const base = tunnel.url || lanUrls()[0] || localUrl;
  const link = `${base}/shared/${share.token}`;
  clipboard.writeText(link);
  const tx = transfers.find(t => t.fileId === fileId);
  if (tx) tx.copied = true;
  pushQuickState();
  return link;
});
ipcMain.handle('quick-hide', () => { if (quickWin && !quickWin.isDestroyed()) quickWin.hide(); });
ipcMain.handle('quick-pin', (_e, p) => { quickPinned = !!p; });

// ---------- Başlangıç ----------
app.on('second-instance', (_event, argv) => {
  const up = extractUploadArgs(argv);
  if (up.length) {
    enqueuePaths(up, null);
  } else {
    showDrive();
  }
});
app.on('window-all-closed', () => {}); // tepside kal
app.on('before-quit', () => { quitting = true; stopTunnel(); });

app.whenReady().then(async () => {
  cfg = loadConfig();
  saveConfig();
  Object.assign(process.env, {
    NODE_ENV: 'production',
    DATA_DIR: dataDir,
    WEB_DIST: app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '../../web/dist'),
    APK_PATH: apkPath,
    PORT: String(cfg.port),
    HOST: cfg.host,
    JWT_SECRET: cfg.jwtSecret,
    ALLOW_REGISTER: String(cfg.allowRegister),
    MAX_UPLOAD_MB: String(cfg.maxUploadMb),
    TRUST_PROXY: 'true'
  });
  localUrl = `http://127.0.0.1:${cfg.port}`;
  try {
    await require('../build/server.cjs').ready;
    serverReady = true;
  } catch (err) {
    dialog.showErrorBox('NukeDrive sunucusu başlatılamadı',
      `${err.message}\n\nPort ${cfg.port} başka bir program tarafından kullanılıyor olabilir. Port'u değiştirmek için: ${configPath}`);
    app.exit(1);
    return;
  }
  buildTray();
  startTunnel();

  const initialUploads = extractUploadArgs(process.argv);
  if (initialUploads.length) {
    enqueuePaths(initialUploads, null);
  } else if (!cfg.setupDone || process.argv.includes('--settings')) {
    showSettings();
  } else if (!process.argv.includes('--hidden')) {
    showDrive();
  }
});
