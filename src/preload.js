'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (ch, arg) => ipcRenderer.invoke(ch, arg);
const on = (ch, fn) => {
  const handler = (_e, payload) => fn(payload);
  ipcRenderer.on(ch, handler);
  return () => ipcRenderer.removeListener(ch, handler);
};

contextBridge.exposeInMainWorld('reframe', {
  info: () => invoke('app:info'),
  onGpu: (fn) => on('app:gpu', fn),
  zoom: (z) => invoke('ui:zoom', z),
  titlebar: (colors) => invoke('ui:titlebar', colors),
  pickFolder: (opts) => invoke('dialog:folder', opts),
  pickFile: (opts) => invoke('dialog:file', opts),
  pathForFile: (file) => webUtils.getPathForFile(file),
  inspect: (p) => invoke('fs:inspect', p),
  scan: (root, exclude) => invoke('fs:scan', { root, exclude }),
  defaultDest: (root) => invoke('fs:defaultDest', root),
  freeSpace: (p) => invoke('fs:freeSpace', p),
  readClipboard: () => invoke('clipboard:read'),
  capture: (url) => invoke('capture:open', url),
  onStats: (fn) => on('stats:changed', fn),
  other: {
    list: () => invoke('other:list'),
    open: () => invoke('other:open'),
    import: () => invoke('other:import'),
    remove: (file) => invoke('other:remove', file),
    onChange: (fn) => on('other:changed', fn),
    pictures: (urls, cbz) => invoke('other:pictures', { urls, cbz }),
    onPicturesProgress: (fn) => on('other:picturesProgress', fn),
  },

  presets: () => invoke('presets:list'),
  reloadPresets: () => invoke('presets:reload'),

  getSettings: () => invoke('settings:get'),
  setSettings: (patch) => invoke('settings:set', patch),

  startJob: (spec) => invoke('jobs:start', spec),
  jobs: () => invoke('jobs:list'),
  cancelJob: (id) => invoke('jobs:cancel', id),
  skipItem: (jobId, itemId) => invoke('jobs:skip', { jobId, itemId }),
  retryJob: (id) => invoke('jobs:retry', id),
  itemLog: (jobId, itemId) => invoke('jobs:log', { jobId, itemId }),
  clearJobs: () => invoke('jobs:clear'),
  speedPlan: (presetName) => invoke('jobs:speed', { presetName }),
  onJob: (fn) => on('jobs:update', fn),

  tools: {
    status: () => invoke('tools:status'),
    install: (name) => invoke('tools:install', name),
    onProgress: (fn) => on('tools:progress', fn),
  },
  dl: {
    inspect: (url, cookiesBrowser) => invoke('dl:inspect', { url, cookiesBrowser }),
    start: (opts) => invoke('dl:start', opts),
  },
  src: {
    drives: () => invoke('src:drives'),
    cloud: () => invoke('src:cloud'),
    accounts: () => invoke('src:accounts'),
    plexStart: () => invoke('plex:startSignIn'),
    plexCheck: (pinId) => invoke('plex:checkSignIn', pinId),
    plexManual: (url, token) => invoke('plex:connectManual', { url, token }),
    plexRefresh: () => invoke('plex:refresh'),
    jellyfinSignIn: (url, username, password) => invoke('jellyfin:signIn', { url, username, password }),
    forget: (type, index) => invoke('src:forget', { type, index }),
    libraries: (src, server) => invoke('src:libraries', { src, server }),
    items: (src, server, lib) => invoke('src:items', { src, server, lib }),
    download: (opts) => invoke('src:download', opts),
  },
  pcscan: {
    roots: () => invoke('pcscan:roots'),
    start: (roots) => invoke('pcscan:start', roots),
    stop: () => invoke('pcscan:stop'),
    state: () => invoke('pcscan:state'),
    onProgress: (fn) => on('pcscan:progress', fn),
  },

  open: (p) => invoke('shell:open', p),
  reveal: (p) => invoke('shell:reveal', p),
  external: (url) => invoke('shell:external', url),

  library: {
    get: () => invoke('library:get'),
    createCategory: (data) => invoke('library:createCategory', data),
    updateCategory: (id, patch) => invoke('library:updateCategory', { id, patch }),
    deleteCategory: (id) => invoke('library:deleteCategory', id),
    assign: (videoIds, categoryId, move) => invoke('library:assign', { videoIds, categoryId, move }),
    unassign: (videoIds, categoryId) => invoke('library:unassign', { videoIds, categoryId }),
    renameVideo: (id, title) => invoke('library:renameVideo', { id, title }),
    favourite: (ids, value) => invoke('library:favourite', { ids, value }),
    remove: (ids) => invoke('library:remove', ids),
    saveThumb: (id, dataUrl, meta) => invoke('library:saveThumb', { id, dataUrl, meta }),
    probe: (id) => invoke('library:probe', id),
    missing: () => invoke('library:missing'),
    clearThumbs: () => invoke('library:clearThumbs'),
    reset: () => invoke('library:reset'),
    forgetScanned: () => invoke('library:forgetScanned'),
    importFolder: (root, autoCategorize) => invoke('library:import', { root, autoCategorize }),
    onChange: (fn) => on('library:changed', fn),
    onPatch: (fn) => on('library:patch', fn),
    onAdded: (fn) => on('library:added', fn),
  },
});
