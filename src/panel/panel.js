// ═════════════════════════════════════════
//  Panel Window Logic — inspiration card grid
// ═════════════════════════════════════════

let currentTab = 'latest';
let currentCategory = 'all';
let allItems = [];
let favoriteItems = [];

// ── DOM refs ──
const contentArea  = document.getElementById('contentArea');
const loadingState = document.getElementById('loadingState');
const emptyState   = document.getElementById('emptyState');
const unreadBadge = document.getElementById('unreadBadge');
const filterBar    = document.getElementById('filterBar');

// ── IntersectionObserver for marking visible cards as read ──
let _readBatch = [];
let _readTimer = null;
let _cardObserver = null;

function setupCardObserver() {
  if (_cardObserver) _cardObserver.disconnect();
  
  _cardObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const guid = entry.target.dataset.guid;
        if (guid && !_readBatch.includes(guid)) {
          _readBatch.push(guid);
        }
        _cardObserver.unobserve(entry.target);
      }
    });
    
    if (_readBatch.length > 0) {
      clearTimeout(_readTimer);
      _readTimer = setTimeout(() => {
        const guids = [..._readBatch];
        _readBatch = [];
        window.inspieye.data.markRead(guids);
      }, 400);
    }
  }, { threshold: 0.3 });
  
  document.querySelectorAll('.case-card[data-guid]').forEach(card => {
    _cardObserver.observe(card);
  });
}

// ── Scroll-to-bottom auto mark-all-read ──
let _bottomScrollSetup = false;
let _bottomFired = false;
let _bottomTimer = null;

function setupBottomScrollHandler() {
  if (_bottomScrollSetup) return;
  _bottomScrollSetup = true;

  contentArea.addEventListener('scroll', () => {
    const { scrollTop, scrollHeight, clientHeight } = contentArea;
    const dist = scrollHeight - scrollTop - clientHeight;

    if (dist < 30) {
      if (!_bottomFired) {
        _bottomFired = true;
        clearTimeout(_bottomTimer);
        _bottomTimer = setTimeout(async () => {
          await window.inspieye.data.markAllRead();
          unreadBadge.style.display = 'none';
        }, 500);
      }
    } else {
      _bottomFired = false;
    }
  });
}

// ── Render category filter chips dynamically ──
let _lastCategoryChipIds = '';
async function renderCategoryChips() {
  try {
    const settings = await window.inspieye.settings.get();
    const categories = settings.categories || [];
    
    // Skip redraw if categories haven't changed
    const ids = categories.map(c => c.id || c.name).join(',');
    if (ids === _lastCategoryChipIds) return;
    _lastCategoryChipIds = ids;
    
    // Rebuild filter bar: keep "全部" button, remove old category chips
    const allChip = filterBar.querySelector('[data-cat="all"]');
    filterBar.innerHTML = '';
    if (allChip) {
      filterBar.appendChild(allChip);
    } else {
      // Fallback: recreate "全部" button if missing
      const fallback = document.createElement('button');
      fallback.className = 'filter-chip active';
      fallback.dataset.cat = 'all';
      fallback.textContent = '全部';
      fallback.addEventListener('click', () => {
        document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        fallback.classList.add('active');
        currentCategory = 'all';
        renderContent();
      });
      filterBar.appendChild(fallback);
    }
    
    // Restore active state
    const activeCat = currentCategory;
    
    // Add dynamic chips
    categories.forEach(cat => {
      const chip = document.createElement('button');
      chip.className = 'filter-chip' + (activeCat === (cat.id || cat.name) ? ' active' : '');
      chip.dataset.cat = cat.id || cat.name;
      chip.textContent = cat.name;
      chip.addEventListener('click', () => {
        document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        currentCategory = chip.dataset.cat;
        renderContent();
      });
      filterBar.appendChild(chip);
    });
  } catch (e) {
    console.error('[panel] Failed to render category chips:', e);
  }
}

// Listen for category changes from settings
window.inspieye.panel.onCategoriesChanged(() => {
  renderCategoryChips();
});

// Listen for favorites updates (image download completed after favoriting)
window.inspieye.data.onFavoritesUpdated((updatedFavorites) => {
  favoriteItems = updatedFavorites;
  if (currentTab === 'favorites') {
    if (clearFavBtn) clearFavBtn.style.display = favoriteItems.length > 0 ? 'flex' : 'none';
    renderContent();
  }
});

// Fallback: if init() fails to set data-skin, this catches it
// (init() now sets data-skin from the same settings object)
window.inspieye.settings.get().then(settings => {
  // Only set if init() hasn't already set it
  if (!document.body.getAttribute('data-skin')) {
    document.body.setAttribute('data-skin', settings.petSkin || 'mint');
    console.log('[panel] fallback: set data-skin =', settings.petSkin || 'mint');
  }
}).catch(() => {
  if (!document.body.getAttribute('data-skin')) {
    document.body.setAttribute('data-skin', 'mint');
    console.log('[panel] fallback: set data-skin = mint (catch)');
  }
});

// Listen for skin changes
window.inspieye.pet.onSkinChanged((skin) => {
  document.body.setAttribute('data-skin', skin);
});

// ── Hover: notify main process when cursor enters/leaves panel ──
// Use mouseover/mouseout on document — they fire when cursor
// enters or leaves the document root, which covers the whole panel.
let panelHovering = false;

document.addEventListener('mouseover', () => {
  if (!panelHovering) {
    panelHovering = true;
    window.inspieye.panel.notifyHoverEnter();
  }
});

document.addEventListener('mouseout', (e) => {
  // Only trigger if cursor actually left the document
  if (!e.relatedTarget && !e.toElement) {
    panelHovering = false;
    window.inspieye.panel.notifyHoverLeave();
  }
});

// Also listen for mouseleave on documentElement as backup
document.documentElement.addEventListener('mouseleave', () => {
  if (panelHovering) {
    panelHovering = false;
    window.inspieye.panel.notifyHoverLeave();
  }
});

// ── Tab switching ──
const clearFavBtn = document.getElementById('clearFavBtn');

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentTab = tab.dataset.tab;
    // Show/hide clear favorites button
    if (clearFavBtn) {
      clearFavBtn.style.display = currentTab === 'favorites' && favoriteItems.length > 0 ? 'flex' : 'none';
    }
    renderContent();
  });
});

// ── Category filter ──
document.querySelectorAll('.filter-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    currentCategory = chip.dataset.cat;
    renderContent();
  });
});

// ── Header buttons ──
document.getElementById('refreshBtn').addEventListener('click', async () => {
  const btn = document.getElementById('refreshBtn');
  btn.classList.add('refreshing');
  showRefreshBar();
  try {
    await window.inspieye.settings.triggerFetch();
    await loadContent();
  } finally {
    btn.classList.remove('refreshing');
  }
});

document.getElementById('openImageFolderBtn').addEventListener('click', async () => {
  await window.inspieye.panel.openImageFolder();
});

document.getElementById('settingsBtn').addEventListener('click', () => {
  window.inspieye.panel.openSettings();
});

document.getElementById('emptySettingsBtn').addEventListener('click', () => {
  window.inspieye.panel.openSettings();
});

// ── Clear favorites ──
if (clearFavBtn) {
  clearFavBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const count = favoriteItems.length;
    if (!count) return;
    if (!confirm(`确定要清空全部 ${count} 条收藏吗？\n\n本地已下载的图片不会被删除。`)) return;
    try {
      await window.inspieye.data.clearFavorites();
      favoriteItems = [];
      clearFavBtn.style.display = 'none';
      renderContent();
    } catch (err) {
      console.error('[panel] Failed to clear favorites:', err);
    }
  });
}

// ── Load content ──
let _loading = false;
let _needsReload = false;
// Guids of items whose images are already downloaded to local disk (checked on each loadContent)
let _downloadedGuids = new Set();

async function loadContent() {
  // Prevent concurrent loads — if already loading, flag a reload and bail
  if (_loading) {
    _needsReload = true;
    return;
  }
  _loading = true;
  _needsReload = false;

  // Refresh category chips in case categories changed in settings
  await renderCategoryChips();

  loadingState.style.display = 'flex';
  emptyState.style.display   = 'none';
  contentArea.innerHTML     = '';
  contentArea.appendChild(loadingState);
  _bottomFired = false;

  try {
    allItems     = await window.inspieye.data.getItems({ category: currentCategory });
    favoriteItems = await window.inspieye.data.getFavorites();

    // Check which items already have downloaded images on disk
    const dlCheckItems = allItems.map(item => ({ guid: item.guid, image: item.image, category: item.category }));
    const dlGuids = await window.inspieye.data.getDownloadedGuids(dlCheckItems);
    _downloadedGuids = new Set(dlGuids);

    // Update unread badge
    const unreadCount = await window.inspieye.data.getUnreadCount();
    if (unreadCount > 0) {
      unreadBadge.textContent = unreadCount;
      unreadBadge.style.display  = 'inline-block';
    } else {
      unreadBadge.style.display = 'none';
    }

    renderContent();
  } catch (err) {
    console.error('[panel] Failed to load content:', err);
    loadingState.style.display = 'none';
    emptyState.style.display   = 'flex';
    // Show error in empty state
    const title = emptyState.querySelector('.empty-title');
    const desc  = emptyState.querySelector('.empty-desc');
    if (title) title.textContent = '加载失败';
    if (desc)  desc.textContent  = err.message || '请检查设置中的内容源';
  } finally {
    _loading = false;
    // If a reload was requested while we were loading, do it now
    if (_needsReload) {
      _needsReload = false;
      loadContent();
    }
  }
}

// ── Render content ──
function renderContent() {
  let items;
  if (currentTab === 'favorites') {
    items = favoriteItems.map(item => ({ ...item, isFavorite: true }));
  } else {
    items = allItems;
  }

  // Filter by category
  if (currentCategory !== 'all') {
    items = items.filter(item => {
      const cat  = (item.category || '').toLowerCase();
      const cats = (item.categories || []).map(c => c.toLowerCase());
      return cat === currentCategory.toLowerCase() || cats.includes(currentCategory.toLowerCase());
    });
  }

  // In "最新" tab, hide items whose images are already downloaded to local disk
  if (currentTab !== 'favorites') {
    items = items.filter(item => !_downloadedGuids.has(item.guid));
  }

  if (!items || items.length === 0) {
    // If first content update hasn't arrived yet, keep showing loading
    if (!_initialLoadComplete) {
      loadingState.style.display = 'flex';
      return;
    }
    loadingState.style.display = 'none';
    emptyState.style.display = 'flex';
    contentArea.innerHTML     = '';
    contentArea.appendChild(emptyState);

    const title = emptyState.querySelector('.empty-title');
    const desc  = emptyState.querySelector('.empty-desc');
    if (currentTab === 'favorites') {
      if (title) title.textContent = '还没有收藏';
      if (desc)  desc.textContent  = '浏览灵感时点击心形按钮即可收藏';
    } else {
      if (title) title.textContent = '还没有灵感内容';
      if (desc)  desc.textContent  = '请在设置中添加内容源，或等待自动更新';
    }
    return;
  }

  // Content loaded successfully — mark initial load as complete
  _initialLoadComplete = true;

  loadingState.style.display = 'none';

  emptyState.style.display = 'none';
  contentArea.innerHTML     = '';
  const grid = document.createElement('div');
  grid.className = 'card-grid';

  // "全部" 最多展示 200 条，单个分类最多 40 条
  const limit = (currentCategory === 'all') ? 200 : 40;
  items.slice(0, limit).forEach((item, index) => {
    const card = createCard(item, index);
    grid.appendChild(card);
  });

  contentArea.appendChild(grid);
  setupCardObserver();
  setupBottomScrollHandler();
}

// ── Create card element ──
function createCard(item, index) {
  const card = document.createElement('div');
  card.className = 'case-card';
  card.dataset.guid = item.guid || '';
  if (!item.isRead) card.classList.add('unread');
  card.style.animationDelay = `${Math.min(index * 30, 300)}ms`;

  // Image
  const imgContainer = document.createElement('div');
  imgContainer.className = 'card-image';

  if (item.image || item.localImage) {
    const img = document.createElement('img');
    // Use locally cached image if available, otherwise use URL
    if (item.localImage) {
      // Normalize file:// URL to correct format (file:///D:/path)
      let fileUrl = item.localImage;
      if (fileUrl.startsWith('file://') && !fileUrl.startsWith('file:///')) {
        // Fix old format: file://D:/... → file:///D:/...
        fileUrl = 'file:///' + fileUrl.slice(7).replace(/\\/g, '/');
      } else if (!fileUrl.startsWith('file://')) {
        // Plain path: D:\... → file:///D:/...
        fileUrl = 'file:///' + fileUrl.replace(/\\/g, '/').replace(/^\//, '');
      }
      img.src = fileUrl;
    } else {
      img.src = item.image;
    }
    img.alt     = item.title;
    img.loading = 'lazy';
    img.onerror = () => {
      imgContainer.innerHTML = `<div class="card-image-placeholder">无预览图</div>`;
      const source = document.createElement('div');
      source.className = 'card-source';
      source.textContent = getSourceShort(item.sourceName);
      imgContainer.appendChild(source);
    };
    img.onload = () => {
      const source = document.createElement('div');
      source.className = 'card-source';
      source.textContent = getSourceShort(item.sourceName);
      // Avoid duplicate source labels
      if (!imgContainer.querySelector('.card-source')) {
        imgContainer.appendChild(source);
      }
    };
    imgContainer.appendChild(img);
  } else {
    imgContainer.innerHTML = `<div class="card-image-placeholder">无预览图</div>`;
    const source = document.createElement('div');
    source.className = 'card-source';
    source.textContent = getSourceShort(item.sourceName);
    imgContainer.appendChild(source);
  }

  // Favorite button
  const favBtn = document.createElement('button');
  favBtn.className = 'card-fav-btn';
  favBtn.title = '收藏并下载图片到本地';
  if (item.isFavorite) favBtn.classList.add('favorited');
  favBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>`;
  favBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFavorite(item, favBtn);
  });
  imgContainer.appendChild(favBtn);

  card.appendChild(imgContainer);

  // Info
  const info = document.createElement('div');
  info.className = 'card-info';

  const title = document.createElement('div');
  title.className = 'card-title';
  title.textContent = item.title || '无标题';

  const author = document.createElement('div');
  author.className = 'card-author';
  author.textContent = item.author || item.sourceName || '未知来源';

  info.appendChild(title);
  info.appendChild(author);
  card.appendChild(info);

  // Click to open URL
  card.addEventListener('click', () => {
    if (item.link) {
      window.inspieye.panel.openUrl(item.link);
    }
  });

  return card;
}

// ── Toggle favorite ──
async function toggleFavorite(item, btn) {
  const favorites = await window.inspieye.data.toggleFavorite(item);
  const isFav = favorites.some(f => f.guid === item.guid);

  if (isFav) {
    btn.classList.add('favorited');
    btn.classList.add('downloading');
    setTimeout(() => btn.classList.remove('downloading'), 1500);
    _downloadedGuids.add(item.guid);

    // ── Collect-to-favorites fly animation ──
    const card = btn.closest('.case-card');
    const favTab = document.querySelector('.tab[data-tab="favorites"]');
    if (card && favTab) {
      playCollectAnimation(card, favTab, () => {
        renderContent();
      });
      // Don't call renderContent() yet — animation will trigger it on complete
      favoriteItems = favorites;
      if (clearFavBtn && currentTab === 'favorites') {
        clearFavBtn.style.display = favoriteItems.length > 0 ? 'flex' : 'none';
      }
      return;
    }
  } else {
    btn.classList.remove('favorited');
  }

  // Always update favoriteItems so switching to favorites tab shows fresh data
  favoriteItems = favorites;

  // Update clear button visibility
  if (clearFavBtn && currentTab === 'favorites') {
    clearFavBtn.style.display = favoriteItems.length > 0 ? 'flex' : 'none';
  }

  // If on favorites tab, re-render immediately; if on "最新" tab, also re-render
  if (currentTab === 'favorites') {
    renderContent();
  } else if (isFav) {
    renderContent();
  }
}

// ── Collect-to-favorites fly animation ──
function playCollectAnimation(card, targetEl, onComplete) {
  const cardRect = card.getBoundingClientRect();
  const targetRect = targetEl.getBoundingClientRect();

  // Create a lightweight visual clone
  const clone = card.cloneNode(true);
  clone.classList.add('card-fly-clone');
  clone.style.position = 'fixed';
  clone.style.left = cardRect.left + 'px';
  clone.style.top = cardRect.top + 'px';
  clone.style.width = cardRect.width + 'px';
  clone.style.height = cardRect.height + 'px';
  clone.style.zIndex = '9999';
  clone.style.pointerEvents = 'none';
  clone.style.margin = '0';

  // Hide the hover effects on the clone
  clone.style.transform = 'none';
  clone.style.boxShadow = '0 8px 32px rgba(0,0,0,0.25)';

  document.body.appendChild(clone);

  // Fade original in place
  card.style.transition = 'opacity 0.2s ease';
  card.style.opacity = '0.3';

  // Fly towards the "收藏" tab center
  const targetCX = targetRect.left + targetRect.width / 2;
  const targetCY = targetRect.top + targetRect.height / 2;
  const cardCX = cardRect.left + cardRect.width / 2;
  const cardCY = cardRect.top + cardRect.height / 2;
  const dx = targetCX - cardCX;
  const dy = targetCY - cardCY;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      clone.style.transform = `translate(${dx}px, ${dy}px) scale(0.12)`;
      clone.style.opacity = '0.6';
      clone.style.borderRadius = '12px';
    });
  });

  setTimeout(() => {
    clone.style.opacity = '0';
    clone.style.transform = `translate(${dx}px, ${dy}px) scale(0.08)`;
  }, 400);

  setTimeout(() => {
    clone.remove();
    // Restore original card opacity for when it re-renders
    card.style.opacity = '';
    card.style.transition = '';
    if (onComplete) onComplete();
  }, 600);
}

// ── Helpers ──
function debugLog(...args) {
  console.log('[panel]', ...args);
}

function getSourceShort(name) {
  if (!name) return '';
  if (name.length <= 12) return name;
  const parts = name.split(/\s+/);
  if (parts.length > 1) return parts[0];
  return name.substring(0, 10) + '...';
}

function showRefreshBar() {
  const bar = document.createElement('div');
  bar.className = 'refresh-bar';
  document.querySelector('.panel').appendChild(bar);
  setTimeout(() => bar.remove(), 1500);
}

// ── Theme ──
window.inspieye.settings.onThemeChanged((theme) => {
  applyThemeClass(theme);
});

function applyThemeClass(theme) {
  console.log('[panel] applyThemeClass:', theme, '| body.class:', document.body.className, '| data-skin:', document.body.getAttribute('data-skin'));
  if (theme === 'dark') {
    document.body.classList.add('dark');
  } else if (theme === 'light') {
    document.body.classList.remove('dark');
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.body.classList.toggle('dark', prefersDark);
  }
  console.log('[panel] after applyThemeClass: body.class:', document.body.className, '| data-skin:', document.body.getAttribute('data-skin'));
}

// ── Track whether first content update has arrived ──
let _initialLoadComplete = false;

// ── Listen for content updates from main process ──
window.inspieye.panel.onContentUpdated(() => {
  debugLog('[panel] content:updated received, reloading...');
  _initialLoadComplete = true;   // Fetch cycle finished — stop guarding against empty
  loadContent();
});

// ── Initialize ──
async function init() {
  try {
    const settings = await window.inspieye.settings.get();
    applyThemeClass(settings.theme);

    // Set data-skin in the SAME tick as theme — no race condition
    const skin = settings.petSkin || 'mint';
    document.body.setAttribute('data-skin', skin);
    console.log('[panel] init: set data-skin =', skin);

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (settings.theme === 'system') applyThemeClass('system');
    });

    await loadContent();

    // Fallback: if still no content:updated after 30s, give up and show empty state
    // (only needed when no sources are configured — normal fetches will send content:updated)
    if (!_initialLoadComplete) {
      setTimeout(() => {
        if (!_initialLoadComplete) {
          _initialLoadComplete = true;
          renderContent();
        }
      }, 30000);
    }
  } catch (err) {
    console.error('[panel] init() failed:', err);
    // Show error in the panel so user can see it
    if (emptyState) {
      emptyState.style.display = 'flex';
      const title = emptyState.querySelector('.empty-title');
      const desc  = emptyState.querySelector('.empty-desc');
      if (title) title.textContent = '初始化失败';
      if (desc)  desc.textContent  = String(err.message || err);
    }
  }
}

init();
