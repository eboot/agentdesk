'use strict';
// Jembatan aman antara renderer dan main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  storeGet: (name, fallback) => ipcRenderer.invoke('store:get', name, fallback),
  storeSet: (name, data) => ipcRenderer.invoke('store:set', name, data),
  shellRun: (command) => ipcRenderer.invoke('shell:run', command),
});
