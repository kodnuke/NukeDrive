// Ayarlar ve Hızlı Transfer pencerelerine yalnızca bu komutlar açılır
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('nd', {
  state: () => ipcRenderer.invoke('state'),
  saveAccount: (a) => ipcRenderer.invoke('save-account', a),
  saveServer: (s) => ipcRenderer.invoke('save-server', s),
  saveTunnel: (t) => ipcRenderer.invoke('save-tunnel', t),
  autostart: (on) => ipcRenderer.invoke('autostart', on),
  contextMenu: (on) => ipcRenderer.invoke('context-menu', on),
  setPrefs: (p) => ipcRenderer.invoke('set-prefs', p),
  backup: () => ipcRenderer.invoke('backup'),
  finishSetup: () => ipcRenderer.invoke('finish-setup'),
  open: (what) => ipcRenderer.invoke('open', what),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),

  // Hızlı Transfer & Masaüstü Oturumu
  quickState: () => ipcRenderer.invoke('quick-state'),
  onQuickState: (cb) => ipcRenderer.on('quick-state', (_e, s) => cb(s)),
  quickLogin: (creds) => ipcRenderer.invoke('quick-login', creds),
  quickLogout: () => ipcRenderer.invoke('quick-logout'),
  quickUploadPaths: (paths, parentId) => ipcRenderer.invoke('quick-upload-paths', { paths, parentId }),
  quickPickFiles: (parentId) => ipcRenderer.invoke('quick-pick-files', parentId),
  quickPickFolder: (parentId) => ipcRenderer.invoke('quick-pick-folder', parentId),
  quickCancelTransfer: (id) => ipcRenderer.invoke('quick-cancel-transfer', id),
  quickClearTransfers: () => ipcRenderer.invoke('quick-clear-transfers'),
  quickCopyShare: (fileId) => ipcRenderer.invoke('quick-copy-share', fileId),
  quickHide: () => ipcRenderer.invoke('quick-hide'),
  quickPin: (pinned) => ipcRenderer.invoke('quick-pin', pinned),
  getFilePath: (file) => webUtils.getPathForFile(file)
});
