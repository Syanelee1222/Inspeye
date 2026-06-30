const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { RSSParser } = require('./rss-parser');

// ═══════════════════════════════════════════
//  ContentFetcher — fetches & caches RSS feeds
//  Uses session.defaultSession.fetch() (Electron Chromium network stack)
//  which respects system proxy / PAC / autoconfig settings.
//  global.fetch (Node undici) does NOT use Electron's proxy settings.
// ═══════════════════════════════════════════

const FETCH_TIMEOUT = 30000;
const MAX_RETRIES = 2;

// Lazily get session fetch (must be called after app.ready)
function getSessionFetch() {
  try {
    const { session } = require('electron');
    if (session && session.defaultSession && typeof session.defaultSession.fetch === 'function') {
      return (url, options) => session.defaultSession.fetch(url, options);
    }
  } catch (_) {}
  return null;
}

// Cache for session fetch (initialized on first use)
let _sessionFetchCache = null;
let _sessionFetchChecked = false;

function getFetchFn() {
  if (!_sessionFetchChecked) {
    _sessionFetchCache = getSessionFetch();
    _sessionFetchChecked = true;
    if (_sessionFetchCache) {
      console.log('[InspEye] Using session.defaultSession.fetch() (proxy-supported)');
    } else {
      console.warn('[InspEye] session.fetch not available, falling back to global.fetch (proxy may not work)');
    }
  }
  return _sessionFetchCache || fetch;  // global.fetch fallback
}

class ContentFetcher {
  constructor(store) {
    this.store = store;
    this.parser = new RSSParser();
    this.cacheFile = path.join(store.getCachePath(), 'cache', 'items.json');
    this.readStateFile = path.join(store.getCachePath(), 'data', 'read-state.json');
    this.sourceStateFile = path.join(store.getCachePath(), 'data', 'source-states.json');
    this.items = [];
    this.readGuids = new Set();
    this.sourceStates = {};
    this.newCount = 0;
    this.lastErrors = [];

    this.loadCache();
    this.loadReadState();
    this.loadSourceStates();
  }

  // ── Persistent: source states (per-source seenGuids) ──
  loadSourceStates() {
    try {
      if (fs.existsSync(this.sourceStateFile)) {
        this.sourceStates = JSON.parse(fs.readFileSync(this.sourceStateFile, 'utf8'));
      }
    } catch (e) {
      console.error('[InspEye] Failed to load source states:', e.message);
      this.sourceStates = {};
    }
  }

  saveSourceStates() {
    try {
      const dir = path.dirname(this.sourceStateFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.sourceStateFile, JSON.stringify(this.sourceStates, null, 2), 'utf8');
    } catch (e) {
      console.error('[InspEye] Failed to save source states:', e.message);
    }
  }

  getSourceState(sourceId) {
    if (!this.sourceStates[sourceId]) {
      this.sourceStates[sourceId] = { seenGuids: [], lastFetchTime: 0 };
    }
    return this.sourceStates[sourceId];
  }

  // ── Cache I/O ──
  loadCache() {
    try {
      if (fs.existsSync(this.cacheFile)) {
        this.items = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));

        // Migration: fix old file:// URLs (file://D:/...) to correct format (file:///D:/...)
        let migrated = 0;
        this.items.forEach(item => {
          if (item.localImage && item.localImage.startsWith('file://') && !item.localImage.startsWith('file:///')) {
            item.localImage = 'file:///' + item.localImage.slice(7).replace(/\\/g, '/');
            migrated++;
          }
        });
        if (migrated > 0) {
          console.log(`[InspEye] Migrated ${migrated} items with old file:// URL format`);
          this.saveCache(); // persist the fix
        }

        // Sort: newest pubDate first (items without pubDate go to the end)
        this.sortByPubDate();
      }
    } catch (e) {
      this.items = [];
    }
  }

  saveCache() {
    try {
      const dir = path.dirname(this.cacheFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.cacheFile, JSON.stringify(this.items, null, 2), 'utf8');
    } catch (e) {
      console.error('[InspEye] Failed to save cache:', e.message);
    }
  }

  getItems() {
    return this.items;
  }

  // Sort: newest pubDate first; items without pubDate go to the end
  sortByPubDate() {
    this.items.sort((a, b) => {
      const da = Date.parse(a.pubDate);
      const db = Date.parse(b.pubDate);
      if (isNaN(da) && isNaN(db)) return 0;
      if (isNaN(da)) return 1;   // a has no date → push to end
      if (isNaN(db)) return -1;  // b has no date → push to end
      return db - da;            // newest first
    });
  }

  // ── Read state ──
  loadReadState() {
    try {
      if (fs.existsSync(this.readStateFile)) {
        const data = JSON.parse(fs.readFileSync(this.readStateFile, 'utf8'));
        this.readGuids = new Set(data.readGuids || []);
      }
    } catch (e) {
      this.readGuids = new Set();
    }
  }

  saveReadState() {
    try {
      const dir = path.dirname(this.readStateFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.readStateFile, JSON.stringify({
        readGuids: [...this.readGuids]
      }), 'utf8');
    } catch (e) {
      console.error('[InspEye] Failed to save read state:', e.message);
    }
  }

  markAsRead(guid) {
    this.readGuids.add(guid);
    this.saveReadState();
  }

  markRead(guids) {
    if (!Array.isArray(guids)) guids = [guids];
    guids.forEach(guid => this.markAsRead(guid));
  }

  markAllRead() {
    this.items.forEach(item => this.readGuids.add(item.guid));
    this.saveReadState();
  }

  getUnreadCount() {
    return this.items.filter(item => !this.readGuids.has(item.guid)).length;
  }

  getNewCount() {
    return this.newCount;
  }

  getLastErrors() {
    return this.lastErrors;
  }

  // ── HTTP fetch via global fetch (Electron main process = Chromium network stack) ──
  // This automatically respects system proxy, PAC, autoconfig, etc.
  // Use session.defaultSession.fetch() (Electron Chromium stack = respects proxy)
  // Falls back to global.fetch if session fetch is unavailable
  _fetch(url, options) {
    const fn = getFetchFn();
    return fn(url, options);
  }

  async fetchWithTimeout(url, timeout = FETCH_TIMEOUT) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await this._fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
          'Cache-Control': 'no-cache'
        },
        redirect: 'follow'
      });
      clearTimeout(timer);

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status} for ${url}. Body: ${body.substring(0, 100)}`);
      }

      return await response.text();
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        throw new Error(`Timeout (${timeout}ms) fetching ${url}`);
      }
      throw err;
    }
  }

  async fetchFeed(url) {
    return await this.fetchWithTimeout(url);
  }

  // ── Retry wrapper ──
  async fetchFeedWithRetry(url, maxRetries = MAX_RETRIES) {
    let lastError;
    for (let i = 0; i <= maxRetries; i++) {
      try {
        const data = await this.fetchFeed(url);
        return data;
      } catch (err) {
        lastError = err;
        const isRetryable = err.message.includes('ECONNRESET') ||
                           err.message.includes('Timeout') ||
                           err.message.includes('Failed to fetch') ||
                           err.message.includes('HTTP 403') ||
                           err.message.includes('HTTP 429') ||
                           err.message.includes('socket hang up');
        if (!isRetryable || i === maxRetries) break;
        const delay = (i + 1) * 2000;
        console.log(`[InspEye]   ↳ Retry ${i + 1}/${maxRetries} for ${url} after ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
    throw lastError;
  }

  // ── Main fetch cycle (incremental update) ──
  async fetchAll(sources, keywords, options = {}) {
    const enabledSources = sources.filter(s => s.enabled !== false);
    this.newCount = 0;
    this.lastErrors = [];

    // Fresh fetch mode: clear cached items for a clean slate
    // BUT keep seenGuids so we can still detect genuinely new items
    let oldItems = null;
    if (options && options.fresh) {
      oldItems = [...this.items];
      console.log('[InspEye] Fresh fetch mode: clearing ' + this.items.length + ' cached items (seenGuids preserved)');
      this.items = [];
      // Do NOT clear seenGuids — they track what we've already seen across fetches
    }

    console.log(`\n[InspEye] ══════ Starting fetch: ${enabledSources.length} sources ══════`);

    for (const source of enabledSources) {
      const t0 = Date.now();
      try {
        console.log(`[InspEye] Fetching: ${source.name}`);
        const xml = await this.fetchFeedWithRetry(source.url);
        const feed = this.parser.parse(xml);

        if (!feed || !feed.items || feed.items.length === 0) {
          const errMsg = 'RSS 解析成功但未获取到任何条目，源可能已失效';
          console.warn(`[InspEye]   ✗ ${source.name}: ${errMsg}`);
          this.lastErrors.push({ source: source.name, url: source.url, error: errMsg });
          continue;
        }

        const state = this.getSourceState(source.id);
        const seenGuids = new Set(state.seenGuids || []);

        const feedItems = feed.items.map(item => ({
          ...item,
          sourceId: source.id,
          sourceName: source.name,
          category: source.category || 'Design',
          fetchedAt: new Date().toISOString()
        }));

        const trulyNew = feedItems.filter(item => !seenGuids.has(item.guid));

        // Update seenGuids
        feedItems.forEach(item => seenGuids.add(item.guid));
        const guidArray = [...seenGuids];
        state.seenGuids = guidArray.length > 200 ? guidArray.slice(-200) : guidArray;
        state.lastFetchTime = Date.now();

        if (trulyNew.length > 0) {
          trulyNew.forEach(item => {
            const exists = this.items.findIndex(it => it.guid === item.guid);
            if (exists === -1) {
              // Images are NO LONGER auto-downloaded during fetch.
              // They are downloaded on-demand when the user favorites an item.
              this.items.unshift(item);
            }
          });
          this.newCount += trulyNew.length;
          console.log(`[InspEye]   ✓ ${source.name}: ${feedItems.length} items, ${trulyNew.length} NEW (${Date.now() - t0}ms)`);
        } else {
          // No new content → add all feedItems that aren't already in cache
          // (In fresh mode, items were cleared, so all need to be re-added)
          let added = 0;
          feedItems.forEach(item => {
            const idx = this.items.findIndex(it => it.guid === item.guid);
            if (idx === -1) {
              this.items.unshift(item);
              added++;
            }
          });
          console.log(`[InspEye]   ✓ ${source.name}: ${feedItems.length} items, no new, ${added} re-added (${Date.now() - t0}ms)`);
        }

        // Sort after adding this source's items so per-source cap keeps the NEWEST items
        this.sortByPubDate();

        // Keep max 20 per source (now runs AFTER sort, so newest items are kept)
        const perSource = {};
        this.items = this.items.filter(item => {
          if (!perSource[item.sourceId]) perSource[item.sourceId] = 0;
          perSource[item.sourceId]++;
          return perSource[item.sourceId] <= 20;
        });

      } catch (err) {
        console.error(`[InspEye]   ✗ ${source.name}: FAILED after ${Date.now() - t0}ms: ${err.message}`);
        this.lastErrors.push({ source: source.name, url: source.url, error: err.message });
        console.log(`[InspEye]   ↳ Keeping ${this.items.filter(it => it.sourceId === source.id).length} cached items`);
      }
    }

    this.saveCache();
    this.saveSourceStates();

    const errorCount = this.lastErrors.length;
    const successCount = enabledSources.length - errorCount;

    // Fresh mode: if ALL sources failed, restore old items (don't leave panel empty)
    if (oldItems && errorCount > 0 && errorCount === enabledSources.length) {
      console.log('[InspEye] Fresh fetch: ALL sources failed, restoring ' + oldItems.length + ' cached items');
      this.items = oldItems;
      this.saveCache();
    }

    console.log(`[InspEye] ══════ Done: ${successCount}/${enabledSources.length} ok, ${this.newCount} new ══════\n`);

    return {
      success: errorCount === 0,
      newCount: this.newCount,
      itemCount: this.items.length,
      errors: this.lastErrors,
      successCount,
      totalCount: enabledSources.length
    };
  }

  /**
   * Download image for a favorited item.
   * Called on-demand when user clicks the heart button.
   * @param {Object} item - The RSS item with an `image` URL field
   * @returns {Promise<string|null>} - localImage file:// URL or null on failure
   */
  async downloadImageForItem(item) {
    if (!item.image || !item.image.startsWith('http')) return null;

    let ext, hash, filename, categoryDir, imagePath;
    try {
      const urlObj = new URL(item.image);
      ext = path.extname(urlObj.pathname) || '.jpg';
      hash = crypto.createHash('md5').update(item.image).digest('hex').substring(0, 12);
      filename = `${hash}${ext}`;
      categoryDir = path.join(this.store.getCachePath(), 'images', item.category || 'favorites');
      imagePath = path.join(categoryDir, filename);
    } catch (e) {
      console.warn(`[InspEye] Invalid image URL for favorite: ${item.image}`, e.message);
      return null;
    }

    // Already downloaded?
    if (fs.existsSync(imagePath)) {
      return `file:///${imagePath.replace(/\\/g, '/')}`;
    }

    // Download now (await — called from main process on favorite toggle)
    const success = await this.downloadImage(item.image, imagePath, item.category);
    if (success) {
      return `file:///${imagePath.replace(/\\/g, '/')}`;
    }
    return null;
  }

  /**
   * Construct the local image path for a given image URL and category,
   * the same way downloadImageForItem does.
   * Used to check whether an image has already been downloaded.
   */
  getImagePath(imageUrl, category) {
    if (!imageUrl || !imageUrl.startsWith('http')) return null;
    try {
      const urlObj = new URL(imageUrl);
      const ext = path.extname(urlObj.pathname) || '.jpg';
      const hash = crypto.createHash('md5').update(imageUrl).digest('hex').substring(0, 12);
      const filename = `${hash}${ext}`;
      const categoryDir = path.join(this.store.getCachePath(), 'images', category || 'favorites');
      return path.join(categoryDir, filename);
    } catch (e) {
      return null;
    }
  }

  /**
   * Check if an image has already been downloaded to local disk.
   */
  hasDownloadedImage(imageUrl, category) {
    const imagePath = this.getImagePath(imageUrl, category);
    return imagePath ? fs.existsSync(imagePath) : false;
  }

  async downloadImage(imageUrl, imagePath, category) {
    try {
      const dir = path.dirname(imagePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      // Use session fetch (respects proxy)
      const response = await this._fetch(imageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
        },
        redirect: 'follow'
      });

      if (!response.ok) {
        console.warn(`[InspEye] Image download HTTP ${response.status}: ${imageUrl}`);
        return false;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(imagePath, buffer);
      console.log(`[InspEye] Cached image: ${path.basename(imagePath)}${category ? ' (' + category + ')' : ''}`);
      return true;
    } catch (e) {
      console.warn(`[InspEye] Image download failed: ${imageUrl}`, e.message);
      return false;
    }
  }
}

module.exports = { ContentFetcher };
