const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

let keytar;
try { keytar = require('keytar'); } catch { keytar = null; }

const KEYTAR_SERVICE = 'it.timesheet.backup';
const KEYTAR_ACCOUNT = 'encryption-passphrase';
const ENC_VERSION = 1;

// AES-256-GCM encryption helpers
function encryptJSON(plaintext, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv   = crypto.randomBytes(12);
  const key  = crypto.pbkdf2Sync(passphrase, salt, 100000, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const payload = { v: ENC_VERSION, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: authTag.toString('base64'), data: encrypted.toString('base64') };
  return JSON.stringify(payload);
}

function decryptJSON(ciphertext, passphrase) {
  const payload = JSON.parse(ciphertext);
  if (payload.v !== ENC_VERSION) throw new Error('Versione cifratura non supportata');
  const salt = Buffer.from(payload.salt, 'base64');
  const iv   = Buffer.from(payload.iv,   'base64');
  const tag  = Buffer.from(payload.tag,  'base64');
  const data = Buffer.from(payload.data, 'base64');
  const key  = crypto.pbkdf2Sync(passphrase, salt, 100000, 32, 'sha256');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data) + decipher.final('utf8');
}

async function getPassphrase() {
  if (keytar) {
    const stored = await keytar.getPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT);
    return stored;
  }
  return null;
}

async function setPassphrase(pw) {
  if (keytar) await keytar.setPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT, pw);
}

// Load DB module with SQLite fallback
let AppDB;
try {
  AppDB = require('./db');
  AppDB._type = 'sqlite';
} catch (e) {
  console.warn('[main] better-sqlite3 unavailable, using JSON fallback:', e.message);
  AppDB = require('./db-json');
  AppDB._type = 'json';
}

let win;
let db;

function iCloudPath() {
  const p = path.join(os.homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs');
  return fs.existsSync(p) ? p : null;
}

function dropboxPath() {
  const p = path.join(os.homedir(), 'Dropbox');
  return fs.existsSync(p) ? p : null;
}

function googleDrivePath() {
  // macOS: ~/Library/CloudStorage/GoogleDrive-*/My Drive
  // Windows: ~/Google Drive  or  ~/Google Drive/My Drive
  if (process.platform === 'darwin') {
    const cs = path.join(os.homedir(), 'Library', 'CloudStorage');
    if (fs.existsSync(cs)) {
      const gd = fs.readdirSync(cs).find(d => d.startsWith('GoogleDrive-'));
      if (gd) {
        const candidate = path.join(cs, gd, 'My Drive');
        return fs.existsSync(candidate) ? candidate : path.join(cs, gd);
      }
    }
  } else if (process.platform === 'win32') {
    for (const name of ['Google Drive', 'Google Drive/My Drive', 'GoogleDrive']) {
      const p = path.join(os.homedir(), name);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function oneDrivePath() {
  if (process.platform === 'darwin') {
    const cs = path.join(os.homedir(), 'Library', 'CloudStorage');
    if (fs.existsSync(cs)) {
      const od = fs.readdirSync(cs).find(d => d.startsWith('OneDrive'));
      if (od) return path.join(cs, od);
    }
    const legacy = path.join(os.homedir(), 'OneDrive');
    if (fs.existsSync(legacy)) return legacy;
  } else if (process.platform === 'win32') {
    const p = path.join(os.homedir(), 'OneDrive');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function createWindow() {
  const userData = app.getPath('userData');
  const dbPath = path.join(userData, 'timesheet.db');
  db = new AppDB(dbPath);

  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, '../renderer/index.html'));

  // ── Window controls ──────────────────────────────────────────────
  ipcMain.on('win-close', () => win.close());
  ipcMain.on('win-minimize', () => win.minimize());
  ipcMain.on('win-maximize', () => win.isMaximized() ? win.unmaximize() : win.maximize());
  ipcMain.on('app:version', (event) => { event.returnValue = app.getVersion(); });

  // ── DB operations ────────────────────────────────────────────────
  ipcMain.handle('db:loadAll', () => db.loadAll());

  ipcMain.handle('db:saveCollection', (_, { key, data }) => {
    db.saveCollection(key, data);
    return true;
  });

  ipcMain.handle('db:saveKV', (_, { key, value }) => {
    db.saveKV(key, value);
    return true;
  });

  ipcMain.handle('db:getInfo', () => {
    const icloud = iCloudPath();
    const dropbox = dropboxPath();
    return { dbPath, dbType: AppDB._type || 'unknown', stats: db.stats(), icloud, dropbox };
  });

  // ── Export / Import ──────────────────────────────────────────────
  ipcMain.handle('db:exportJSON', () => db.exportJSON());

  ipcMain.handle('db:importJSON', (_, json) => {
    db.importJSON(json);
    return true;
  });

  ipcMain.handle('backup:chooseExportPath', async (_, filename) => {
    const result = await dialog.showSaveDialog(win, {
      defaultPath: path.join(os.homedir(), 'Desktop', filename || 'timesheet-backup.json'),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    return result.canceled ? null : result.filePath;
  });

  ipcMain.handle('backup:exportTo', (_, filePath) => {
    fs.writeFileSync(filePath, db.exportJSON(), 'utf-8');
    return true;
  });

  ipcMain.handle('backup:chooseImportPath', async () => {
    const result = await dialog.showOpenDialog(win, {
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('backup:importFrom', (_, filePath) => {
    const json = fs.readFileSync(filePath, 'utf-8');
    db.importJSON(json);
    return true;
  });

  // ── iCloud ───────────────────────────────────────────────────────
  ipcMain.handle('backup:checkCloud', () => {
    const paths = { icloud: iCloudPath(), dropbox: dropboxPath(), googledrive: googleDrivePath(), onedrive: oneDrivePath() };
    return Object.fromEntries(Object.entries(paths).map(([k, p]) => [k, { available: !!p, path: p }]));
  });

  ipcMain.handle('backup:backupToCloud', async (_, { type, encrypt }) => {
    const baseMap = { icloud: iCloudPath, dropbox: dropboxPath, googledrive: googleDrivePath, onedrive: oneDrivePath };
    const base = (baseMap[type] || (() => null))();
    if (!base) throw new Error(`${type} non disponibile`);
    const folder = path.join(base, 'Parcella');
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    const jsonData = db.exportJSON();
    let content, ext;
    if (encrypt) {
      let pw = await getPassphrase();
      if (!pw) throw new Error('Nessuna passphrase impostata. Configurala in Impostazioni → Dati & Backup.');
      content = encryptJSON(jsonData, pw);
      ext = '.tsenc';
    } else {
      content = jsonData;
      ext = '.json';
    }
    const dest = path.join(folder, `timesheet-backup-${ts}${ext}`);
    fs.writeFileSync(dest, content, 'utf-8');
    return { dest, folder };
  });

  // Passphrase management
  ipcMain.handle('crypto:getPassphrase', async () => !!(await getPassphrase()));
  ipcMain.handle('crypto:setPassphrase', async (_, pw) => { await setPassphrase(pw); return true; });
  ipcMain.handle('crypto:removePassphrase', async () => {
    if (keytar) await keytar.deletePassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT);
    return true;
  });

  // Encrypted import
  ipcMain.handle('backup:importEncrypted', async (_, filePath) => {
    const content = fs.readFileSync(filePath, 'utf-8');
    const pw = await getPassphrase();
    if (!pw) throw new Error('Nessuna passphrase. Configurala prima di importare.');
    const json = decryptJSON(content, pw);
    db.importJSON(json);
    return true;
  });

  ipcMain.handle('backup:openFolder', (_, folderPath) => {
    shell.openPath(folderPath);
    return true;
  });

  // ── Auto-backup on close ─────────────────────────────────────────
  win.on('close', () => {
    try {
      const autoBackupDir = path.join(userData, 'auto-backups');
      if (!fs.existsSync(autoBackupDir)) fs.mkdirSync(autoBackupDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      fs.writeFileSync(path.join(autoBackupDir, `auto-${ts}.json`), db.exportJSON(), 'utf-8');
      // Keep only last 10 auto-backups
      const files = fs.readdirSync(autoBackupDir).filter(f => f.startsWith('auto-')).sort();
      if (files.length > 10) {
        files.slice(0, files.length - 10).forEach(f => fs.unlinkSync(path.join(autoBackupDir, f)));
      }
    } catch {}
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (db) db.close();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

