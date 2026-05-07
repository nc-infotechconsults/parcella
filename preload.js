const { contextBridge, ipcRenderer } = require('electron');
const { version } = require('./package.json');

contextBridge.exposeInMainWorld('APP_VERSION', version);

// Window controls (existing)
contextBridge.exposeInMainWorld('electronAPI', {
  windowClose:    () => ipcRenderer.send('win-close'),
  windowMinimize: () => ipcRenderer.send('win-minimize'),
  windowMaximize: () => ipcRenderer.send('win-maximize'),
});

// Full server-side API
contextBridge.exposeInMainWorld('api', {
  db: {
    loadAll:        ()           => ipcRenderer.invoke('db:loadAll'),
    saveCollection: (key, data)  => ipcRenderer.invoke('db:saveCollection', { key, data }),
    saveKV:         (key, value) => ipcRenderer.invoke('db:saveKV', { key, value }),
    getInfo:        ()           => ipcRenderer.invoke('db:getInfo'),
    exportJSON:     ()           => ipcRenderer.invoke('db:exportJSON'),
    importJSON:     (json)       => ipcRenderer.invoke('db:importJSON', json),
  },
  backup: {
    chooseExportPath:   (filename) => ipcRenderer.invoke('backup:chooseExportPath', filename),
    exportTo:           (filePath) => ipcRenderer.invoke('backup:exportTo', filePath),
    chooseImportPath:   ()         => ipcRenderer.invoke('backup:chooseImportPath'),
    importFrom:         (filePath) => ipcRenderer.invoke('backup:importFrom', filePath),
    importEncrypted:    (filePath) => ipcRenderer.invoke('backup:importEncrypted', filePath),
    checkCloud:         ()         => ipcRenderer.invoke('backup:checkCloud'),
    backupToCloud:      (opts)     => ipcRenderer.invoke('backup:backupToCloud', opts),
    openFolder:         (p)        => ipcRenderer.invoke('backup:openFolder', p),
  },
  crypto: {
    getPassphrase:    ()    => ipcRenderer.invoke('crypto:getPassphrase'),
    setPassphrase:    (pw)  => ipcRenderer.invoke('crypto:setPassphrase', pw),
    removePassphrase: ()    => ipcRenderer.invoke('crypto:removePassphrase'),
  },
});
