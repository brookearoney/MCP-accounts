const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mcpAccounts", {
  bootstrap: () => ipcRenderer.invoke("app:bootstrap"),
  scanConnections: () => ipcRenderer.invoke("discovery:scan"),
  saveProfile: (input) => ipcRenderer.invoke("profiles:save", input),
  removeProfile: (id) => ipcRenderer.invoke("profiles:remove", id),
  getConfig: (id) => ipcRenderer.invoke("profiles:config", id),
  exportConfig: (id) => ipcRenderer.invoke("profiles:export", id),
  installHost: (hostId, profileId) => ipcRenderer.invoke("hosts:install", { hostId, profileId }),
  startConnection: (id) => ipcRenderer.invoke("connections:start", id),
  cancelConnection: (id) => ipcRenderer.invoke("connections:cancel", id),
  openPath: (targetPath) => ipcRenderer.invoke("app:openPath", targetPath),
  openExternal: (url) => ipcRenderer.invoke("app:openExternal", url),
  onConnectionEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("connection:event", listener);
    return () => ipcRenderer.removeListener("connection:event", listener);
  },
});
