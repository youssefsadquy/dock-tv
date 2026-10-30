const { contextBridge, ipcRenderer } = require('electron');

// The UI gets exactly these calls and nothing else from the main process.
const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
const on = (channel, cb) => {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('dock', {
  appInfo: invoke('app:info'),
  appMeta: invoke('app:meta'),
  tv: {
    pc: invoke('tv:pc'),
    scan: invoke('tv:scan'),
    probe: invoke('tv:probe'),
    saved: invoke('tv:saved'),
    select: invoke('tv:select'),
    forget: invoke('tv:forget'),
    backup: invoke('tv:backup'),
  },
  steps: { list: invoke('steps:list'), record: invoke('steps:record'), reset: invoke('steps:reset') },
  layout: { get: invoke('layout:get'), save: invoke('layout:save'), reset: invoke('layout:reset') },
  weather: { find: invoke('weather:find') },
  bus: { find: invoke('bus:find') },
  spotify: { status: invoke('spotify:status'), login: invoke('spotify:login'), forget: invoke('spotify:forget'), uri: invoke('spotify:uri') },
  wallpapers: { list: invoke('wp:list'), fetch: invoke('wp:fetch'), pickFolder: invoke('wp:pick'), clear: invoke('wp:clear') },
  apps: { fromTv: invoke('apps:fromTv') },
  install: { preflight: invoke('install:preflight'), run: invoke('install:run'), pickSdk: invoke('install:pickSdk') },
  restore: { list: invoke('restore:list'), done: invoke('restore:done'), uninstall: invoke('restore:uninstall'), devOff: invoke('restore:devOff') },
  open: { folder: invoke('open:folder'), link: invoke('open:link') },
  on,
});
