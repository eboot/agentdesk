'use strict';
// AgentDesk — main process.
// Tugasnya: bikin window, simpan config & riwayat chat ke userData,
// dan menjalankan shell command (hanya saat user menyetujui lewat kartu "Action needed").

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');

let win = null;

function dataFile(name) {
  return path.join(app.getPath('userData'), name);
}

function readJSON(name, fallback) {
  try {
    const p = dataFile(name);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) { /* abaikan, pakai fallback */ }
  return fallback;
}

function writeJSON(name, data) {
  const p = dataFile(name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

function createWindow() {
  win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1a1a1a',
    title: 'AgentDesk',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('closed', () => { win = null; });
}

// --- IPC: penyimpanan lokal ---
ipcMain.handle('store:get', (_e, name, fallback) => readJSON(name, fallback));
ipcMain.handle('store:set', (_e, name, data) => { writeJSON(name, data); return true; });

// --- IPC: jalankan shell command (dipanggil hanya setelah user klik "Jalankan") ---
ipcMain.handle('shell:run', (_e, command) => {
  return new Promise((resolve) => {
    if (!command || typeof command !== 'string' || !command.trim()) {
      resolve({ ok: false, error: 'empty command' });
      return;
    }
    exec(command, { timeout: 60000, cwd: os.homedir(), maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          code: error && typeof error.code === 'number' ? error.code : 0,
          stdout: String(stdout || '').slice(0, 8000),
          stderr: String(stderr || '').slice(0, 8000),
          error: error ? String(error.message).slice(0, 500) : null,
        });
      });
  });
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
