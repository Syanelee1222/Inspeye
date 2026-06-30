const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// ══════════════════════════════════════════
//  Store — persistent JSON-based local storage
// ══════════════════════════════════════════

class Store {
  constructor() {
    // Use Electron's userData directory for settings
    this.settingsDir = app.getPath('userData');
    this.settingsFile = path.join(this.settingsDir, 'settings.json');

    // Default cache path (as specified in requirements)
    this.defaultCachePath = 'D:\\inspieye';

    // Load settings FIRST so we can read custom cachePath
    this.data = this.load();

    // Use user-configured path if available, otherwise default
    const userCachePath = this.data.cachePath;
    if (userCachePath) {
      this.defaultCachePath = userCachePath;
    }

    // Ensure cache directory exists
    this.ensureCacheDir();
  }

  ensureCacheDir() {
    const cachePath = this.defaultCachePath;
    try {
      if (!fs.existsSync(cachePath)) {
        fs.mkdirSync(cachePath, { recursive: true });
      }
      // Create subdirectories
      const subdirs = ['cache', 'images', 'data'];
      subdirs.forEach(dir => {
        const dirPath = path.join(cachePath, dir);
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
        }
      });
    } catch (err) {
      console.warn('Failed to create cache dir, falling back to userData:', err.message);
      this.defaultCachePath = this.settingsDir;
    }
  }

  getCachePath() {
    // Prefer user-configured path from settings data
    const custom = this.data.cachePath;
    if (custom) return custom;
    return this.defaultCachePath;
  }

  setCachePath(newPath) {
    this.defaultCachePath = newPath;
    // Ensure new cache directory exists
    try {
      if (!fs.existsSync(newPath)) {
        fs.mkdirSync(newPath, { recursive: true });
      }
      const subdirs = ['cache', 'images', 'data'];
      subdirs.forEach(dir => {
        const dirPath = path.join(newPath, dir);
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
        }
      });
    } catch (err) {
      console.warn('[Store] Failed to create custom cache dir:', err.message);
    }
  }

  load() {
    try {
      if (fs.existsSync(this.settingsFile)) {
        const raw = fs.readFileSync(this.settingsFile, 'utf-8');
        const data = JSON.parse(raw);

        // ── Migrations ──
        // Migration 1: reset to 5 fixed categories
        const fixedIds = ['design', 'illustration', 'concept', 'interaction', 'ai'];
        const hasFixed = data.categories && Array.isArray(data.categories) &&
          fixedIds.every(id => (data.categories || []).some(c => (c.id || c.name) === id));
        if (!hasFixed) {
          data.categories = this._getDefaultCategories();
          // Update sources with old category IDs
          if (data.sources && Array.isArray(data.sources)) {
            data.sources.forEach(src => {
              if (!fixedIds.includes(src.category)) {
                src.category = 'design';
              }
            });
          }
        }
        // Migration 2: add downloadImage field to existing sources
        if (data.sources && Array.isArray(data.sources)) {
          data.sources.forEach(src => {
            if (src.downloadImage === undefined) {
              src.downloadImage = false;
            }
          });
        }
        // Migration 3: REMOVED - sources are no longer cleared on startup.
        // Fresh content fetch is now handled by fetcher.fetchAll(..., { fresh: true })
        // which clears cached ITEMS (not source config) before each fetch.
        // Migration 4: ensure categories have id field
        if (data.categories) {
          data.categories.forEach(cat => {
            if (!cat.id) cat.id = cat.name;
          });
        }
        // Migration 5: migrate from updateInterval to intervalHours + intervalMinutes
        if (data.intervalHours === undefined && data.updateInterval !== undefined) {
          const totalMin = data.updateInterval;
          data.intervalHours = Math.floor(totalMin / 60);
          data.intervalMinutes = totalMin % 60;
          // Clamp hours to 1-24
          if (data.intervalHours < 1) {
            data.intervalHours = 1;
            data.intervalMinutes = 0;
          }
          if (data.intervalHours > 24) data.intervalHours = 24;
          // Snap minutes to nearest 15
          const validMin = [0, 15, 30, 45];
          data.intervalMinutes = validMin.reduce((prev, curr) =>
            Math.abs(curr - data.intervalMinutes) < Math.abs(prev - data.intervalMinutes) ? curr : prev
          );
        }
        // Migration 6: ensure scheduled push defaults exist
        if (data.scheduledPushEnabled === undefined) data.scheduledPushEnabled = false;
        if (!data.scheduledPushType) data.scheduledPushType = 'daily';
        if (!data.scheduledPushTime) data.scheduledPushTime = '09:00';
        if (!data.scheduledPushWeekdays) data.scheduledPushWeekdays = [1];

        this.save(); // persist migrations
        return data;
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
    return this.getDefaults();
  }

  _getDefaultCategories() {
    return [
      { id: 'design', name: '设计', downloadImage: true },
      { id: 'illustration', name: '插画', downloadImage: true },
      { id: 'concept', name: '概念', downloadImage: true },
      { id: 'interaction', name: '交互', downloadImage: true },
      { id: 'ai', name: 'AI', downloadImage: true }
    ];
  }

  save() {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.settingsFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.settingsFile, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[Store] Failed to save settings to', this.settingsFile, ':', err);
    }
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
  }

  getDefaults() {
    return {
      // Default content sources (RSS feeds)
      sources: [
        {
          id: 'designboom',
          name: 'Designboom',
          url: 'https://www.designboom.com/feed/',
          type: 'rss',
          category: 'design',
          enabled: true,
          downloadImage: true
        },
        {
          id: 'core77',
          name: 'Core77',
          url: 'https://www.core77.com/rss.xml',
          type: 'rss',
          category: 'design',
          enabled: true,
          downloadImage: true
        },
        {
          id: '交互',
          name: '交互',
          url: 'https://speckyboy.com/category/ux/feed/',
          type: 'rss',
          category: 'interaction',
          enabled: true,
          downloadImage: true
        },
        {
          id: 'awanqi',
          name: 'aw anqi',
          url: 'https://awanqi.artstation.com/rss',
          type: 'rss',
          category: 'illustration',
          enabled: true,
          downloadImage: true
        },
        {
          id: 'k 海',
          name: 'k 海',
          url: 'https://kleinerhai.artstation.com/rss',
          type: 'rss',
          category: 'illustration',
          enabled: true,
          downloadImage: true
        },
        {
          id: 'claudz',
          name: 'claudz',
          url: 'https://claudzzz.artstation.com/rss',
          type: 'rss',
          category: 'illustration',
          enabled: true,
          downloadImage: true
        },
        {
          id: 'yayan',
          name: 'yayan',
          url: 'https://yayan.artstation.com/rss',
          type: 'rss',
          category: 'concept',
          enabled: true,
          downloadImage: true
        },
        {
          id: 'behance',
          name: 'behance',
          url: 'https://www.pinterest.com/behance/feed.rss',
          type: 'rss',
          category: 'concept',
          enabled: true,
          downloadImage: true
        },
      ],

      // Categories management
      categories: this._getDefaultCategories(),
      keywords: ['UI', 'UX', 'illustration', 'branding', 'motion', 'typography'],
      artists: [],
      updateInterval: 60, // minutes (legacy, kept for compat)
      intervalHours: 1,
      intervalMinutes: 0,
      scheduledPushEnabled: false,
      scheduledPushType: 'daily',   // 'daily' | 'weekly'
      scheduledPushTime: '09:00',   // HH:MM
      scheduledPushWeekdays: [1],    // [0=Sun, 1=Mon, ... 6=Sat]
      theme: 'system',
      petSkin: 'mint',
      notifications: true,
      autoLaunch: false,
      cachePath: 'D:\\inspieye',
      petPosition: null,
      favorites: []
    };
  }
}

module.exports = { Store };
