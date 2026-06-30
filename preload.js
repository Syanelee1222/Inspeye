const { contextBridge, ipcRenderer } = require('electron');

// ─── Queue for onShow callbacks ───
let showCallbacks = [];
let contentUpdateCallbacks = [];
let themeChangeCallbacks = [];
let skinChangeCallbacks = [];
let unreadChangeCallbacks = [];
let categoriesChangedCallbacks = [];
let favoritesUpdatedCallbacks = [];

// ─── Flush queue when IPC arrives ───
ipcRenderer.on('panel:show', () => {
  showCallbacks.forEach(cb => {
    try { cb(); } catch (e) {}
  });
});

ipcRenderer.on('content:updated', () => {
  contentUpdateCallbacks.forEach(cb => {
    try { cb(); } catch (e) {}
  });
});

ipcRenderer.on('theme:changed', (e, theme) => {
  themeChangeCallbacks.forEach(cb => {
    try { cb(theme); } catch (e) {}
  });
});

ipcRenderer.on('pet:skin-changed', (e, skin) => {
  skinChangeCallbacks.forEach(cb => {
    try { cb(skin); } catch (e) {}
  });
});

ipcRenderer.on('pet:unread-changed', (e, count) => {
  unreadChangeCallbacks.forEach(cb => {
    try { cb(count); } catch (e) {}
  });
});

ipcRenderer.on('panel:categories-updated', () => {
  categoriesChangedCallbacks.forEach(cb => {
    try { cb(); } catch (e) {}
  });
});

ipcRenderer.on('favorites:updated', (e, favorites) => {
  favoritesUpdatedCallbacks.forEach(cb => {
    try { cb(favorites); } catch (e) {}
  });
});

// ─── Expose API ───
contextBridge.exposeInMainWorld('inspieye', {
  pet: {
    notifyDragStart: () => ipcRenderer.send('pet:drag-start'),
    notifyDragEnd: ()   => ipcRenderer.send('pet:drag-end'),
    notifyRightClick: () => ipcRenderer.send('pet:right-click'),
    onSkinChanged: (cb) => { skinChangeCallbacks.push(cb); },
    onUnreadChanged: (cb) => { unreadChangeCallbacks.push(cb); },
    // Called by pet.js when cursor enters/leaves pet window
    notifyHoverEnter: () => ipcRenderer.send('pet:hover-enter'),
    notifyHoverLeave: () => ipcRenderer.send('pet:hover-leave'),
  },

  panel: {
    // Called by panel.js when cursor enters/leaves panel window
    notifyHoverEnter: () => ipcRenderer.send('panel:hover-enter'),
    notifyHoverLeave: () => ipcRenderer.send('panel:hover-leave'),
    openUrl: (url) => ipcRenderer.send('panel:open-url', url),
    openSettings: () => ipcRenderer.send('panel:open-settings'),
    openImageFolder: () => ipcRenderer.invoke('panel:open-image-folder'),
    onShow: (cb) => { showCallbacks.push(cb); },
    onContentUpdated: (cb) => { contentUpdateCallbacks.push(cb); },
    onCategoriesChanged: (cb) => { categoriesChangedCallbacks.push(cb); },
  },

  data: {
    getItems:         (opts) => ipcRenderer.invoke('data:get-items', opts),
    getFavorites:     ()      => ipcRenderer.invoke('data:get-favorites'),
    toggleFavorite:   (item) => ipcRenderer.invoke('data:toggle-favorite', item),
    clearFavorites:   ()      => ipcRenderer.invoke('data:clear-favorites'),
    markRead:         (guids) => ipcRenderer.invoke('data:mark-read', guids),
    markAllRead:      ()      => ipcRenderer.invoke('data:mark-all-read'),
    getUnreadCount:   ()      => ipcRenderer.invoke('data:get-unread-count'),
    getDownloadedGuids:(items) => ipcRenderer.invoke('data:get-downloaded-guids', items),
    onFavoritesUpdated: (cb)  => { favoritesUpdatedCallbacks.push(cb); },
  },

  settings: {
    get:              ()      => ipcRenderer.invoke('settings:get'),
    set:              (k, v) => ipcRenderer.invoke('settings:set', k, v),
    triggerFetch:      ()      => ipcRenderer.invoke('settings:trigger-fetch'),
    selectCacheDir:   ()      => ipcRenderer.invoke('settings:select-cache-dir'),
    close:            ()      => ipcRenderer.invoke('settings:close'),
    minimize:         ()      => ipcRenderer.invoke('settings:minimize'),
    onThemeChanged:   (cb)    => { themeChangeCallbacks.push(cb); },
  }
});
