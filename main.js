const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, shell, Notification, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

// ─── Debug log (define early for init errors) ───
// We don't know userData yet, so log to a temp file first
const tempDebugLog = path.join(app.getPath('temp'), 'inspieye-init.log');
function initDebugLog(...args) {
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  const line = `[${new Date().toLocaleTimeString()}] ${msg}\n`;
  process.stdout.write(line);
  try { fs.appendFileSync(tempDebugLog, line); } catch (_) {}
}

// ─── Force userData to D:\inspieye\ (must exist before require('./lib/store')) ───
const preferredDataDir = path.join('D:', 'inspieye');
// Save default userData path BEFORE changing it (for migration)
const defaultUserDataDir = app.getPath('userData');
try {
  if (!fs.existsSync(preferredDataDir)) {
    fs.mkdirSync(preferredDataDir, { recursive: true });
  }
  app.setPath('userData', preferredDataDir);
  initDebugLog('[init] userData set to:', preferredDataDir);
} catch (e) {
  initDebugLog('[init] Cannot use D:\\inspieye, using default userData:', app.getPath('userData'));
}
const actualUserDataDir = app.getPath('userData');

// ─── Windows notification branding (must be set before app.whenReady()) ───
if (process.platform === 'win32') {
  app.setAppUserModelId('InspEye');
  // Create Start Menu shortcut so toast notifications show "InspEye" instead of "Electron"
  try {
    const { execSync } = require('child_process');
    const startMenuDir = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    if (!fs.existsSync(startMenuDir)) fs.mkdirSync(startMenuDir, { recursive: true });
    const shortcutPath = path.join(startMenuDir, 'InspEye.lnk');
    if (!fs.existsSync(shortcutPath)) {
      // Write PS script to temp file to avoid escaping issues
      const psFile = path.join(app.getPath('temp'), 'inspieye-shortcut.ps1');
      fs.writeFileSync(psFile, `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${shortcutPath.replace(/'/g, "''")}');$s.TargetPath='${process.execPath.replace(/'/g, "''")}';$s.Save()`);
      execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psFile}"`, { timeout: 5000 });
      try { fs.unlinkSync(psFile); } catch (_) {}
      debugLog('[init] Created Start Menu shortcut:', shortcutPath);
    }
  } catch (e) {
    debugLog('[init] Start Menu shortcut skipped (non-critical):', e.message);
  }
}
app.setName('InspEye');

// ─── Debug log file (now userData is known) ───
const debugLogFile = path.join(actualUserDataDir, 'inspieye-debug.log');
function debugLog(...args) {
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  const line = `[${new Date().toLocaleTimeString()}] ${msg}\n`;
  process.stdout.write(line);
  try { fs.appendFileSync(debugLogFile, line); } catch (_) {}
}
// Also copy temp log to main debug log
try {
  if (fs.existsSync(tempDebugLog)) {
    const tempContent = fs.readFileSync(tempDebugLog, 'utf-8');
    fs.appendFileSync(debugLogFile, tempContent);
    fs.unlinkSync(tempDebugLog);
  }
} catch (_) {}

debugLog('[init] userData path:', actualUserDataDir);
debugLog('[init] preferredDataDir exists:', fs.existsSync(preferredDataDir));

// ─── Single instance lock (prevent duplicate tray icons) ───
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  debugLog('[init] Another instance is already running, exiting...');
  app.quit();
  process.exit(0);
} else {
  app.on('second-instance', () => {
    // Someone tried to run a second instance, focus our window
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.show();
      if (petWindow.isMinimized()) petWindow.restore();
      petWindow.focus();
    }
  });
}

const { Store } = require('./lib/store');
const { ContentFetcher } = require('./lib/fetcher');

// ─── Global references (prevent GC) ───
let petWindow = null;
let panelWindow = null;
let settingsWindow = null;
let tray = null;
let store = null;
let fetcher = null;

// ─── State ───
let panelVisible = false;
let forceQuit = false;
let panelHideTimer = null;
let isDragging = false;
let lastFetchTime = 0;
let fetchTimer = null;
let scheduledPushChecker = null;
let lastScheduledPushDate = null;

// ─── Window dimensions ───
const PET_SIZE = { width: 120, height: 120 };
const PANEL_SIZE = { width: 520, height: 640 };
const NOTIFY_SIZE = { width: 420, height: 100 };

// ─── Notification state ───
let notifyWindow = null;
let notifyCloseTimer = null;

// ═══════════════════════════════════════════
//  Custom Notification — frameless overlay
// ═══════════════════════════════════════════
function showCustomNotification(title, body, opts = {}) {
  // Close existing notification if any
  closeNotifyWindow();

  const { workArea } = screen.getPrimaryDisplay();

  // Position at the pet — like a speech bubble in front of it
  let x, y;
  if (petWindow && !petWindow.isDestroyed()) {
    const [petX, petY] = petWindow.getPosition();
    x = petX + PET_SIZE.width / 2 - NOTIFY_SIZE.width / 2;
    // Vertically centered on the pet, slightly offset upward
    y = petY + PET_SIZE.height / 2 - NOTIFY_SIZE.height / 2 - 20;
    // Clamp horizontal
    x = Math.max(workArea.x + 10, Math.min(x, workArea.x + workArea.width - NOTIFY_SIZE.width - 10));
    // Clamp vertical
    y = Math.max(workArea.y + 10, Math.min(y, workArea.y + workArea.height - NOTIFY_SIZE.height - 10));
  } else {
    // Fallback: top-right corner
    x = workArea.x + workArea.width - NOTIFY_SIZE.width - 20;
    y = workArea.y + 20;
  }

  notifyWindow = new BrowserWindow({
    width: NOTIFY_SIZE.width,
    height: NOTIFY_SIZE.height,
    x, y,
    transparent: true,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  // Use 'screen-saver' level so it floats above the panel too
  notifyWindow.setAlwaysOnTop(true, 'screen-saver');

  notifyWindow.loadFile(path.join(__dirname, 'src', 'notify', 'index.html'));

  // Inject content once ready
  notifyWindow.webContents.on('did-finish-load', () => {
    const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
    notifyWindow.webContents.executeJavaScript(`
      document.getElementById('titleEl').textContent = '${esc(title)}';
      document.getElementById('bodyEl').textContent = '${esc(body)}';
    `);
  });

  // Mouse enters → dismiss immediately
  notifyWindow.on('mouse-enter', () => {
    closeNotifyWindow();
  });

  // Auto-close after 8 seconds
  notifyCloseTimer = setTimeout(() => {
    closeNotifyWindow();
  }, opts.duration || 2000);

  debugLog('[InspEye] Custom notification shown:', title);
}

function closeNotifyWindow() {
  if (notifyCloseTimer) { clearTimeout(notifyCloseTimer); notifyCloseTimer = null; }
  if (notifyWindow && !notifyWindow.isDestroyed()) {
    notifyWindow.close();
    notifyWindow = null;
  }
}

// ═══════════════════════════════════════════
//  Pet Window — transparent floating character
// ═══════════════════════════════════════════
function createPetWindow() {
  const petBounds = store.get('petPosition');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { workArea } = primaryDisplay;

  petWindow = new BrowserWindow({
    width: PET_SIZE.width,
    height: PET_SIZE.height,
    x: petBounds ? petBounds.x : workArea.width - PET_SIZE.width - 60,
    y: petBounds ? petBounds.y : workArea.height - PET_SIZE.height - 60,
    transparent: true,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  petWindow.loadFile(path.join(__dirname, 'src', 'pet', 'index.html'));
  petWindow.setIgnoreMouseEvents(false);
  petWindow.setMenu(null);

  // ─── Block Windows system menu (WM_CONTEXTMENU = 0x007B) ───
  // This prevents the "大小(S) / 移动(M) / 关闭(C)" system menu
  // which e.preventDefault() in renderer CANNOT block.
  try {
    petWindow.hookWindowMessage(0x007B); // WM_CONTEXTMENU
    petWindow.on('hook-message', (event, msg, wParam, lParam) => {
      if (msg === 0x007B) {
        event.preventDefault();
      }
    });
    debugLog('[InspEye] Windows system menu blocker installed');
  } catch (e) {
    debugLog('[InspEye] Could not hook WM_CONTEXTMENU:', e.message);
  }

  if (process.argv.includes('--dev')) {
    petWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Detect drag via 'move' event (fires during CSS -webkit-app-region: drag)
  let moveDebounce = null;
  petWindow.on('move', () => {
    if (!isDragging) {
      isDragging = true;
      hidePanel(0);
    }
    clearTimeout(moveDebounce);
    moveDebounce = setTimeout(() => {
      isDragging = false;
    }, 200);
  });

  petWindow.on('moved', () => {
    const [x, y] = petWindow.getPosition();
    store.set('petPosition', { x, y });
    repositionPanel();
  });

  // Intercept "close" (from system menu or Alt+F4) → quit the entire app
  petWindow.on('close', (e) => {
    if (!forceQuit) {
      e.preventDefault();
      forceQuit = true;
      debugLog('[InspEye] Pet window close intercepted → quitting app');
      if (panelWindow && !panelWindow.isDestroyed()) {
        panelWindow.destroy();
        panelWindow = null;
      }
      if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.destroy();
        settingsWindow = null;
      }
      closeNotifyWindow();
      app.quit();
    }
  });
}

// ═══════════════════════════════════════════
//  Panel Window — inspiration card grid
// ═══════════════════════════════════════════
function createPanelWindow() {
  panelWindow = new BrowserWindow({
    width: PANEL_SIZE.width,
    height: PANEL_SIZE.height,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  panelWindow.loadFile(path.join(__dirname, 'src', 'panel', 'index.html'));
  panelWindow.setIgnoreMouseEvents(true); // Let clicks pass through by default

  if (process.argv.includes('--dev')) {
    panelWindow.webContents.openDevTools({ mode: 'detach' });
  }

  panelWindow.on('show', () => {
    panelWindow.setIgnoreMouseEvents(false);
    debugLog('Panel window SHOWN');
  });

  // Note: blur event won't fire with focusable: false, so we rely on cursor polling
}

function repositionPanel() {
  if (!petWindow || !panelWindow) return;

  const [petX, petY] = petWindow.getPosition();
  const primaryDisplay = screen.getPrimaryDisplay();
  const { workArea } = primaryDisplay;

  let panelX = petX + PET_SIZE.width / 2 - PANEL_SIZE.width / 2;
  let panelY = petY - PANEL_SIZE.height - 10;

  // If not enough space above, show below
  if (panelY < workArea.y) {
    panelY = petY + PET_SIZE.height + 10;
  }

  // Clamp horizontal position
  panelX = Math.max(workArea.x + 10, Math.min(panelX, workArea.x + workArea.width - PANEL_SIZE.width - 10));

  // Clamp vertical position
  panelY = Math.max(workArea.y + 10, Math.min(panelY, workArea.y + workArea.height - PANEL_SIZE.height - 10));

  panelWindow.setPosition(Math.round(panelX), Math.round(panelY), false);
}

function showPanel() {
  if (!panelWindow || isDragging) return;

  clearTimeout(panelHideTimer);
  repositionPanel();

  if (!panelVisible) {
    panelVisible = true;
    // On Windows, showInactive() alone may not bring the window above a
    // foregrounded fullscreen/maximized app. Re-assert alwaysOnTop to force
    // it above other topmost windows, then show it.
    panelWindow.setAlwaysOnTop(true, 'screen-saver');
    panelWindow.showInactive();
    panelWindow.setIgnoreMouseEvents(false);
    // Always send content refresh when panel becomes visible
    if (contentDirty) {
      debugLog('showPanel(): content is dirty, sending content:updated to panel');
      panelWindow.webContents.send('content:updated');
      contentDirty = false;
    }
    panelWindow.webContents.send('panel:show');
    // Always push current skin so panel CSS variables match the active skin
    const currentSkin = store.get('petSkin') || 'mint';
    panelWindow.webContents.send('pet:skin-changed', currentSkin);
    debugLog('showPanel(): panel is NOW VISIBLE, skin:', currentSkin);
  } else {
    // Panel was already visible but maybe content changed while it was shown
    if (contentDirty) {
      debugLog('showPanel(): refreshing existing visible panel (content dirty)');
      panelWindow.webContents.send('content:updated');
      contentDirty = false;
    }
  }

  // Always update lastHoverTime so the hide timer knows we're hovering
  lastHoverTime = Date.now();
}

function hidePanel(delay = 300) {
  clearTimeout(panelHideTimer);
  panelHideTimer = setTimeout(() => {
    // Re-check cursor position at execution time to avoid race condition
    try {
      if (!panelWindow || !panelVisible) return;

      const cursor = screen.getCursorScreenPoint();
      const petBounds = petWindow.getBounds();
      const stillOverPet = isCursorOverRect(cursor, petBounds);

      let stillOverPanel = false;
      if (panelVisible && panelWindow) {
        const panelBounds = panelWindow.getBounds();
        stillOverPanel = isCursorOverRect(cursor, panelBounds);
      }

      if (stillOverPet || stillOverPanel) {
        debugLog('hidePanel(): cursor came back before delay expired, NOT hiding');
        return;
      }
    } catch (e) { /* ignore */ }

    panelVisible = false;
    panelWindow.hide();
    debugLog('hidePanel(): panel is NOW HIDDEN');
  }, delay);
}

// ═══════════════════════════════════════════
//  Cursor-based hover detection
//  Replaces renderer mouseenter/mouseleave
//  which don't fire under -webkit-app-region: drag
// ═══════════════════════════════════════════
let hoverCheckInterval = null;

function isCursorOverRect(cursor, bounds) {
  // Note: screen.getCursorScreenPoint() and getBounds() should both return DIP (device-independent pixels) in Electron
  // But on Windows with DPI scaling, there can be a mismatch.
  // We use inclusive bounds check with a small padding to be safe.
  const padding = 5; // 5px padding around the bounds
  return cursor.x >= bounds.x - padding && cursor.x <= bounds.x + bounds.width + padding &&
         cursor.y >= bounds.y - padding && cursor.y <= bounds.y + bounds.height + padding;
}

let lastHoverTime = 0;
let contentDirty = false;  // Flag: new content available, panel needs refresh

function startHoverCheck() {
  let tickCount = 0;

  // ── 1. Poll cursor position (fallback for pet window) ──
  hoverCheckInterval = setInterval(() => {
    try {
      tickCount++;
      if (isDragging || !petWindow) return;

      const cursor = screen.getCursorScreenPoint();
      const petBounds = petWindow.getBounds();
      const isOverPet = isCursorOverRect(cursor, petBounds);

      let isOverPanel = false;
      if (panelVisible && panelWindow) {
        const panelBounds = panelWindow.getBounds();
        isOverPanel = isCursorOverRect(cursor, panelBounds);
      }

      if (isOverPet || isOverPanel) {
        lastHoverTime = Date.now();
        if (!panelVisible && isOverPet) {
          debugLog(`SHOW panel (poll: cursor over pet)`);
          showPanel();
        }
      }
    } catch (err) {
      debugLog(`HoverCheck poll ERROR: ${err.message}`);
    }
  }, 100);

  // ── 2. Separate timer to hide panel after 400ms of no hover ──
  setInterval(() => {
    try {
      if (!panelVisible || isDragging || !panelWindow) return;

      const elapsed = Date.now() - lastHoverTime;
      if (elapsed > 400) {
        // Double-check cursor position at hide time (avoids race condition)
        const cursor = screen.getCursorScreenPoint();
        const petBounds = petWindow.getBounds();
        const stillOverPet = isCursorOverRect(cursor, petBounds);

        let stillOverPanel = false;
        if (panelWindow && !panelWindow.isDestroyed()) {
          const panelBounds = panelWindow.getBounds();
          stillOverPanel = isCursorOverRect(cursor, panelBounds);
        }

        if (!stillOverPet && !stillOverPanel) {
          debugLog(`HIDE panel (no hover for ${elapsed}ms, cursor=(${cursor.x},${cursor.y}))`);
          panelVisible = false;
          panelWindow.hide();
        } else {
          lastHoverTime = Date.now(); // cursor came back, reset timer
        }
      }
    } catch (err) {
      debugLog(`HoverCheck hide ERROR: ${err.message}`);
    }
  }, 120);

  debugLog('startHoverCheck: poll + hide timer started');
}

// ═══════════════════════════════════════════
//  Settings Window
// ═══════════════════════════════════════════
function createSettingsWindow() {
  if (settingsWindow) {
    if (settingsWindow.isMinimized()) {
      settingsWindow.restore();
    }
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 720,
    height: 680,
    minWidth: 600,
    minHeight: 500,
    show: false,
    frame: false,
    resizable: true,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  settingsWindow.loadFile(path.join(__dirname, 'src', 'settings', 'index.html'))
    .catch(err => {
      debugLog('[InspEye] ERROR loading settings window:', err);
    });
  settingsWindow.setMenu(null);
  settingsWindow.show();

  settingsWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    debugLog('[InspEye] Settings page failed to load:', errorCode, errorDescription);
  });

  settingsWindow.webContents.on('crashed', (event, killed) => {
    debugLog('[InspEye] Settings page crashed, killed:', killed);
  });

  if (process.argv.includes('--dev')) {
    settingsWindow.webContents.openDevTools({ mode: 'detach' });
  }

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// ═══════════════════════════════════════════
//  System Tray
// ═══════════════════════════════════════════
function createTray() {
  // Load tray icon from assets/tray-icon.png (eye icon for InspEye)
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  let icon;

  try {
    icon = nativeImage.createFromPath(iconPath);
    const size = process.platform === 'win32' ? 16 : 22;
    icon = icon.resize({ width: size, height: size });
    if (icon.isEmpty()) {
      debugLog('[InspEye] Tray icon loaded but isEmpty() — file may be corrupt');
      throw new Error('Icon is empty after load');
    }
    debugLog('[InspEye] Tray icon loaded OK, size:', icon.getSize());
  } catch (e) {
    debugLog('[InspEye] Tray icon load failed, using fallback:', e.message);
    // Fallback: solid blue circle icon (valid 16x16 PNG)
    const fallbackBuf = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAALUlEQVR4nGNgGJTAqOLOf2yYbI1EG0SRAcRqxmnIqAFUMGDg0wExBhHUOCAAABdsOHzbOWAuAAAAAElFTkSuQmCC',
      'base64'
    );
    icon = nativeImage.createFromBuffer(fallbackBuf);
  }

  tray = new Tray(icon);
  updateTrayMenu();

  tray.setToolTip('InspEye - 灵感桌宠');

  tray.on('click', () => {
    if (petWindow) {
      petWindow.show();
    }
  });
}

function updateTrayMenu() {
  const menuTemplate = [
    {
      label: '显示桌宠',
      click: () => {
        if (petWindow) petWindow.show();
      }
    },
    {
      label: '立即更新灵感',
      click: () => {
        triggerFetch();
      }
    },
    {
      label: '设置',
      click: () => {
        createSettingsWindow();
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        forceQuit = true;
        if (panelWindow && !panelWindow.isDestroyed()) {
          panelWindow.destroy();
          panelWindow = null;
        }
        if (settingsWindow && !settingsWindow.isDestroyed()) {
          settingsWindow.destroy();
          settingsWindow = null;
        }
        app.quit();
      }
    }
  ];

  tray.setContextMenu(Menu.buildFromTemplate(menuTemplate));
}

// ═══════════════════════════════════════════
//  Content Fetching
// ═══════════════════════════════════════════
async function triggerFetch() {
  if (!fetcher) return { success: false, error: 'Fetcher not initialized' };

  const sources = store.get('sources') || [];
  const keywords = store.get('keywords') || [];
  const intervalHours = store.get('intervalHours') || 1;
  const intervalMinutes = store.get('intervalMinutes') || 0;
  const intervalTotalMin = intervalHours * 60 + intervalMinutes;

  if (sources.length === 0) {
    showCustomNotification('InspEye', '尚未配置内容源，请打开设置添加灵感来源');
    return { success: false, error: 'No sources configured' };
  }

  try {
    await fetcher.fetchAll(sources, keywords, { fresh: true });
    lastFetchTime = Date.now();

    const itemCount = fetcher.getItems().length;
    const newCount = fetcher.getNewCount();
    const errors = fetcher.getLastErrors();

    debugLog(`[InspEye] Fetch complete. Total cached: ${itemCount}, New this cycle: ${newCount}, Failed sources: ${errors.length}/${sources.length}`);

    // Mark content as dirty — panel will refresh on next showPanel() or immediately if visible
    contentDirty = true;

    // If panel is currently visible, refresh right away
    if (panelWindow && panelVisible && !panelWindow.isDestroyed()) {
      debugLog('[InspEye] Panel is visible, sending content:updated immediately');
      panelWindow.webContents.send('content:updated');
      contentDirty = false;  // Already sent
    } else {
      debugLog(`[InspEye] Panel not visible (visible=${panelVisible}), will refresh on next show`);
    }

    // Send custom notification (replaces native Windows toast)
    const notifyEnabled = store.get('notifications') !== false;
    if (notifyEnabled) {
      if (newCount > 0) {
        const displayCount = Math.min(newCount, 200);
        showCustomNotification('InspEye', `${displayCount} 条新设计案例等你发现`);
        debugLog(`[InspEye] Sent notification: ${newCount} new items`);
      } else {
        showCustomNotification('InspEye', '暂未发现新灵感，显示已收录灵感');
        debugLog(`[InspEye] Sent notification: no new items`);
      }
    }

    // Notify if ALL sources failed
    if (errors.length > 0) {
      if (errors.length === sources.length) {
        showCustomNotification('InspEye - 抓取失败', `所有内容源抓取失败，请检查设置中的 RSS 链接是否有效。\n${errors.map(e => e.source).join('、')}`);
        debugLog(`[InspEye] ALL sources failed:\n${errors.map(e => `${e.source}: ${e.error}`).join('\n')}`);
      } else {
        debugLog(`[InspEye] Some sources failed: ${errors.map(e => e.source).join(', ')}`);
      }
    }

    scheduleNextFetch(intervalTotalMin);
    return { success: errors.length < sources.length, itemCount, newCount, errors };
  } catch (err) {
    debugLog('Fetch error:', err);
    showCustomNotification('InspEye - 抓取出错', String(err.message || err));
    scheduleNextFetch(intervalTotalMin);
    return { success: false, error: err.message };
  }
}

function scheduleNextFetch(intervalMinutes) {
  if (fetchTimer) clearTimeout(fetchTimer);
  const intervalMs = intervalMinutes * 60 * 1000;
  fetchTimer = setTimeout(() => triggerFetch(), intervalMs);
}

function startFetchSchedule() {
  const intervalHours = store.get('intervalHours') || 1;
  const intervalMinutes = store.get('intervalMinutes') || 0;
  const interval = intervalHours * 60 + intervalMinutes;
  // Fetch immediately on start if no recent fetch
  const timeSinceLastFetch = Date.now() - lastFetchTime;
  const intervalMs = interval * 60 * 1000;

  if (timeSinceLastFetch >= intervalMs) {
    triggerFetch();
  } else {
    scheduleNextFetch(interval);
  }
}

// ═══════════════════════════════════════════
//  Scheduled Push — fixed-time fetch
// ═══════════════════════════════════════════
function startScheduledPushChecker() {
  if (scheduledPushChecker) clearInterval(scheduledPushChecker);
  // Check every 30 seconds to ensure we catch the target minute
  scheduledPushChecker = setInterval(() => checkScheduledPush(), 30000);
  // Also check once immediately
  checkScheduledPush();
}

function checkScheduledPush() {
  const enabled = store.get('scheduledPushEnabled');
  if (!enabled) return;

  const now = new Date();
  const todayStr = now.toDateString();

  // Already pushed today
  if (lastScheduledPushDate === todayStr) return;

  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const targetTime = store.get('scheduledPushTime') || '09:00';

  if (currentTime !== targetTime) return;

  // Check day of week for weekly mode
  const pushType = store.get('scheduledPushType') || 'daily';
  if (pushType === 'weekly') {
    const weekdays = store.get('scheduledPushWeekdays') || [];
    if (!weekdays.includes(now.getDay())) return;
  }

  debugLog(`[InspEye] Scheduled push triggered at ${currentTime} (${pushType})`);
  lastScheduledPushDate = todayStr;
  triggerFetch();
}

// ═══════════════════════════════════════════
//  IPC Handlers
// ═══════════════════════════════════════════
function setupIPC() {
  // ── Pet hover events ──
  ipcMain.on('pet:hover-enter', () => {
    showPanel();
  });

  ipcMain.on('pet:hover-leave', () => {
    hidePanel(400);
  });

  ipcMain.on('pet:drag-start', () => {
    isDragging = true;
    hidePanel(0);
  });

  ipcMain.on('pet:drag-end', () => {
    isDragging = false;
  });

  ipcMain.on('pet:right-click', () => {
    const menu = Menu.buildFromTemplate([
      { type: 'separator' },
      {
        label: '设置',
        click: () => createSettingsWindow()
      },
      {
        label: '立即更新',
        click: () => triggerFetch()
      },
      { type: 'separator' },
      {
        label: '切换皮肤',
        submenu: buildSkinMenu()
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          forceQuit = true;
          if (panelWindow && !panelWindow.isDestroyed()) {
            panelWindow.destroy();
            panelWindow = null;
          }
          if (settingsWindow && !settingsWindow.isDestroyed()) {
            settingsWindow.destroy();
            settingsWindow = null;
          }
          app.quit();
        }
      }
    ]);
    menu.popup();
  });

  // ── Panel events ──
  // Panel renderer notifies us when cursor enters/leaves panel window
  ipcMain.on('panel:hover-enter', () => {
    lastHoverTime = Date.now();
    clearTimeout(panelHideTimer);
    debugLog('Panel RENDERER: hover enter');
  });

  ipcMain.on('panel:hover-leave', () => {
    lastHoverTime = Date.now(); // reset — hide timer will fire in 400ms
    debugLog('Panel RENDERER: hover leave');
  });

  ipcMain.on('panel:open-url', (event, url) => {
    if (url) shell.openExternal(url);
  });

  ipcMain.on('panel:open-settings', () => {
    createSettingsWindow();
  });

  // Open images folder in file explorer
  ipcMain.handle('panel:open-image-folder', async () => {
    const imagesPath = path.join(store.getCachePath(), 'images');
    try {
      await shell.openPath(imagesPath);
      debugLog('[InspEye] Opened images folder:', imagesPath);
    } catch (e) {
      debugLog('[InspEye] Failed to open images folder:', e.message);
    }
  });

  // ── Data access ──
  ipcMain.handle('data:get-items', async (event, opts) => {
    return fetcher ? fetcher.getItems(opts) : [];
  });

  ipcMain.handle('data:get-favorites', async () => {
    return store.get('favorites') || [];
  });

  ipcMain.handle('data:toggle-favorite', async (event, item) => {
    let favorites = store.get('favorites') || [];
    const idx = favorites.findIndex(f => f.guid === item.guid);
    if (idx >= 0) {
      // Un-favoriting: just remove from list (keep image file on disk)
      favorites.splice(idx, 1);
    } else {
      // Favoriting: add to list, then async-download image if source allows
      favorites.unshift(item);
      store.set('favorites', favorites);

      // Check if this source has downloadImage enabled
      const sources = store.get('sources') || [];
      const source = sources.find(s => s.id === item.sourceId);
      const shouldDownload = source ? source.downloadImage !== false : true;

      if (shouldDownload && item.image && fetcher) {
        debugLog('[InspEye] Favorited item, downloading image:', item.image);
        fetcher.downloadImageForItem(item).then(localImage => {
          if (localImage) {
            // Update the favorite item with localImage path
            const favs = store.get('favorites') || [];
            const fi = favs.find(f => f.guid === item.guid);
            if (fi) {
              fi.localImage = localImage;
              store.set('favorites', favs);
              debugLog('[InspEye] Image downloaded for favorite:', localImage);
            }
            // Notify panel to refresh favorites view
            if (panelWindow && !panelWindow.isDestroyed()) {
              panelWindow.webContents.send('favorites:updated', store.get('favorites') || []);
            }
          } else {
            debugLog('[InspEye] Image download failed for favorite:', item.image);
          }
        }).catch(err => {
          debugLog('[InspEye] Favorite image download error:', err.message);
        });
      }

      return favorites;
    }
    store.set('favorites', favorites);
    return favorites;
  });

  ipcMain.handle('data:get-downloaded-guids', async (event, items) => {
    // Given an array of {guid, image, category}, return guids whose images are already on disk
    if (!fetcher || !Array.isArray(items)) return [];
    return items
      .filter(item => fetcher.hasDownloadedImage(item.image, item.category))
      .map(item => item.guid);
  });

  ipcMain.handle('data:clear-favorites', async () => {
    const count = (store.get('favorites') || []).length;
    store.set('favorites', []);
    debugLog('[InspEye] Cleared all favorites (', count, ' items). Images kept on disk.');
    return [];
  });

  ipcMain.handle('data:mark-read', async (event, guids) => {
    fetcher.markRead(guids);
    // Notify pet window to update unread badge immediately
    if (petWindow && !petWindow.isDestroyed() && petWindow.webContents) {
      const count = fetcher.getUnreadCount();
      petWindow.webContents.send('pet:unread-changed', count);
    }
    return true;
  });

  ipcMain.handle('data:mark-all-read', async () => {
    fetcher.markAllRead();
    if (petWindow && !petWindow.isDestroyed() && petWindow.webContents) {
      petWindow.webContents.send('pet:unread-changed', 0);
    }
    return true;
  });

  ipcMain.handle('data:get-unread-count', async () => {
    return fetcher ? fetcher.getUnreadCount() : 0;
  });

  // ── Settings ──
  ipcMain.handle('settings:get', async () => {
    return {
      sources: store.get('sources') || [],
      keywords: store.get('keywords') || [],
      artists: store.get('artists') || [],
      updateInterval: store.get('updateInterval') || 60,
      intervalHours: store.get('intervalHours') || 1,
      intervalMinutes: store.get('intervalMinutes') || 0,
      scheduledPushEnabled: store.get('scheduledPushEnabled') || false,
      scheduledPushType: store.get('scheduledPushType') || 'daily',
      scheduledPushTime: store.get('scheduledPushTime') || '09:00',
      scheduledPushWeekdays: store.get('scheduledPushWeekdays') || [1],
      theme: store.get('theme') || 'system',
      petSkin: store.get('petSkin') || 'mint',
      notifications: store.get('notifications') !== false,
      autoLaunch: store.get('autoLaunch') || false,
      cachePath: store.get('cachePath') || 'D:\\inspieye',
      categories: store.get('categories') || []
    };
  });

  ipcMain.handle('settings:set', async (event, key, value) => {
    store.set(key, value);

    // Handle side effects
    if (key === 'theme') {
      applyTheme(value);
    }
    if (key === 'petSkin') {
      if (petWindow) {
        petWindow.webContents.send('pet:skin-changed', value);
      }
      // Also notify panel to update CSS variables
      if (panelWindow) {
        panelWindow.webContents.send('pet:skin-changed', value);
      }
    }
    if (key === 'updateInterval') {
      scheduleNextFetch(value);
    }
    if (key === 'intervalHours' || key === 'intervalMinutes') {
      const h = store.get('intervalHours') || 1;
      const m = store.get('intervalMinutes') || 0;
      scheduleNextFetch(h * 60 + m);
    }
    if (key === 'scheduledPushEnabled' || key === 'scheduledPushType' ||
        key === 'scheduledPushTime' || key === 'scheduledPushWeekdays') {
      // Reset last push date so changes take effect immediately
      lastScheduledPushDate = null;
    }
    if (key === 'sources' || key === 'keywords') {
      // No immediate refetch, will apply on next cycle
    }
    if (key === 'autoLaunch') {
      app.setLoginItemSettings({
        openAtLogin: !!value,
        path: app.getPath('exe'),
        args: []
      });
    }
    if (key === 'cachePath') {
      store.setCachePath(value);
    }
    // Notify panel to refresh category chips when categories change
    if (key === 'categories') {
      if (panelWindow && !panelWindow.isDestroyed()) {
        panelWindow.webContents.send('panel:categories-updated');
      }
    }

    return true;
  });

  ipcMain.handle('settings:trigger-fetch', async () => {
    return await triggerFetch();
  });

  ipcMain.handle('settings:close', async () => {
    if (settingsWindow) settingsWindow.close();
  });

  ipcMain.handle('settings:minimize', async () => {
    if (settingsWindow) settingsWindow.minimize();
  });

  ipcMain.handle('settings:select-cache-dir', async () => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog(settingsWindow || null, {
      title: '选择缓存目录',
      properties: ['openDirectory']
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });

}

function buildSkinMenu() {
  const skins = [
    { id: 'mint', label: '薄荷绿' },
    { id: 'sunset', label: '日落橙' },
    { id: 'ocean', label: '海洋蓝' },
    { id: 'mono', label: '极简灰' },
    { id: 'sakura', label: '樱花粉' }
  ];

  const currentSkin = store.get('petSkin') || 'mint';
  return skins.map(skin => ({
    label: skin.label,
    type: 'radio',
    checked: skin.id === currentSkin,
    click: () => {
      store.set('petSkin', skin.id);
      if (petWindow) petWindow.webContents.send('pet:skin-changed', skin.id);
    }
  }));
}

// ═══════════════════════════════════════════
//  Theme
// ═══════════════════════════════════════════
function applyTheme(theme) {
  if (theme === 'dark') {
    nativeTheme.themeSource = 'dark';
  } else if (theme === 'light') {
    nativeTheme.themeSource = 'light';
  } else {
    nativeTheme.themeSource = 'system';
  }

  // Broadcast to all windows
  [petWindow, panelWindow, settingsWindow].forEach(win => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('theme:changed', theme);
    }
  });
}

// ═══════════════════════════════════════════
//  App Lifecycle
// ═══════════════════════════════════════════
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (petWindow) petWindow.show();
  });

  app.whenReady().then(async () => {
    debugLog('[InspEye] App ready, initializing...');

    // ─── Migrate old settings from default userData to D:\inspieye\ ───
    if (defaultUserDataDir !== actualUserDataDir) {
      const oldSettingsFile = path.join(defaultUserDataDir, 'settings.json');
      const newSettingsFile = path.join(actualUserDataDir, 'settings.json');
      try {
        if (fs.existsSync(oldSettingsFile) && !fs.existsSync(newSettingsFile)) {
          const oldData = fs.readFileSync(oldSettingsFile, 'utf-8');
          fs.writeFileSync(newSettingsFile, oldData, 'utf-8');
          debugLog('[InspEye] ✓ Migrated settings from', oldSettingsFile, 'to', newSettingsFile);
        }
      } catch (e) {
        debugLog('[InspEye] ⚠ Settings migration failed:', e.message);
      }
    }

    // Configure system proxy BEFORE any network requests
    // Must use session.defaultSession.fetch() in fetcher (not global.fetch)
    // to respect this setting. global.fetch = Node undici (ignores proxy).
    const { session } = require('electron');
    try {
      await session.defaultSession.setProxy({ mode: 'system' });
      debugLog('[InspEye] ✓ System proxy configured (mode: system)');
    } catch (err) {
      debugLog('[InspEye] ⚠ Proxy config failed:', err.message);
    }

    try {
      // Initialize store
      store = new Store();
      debugLog('[InspEye] Store created. Sources:', (store.get('sources') || []).length);

      // Initialize fetcher
      fetcher = new ContentFetcher(store);
      debugLog('[InspEye] Fetcher created. Items in cache:', fetcher.getItems().length);

      // Apply theme
      applyTheme(store.get('theme') || 'system');

      // Create windows
      createPetWindow();
      debugLog('[InspEye] Pet window created');

      createPanelWindow();
      debugLog('[InspEye] Panel window created');

      // Push current skin + theme to panel IMMEDIATELY when it finishes loading
      // (don't wait for showPanel — panel needs to know its skin/theme at init time)
      if (panelWindow && !panelWindow.isDestroyed()) {
        const initialSkin = (store && store.get('petSkin')) || 'mint';
        const initialTheme = (store && store.get('theme')) || 'system';
        panelWindow.webContents.once('did-finish-load', () => {
          debugLog('[InspEye] Panel loaded, pushing initial skin:', initialSkin, 'theme:', initialTheme);
          panelWindow.webContents.send('pet:skin-changed', initialSkin);
          panelWindow.webContents.send('theme:changed', initialTheme);
        });
      }

      // Create tray (wrap in try-catch — tray is non-critical)
      try {
        createTray();
        debugLog('[InspEye] Tray created');
      } catch (trayErr) {
        debugLog('[InspEye] Tray creation failed (non-critical):', trayErr.message);
      }

      // Setup IPC
      setupIPC();
      debugLog('[InspEye] IPC setup complete');

      // Start cursor-based hover detection
      startHoverCheck();
      debugLog('[InspEye] Hover check started');

      // Start content fetching
      startFetchSchedule();
      debugLog('[InspEye] Fetch schedule started');

      // Start scheduled push checker
      startScheduledPushChecker();
      debugLog('[InspEye] Scheduled push checker started');

      // Set auto-launch if configured
      if (store.get('autoLaunch')) {
        app.setLoginItemSettings({
          openAtLogin: true,
          path: app.getPath('exe'),
          args: []
        });
      }

      debugLog('[InspEye] Initialization complete!');
    } catch (err) {
      debugLog('[InspEye] FATAL initialization error:', err.message, err.stack);
    }
  });

  app.on('window-all-closed', () => {
    // Don't quit when all windows close — tray keeps app alive
    // On macOS, this behavior is expected; on Windows, we stay alive via tray
    if (forceQuit) {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (petWindow) petWindow.show();
  });

  app.on('before-quit', () => {
    closeNotifyWindow();
    // Save pet position safely
    try {
      if (petWindow && !petWindow.isDestroyed()) {
        const [x, y] = petWindow.getPosition();
        store.set('petPosition', { x, y });
      }
    } catch (e) {
      debugLog('[InspEye] Could not save pet position on quit:', e.message);
    }
    // Destroy all windows to ensure clean quit
    if (panelWindow && !panelWindow.isDestroyed()) {
      panelWindow.destroy();
      panelWindow = null;
    }
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.destroy();
      settingsWindow = null;
    }
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.destroy();
      petWindow = null;
    }
    // Destroy tray to remove from system tray
    if (tray && !tray.isDestroyed()) {
      tray.destroy();
      tray = null;
    }
  });
}
