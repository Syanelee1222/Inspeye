// ═══════════════════════════════════════
//  Settings Window Logic
// ═══════════════════════════════════════

let settings = null;

const SKINS = [
  { id: 'mint', name: '薄荷绿' },
  { id: 'sunset', name: '日落橙' },
  { id: 'ocean', name: '海洋蓝' },
  { id: 'mono', name: '极简灰' },
  { id: 'sakura', name: '樱花粉' },
  { id: 'lavender', name: '薰衣草紫' }
];

// Fixed 5 categories
const FIXED_CATEGORIES = [
  { id: 'design', name: '设计', downloadImage: false },
  { id: 'illustration', name: '插画', downloadImage: true },
  { id: 'concept', name: '概念', downloadImage: false },
  { id: 'interaction', name: '交互', downloadImage: false },
  { id: 'ai', name: 'AI', downloadImage: false }
];

// Skin gradient colors for about mascot (matches skin-preview CSS)
const SKIN_GRADIENTS = {
  mint:    ['#00E0A8', '#00A878'],
  sunset:  ['#FF8C42', '#FF6B35'],
  ocean:   ['#3399FF', '#0066CC'],
  mono:    ['#888888', '#555555'],
  sakura:  ['#FF85C2', '#FF69B4'],
  lavender:['#BB77DD', '#9B59B6']
};

// ── Title bar buttons ──
document.getElementById('closeBtn').addEventListener('click', () => {
  window.inspieye.settings.close();
});

document.getElementById('minimizeBtn').addEventListener('click', () => {
  window.inspieye.settings.minimize();
});

// ── Navigation ──
document.querySelectorAll('.nav-item').forEach(nav => {
  nav.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    nav.classList.add('active');
    document.getElementById(`section-${nav.dataset.section}`).classList.add('active');
  });
});

// ═══════════════════════════════════════
//  Category select (fixed 5 categories)
// ═══════════════════════════════════════

function updateCategorySelect() {
  const select = document.getElementById('sourceCategory');
  if (!select) return;
  select.innerHTML = '';
  FIXED_CATEGORIES.forEach(cat => {
    const option = document.createElement('option');
    option.value = cat.id;
    option.textContent = cat.name;
    select.appendChild(option);
  });
}

// ═══════════════════════════════════════
//  Sources Management
// ═══════════════════════════════════════

function renderSources() {
  const list = document.getElementById('sourceList');
  list.innerHTML = '';

  if (!settings.sources || settings.sources.length === 0) {
    list.innerHTML = '<p style="color:var(--text-tertiary);font-size:13px;padding:12px;">暂无内容源，请添加 RSS 订阅链接</p>';
    return;
  }

  // Build category name map
  const catNameMap = {};
  FIXED_CATEGORIES.forEach(c => { catNameMap[c.id] = c.name; });

  settings.sources.forEach((source, index) => {
    const item = document.createElement('div');
    item.className = 'source-item';

    const catName = catNameMap[source.category] || source.category || '设计';

    item.innerHTML = `
      <div class="source-info">
        <div class="source-name">${escapeHtml(source.name)}</div>
        <div class="source-url">${escapeHtml(source.url)}</div>
      </div>
      <div class="source-meta">
        <span class="source-category">${escapeHtml(catName)}</span>
        <button class="source-dl-btn ${source.downloadImage ? 'active' : ''}" data-index="${index}" data-tooltip="收藏某个灵感时，同步下载其图片">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </button>
        <label class="source-toggle">
          <input type="checkbox" ${source.enabled !== false ? 'checked' : ''} data-index="${index}">
          <span class="source-toggle-slider"></span>
        </label>
        <button class="source-delete" data-index="${index}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
          </svg>
        </button>
      </div>
    `;

    list.appendChild(item);
  });

  // Toggle handlers (enable/disable source)
  list.querySelectorAll('.source-toggle input').forEach(input => {
    input.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.index);
      settings.sources[idx].enabled = e.target.checked;
      window.inspieye.settings.set('sources', settings.sources);
    });
  });

  // Download image toggle handlers (icon button)
  list.querySelectorAll('.source-dl-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const idx = parseInt(e.currentTarget.dataset.index);
      settings.sources[idx].downloadImage = !settings.sources[idx].downloadImage;
      window.inspieye.settings.set('sources', settings.sources);
      // Toggle visual state
      if (settings.sources[idx].downloadImage) {
        e.currentTarget.classList.add('active');
      } else {
        e.currentTarget.classList.remove('active');
      }
    });
  });

  // Delete handlers
  list.querySelectorAll('.source-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.currentTarget.dataset.index);
      settings.sources.splice(idx, 1);
      window.inspieye.settings.set('sources', settings.sources);
      renderSources();
    });
  });
}

document.getElementById('addSourceBtn').addEventListener('click', async () => {
  const name = document.getElementById('sourceName').value.trim();
  const url = document.getElementById('sourceUrl').value.trim();
  const category = document.getElementById('sourceCategory').value;

  if (!name || !url) return;

  // Look up category default for downloadImage
  const cat = FIXED_CATEGORIES.find(c => c.id === category);
  const downloadImage = cat ? cat.downloadImage : false;

  settings.sources.push({
    id: 'source-' + Date.now(),
    name,
    url,
    type: 'rss',
    category,
    downloadImage,
    enabled: true
  });

  await window.inspieye.settings.set('sources', settings.sources);

  document.getElementById('sourceName').value = '';
  document.getElementById('sourceUrl').value = '';

  renderSources();
});

// ═══════════════════════════════════════
//  Keywords Management
// ═══════════════════════════════════════

function renderKeywords() {
  const list = document.getElementById('keywordList');
  list.innerHTML = '';

  if (!settings.keywords || settings.keywords.length === 0) {
    list.innerHTML = '<p style="color:var(--text-tertiary);font-size:13px;">暂无关键词</p>';
    return;
  }

  settings.keywords.forEach((kw, index) => {
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.innerHTML = `
      ${escapeHtml(kw)}
      <button class="tag-remove" data-index="${index}">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    `;
    list.appendChild(tag);
  });

  list.querySelectorAll('.tag-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.currentTarget.dataset.index);
      settings.keywords.splice(idx, 1);
      window.inspieye.settings.set('keywords', settings.keywords);
      renderKeywords();
    });
  });
}

document.getElementById('addKeywordBtn').addEventListener('click', async () => {
  const input = document.getElementById('keywordInput');
  const value = input.value.trim();
  if (!value) return;

  // Support comma-separated input
  const keywords = value.split(',').map(k => k.trim()).filter(Boolean);
  settings.keywords = [...new Set([...settings.keywords, ...keywords])];

  await window.inspieye.settings.set('keywords', settings.keywords);
  input.value = '';
  renderKeywords();
});

document.getElementById('keywordInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    document.getElementById('addKeywordBtn').click();
  }
});

// ═══════════════════════════════════════
//  Artists Management
// ═══════════════════════════════════════

function renderArtists() {
  const list = document.getElementById('artistList');
  list.innerHTML = '';

  if (!settings.artists || settings.artists.length === 0) {
    list.innerHTML = '<p style="color:var(--text-tertiary);font-size:13px;">暂无关注的艺术家</p>';
    return;
  }

  settings.artists.forEach((artist, index) => {
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.innerHTML = `
      ${escapeHtml(artist)}
      <button class="tag-remove" data-index="${index}">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    `;
    list.appendChild(tag);
  });

  list.querySelectorAll('.tag-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.currentTarget.dataset.index);
      settings.artists.splice(idx, 1);
      window.inspieye.settings.set('artists', settings.artists);
      renderArtists();
    });
  });
}

document.getElementById('addArtistBtn').addEventListener('click', async () => {
  const input = document.getElementById('artistInput');
  const value = input.value.trim();
  if (!value) return;

  settings.artists = [...new Set([...settings.artists, value])];
  await window.inspieye.settings.set('artists', settings.artists);
  input.value = '';
  renderArtists();
});

document.getElementById('artistInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    document.getElementById('addArtistBtn').click();
  }
});

// ═══════════════════════════════════════
//  Appearance — Skin & Theme
// ═══════════════════════════════════════

function renderSkins() {
  const grid = document.getElementById('skinGrid');
  grid.innerHTML = '';

  SKINS.forEach(skin => {
    const option = document.createElement('div');
    option.className = 'skin-option';
    if (settings.petSkin === skin.id) option.classList.add('active');
    option.innerHTML = `
      <div class="skin-preview ${skin.id}"></div>
      <span class="skin-name">${skin.name}</span>
    `;
    option.addEventListener('click', async () => {
      settings.petSkin = skin.id;
      await window.inspieye.settings.set('petSkin', skin.id);
      grid.querySelectorAll('.skin-option').forEach(o => o.classList.remove('active'));
      option.classList.add('active');

      // Update data-skin attribute on settings window
      document.body.setAttribute('data-skin', skin.id);

      // Update about page mascot color
      updateAboutMascot(skin.id);

      // Notify panel to update skin
      window.inspieye.settings.set('petSkin', skin.id);
    });
    grid.appendChild(option);
  });
}

function renderTheme() {
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === settings.theme);
    btn.addEventListener('click', async () => {
      settings.theme = btn.dataset.theme;
      await window.inspieye.settings.set('theme', settings.theme);
      document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyThemeClass(settings.theme);
    });
  });
}

function applyThemeClass(theme) {
  if (theme === 'dark') {
    document.body.classList.add('dark');
  } else if (theme === 'light') {
    document.body.classList.remove('dark');
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.body.classList.toggle('dark', prefersDark);
  }
}

// ═══════════════════════════════════════
// ═══════════════════════════════════════
//  General Settings
// ═══════════════════════════════════════

function renderInterval() {
  const hoursSelect = document.getElementById('intervalHours');
  const minutesSelect = document.getElementById('intervalMinutes');

  // Populate hours 1-24
  hoursSelect.innerHTML = '';
  for (let h = 1; h <= 24; h++) {
    const opt = document.createElement('option');
    opt.value = h;
    opt.textContent = h;
    hoursSelect.appendChild(opt);
  }

  // Populate minutes 0/15/30/45
  minutesSelect.innerHTML = '';
  [0, 15, 30, 45].forEach(m => {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    minutesSelect.appendChild(opt);
  });

  // Set current values
  hoursSelect.value = settings.intervalHours || 1;
  minutesSelect.value = settings.intervalMinutes || 0;

  // Save on change
  hoursSelect.addEventListener('change', async () => {
    settings.intervalHours = parseInt(hoursSelect.value);
    await window.inspieye.settings.set('intervalHours', settings.intervalHours);
  });
  minutesSelect.addEventListener('change', async () => {
    settings.intervalMinutes = parseInt(minutesSelect.value);
    await window.inspieye.settings.set('intervalMinutes', settings.intervalMinutes);
  });
}

function renderScheduledPush() {
  const toggle = document.getElementById('scheduledPushToggle');
  const config = document.getElementById('scheduledPushConfig');
  const timeInput = document.getElementById('scheduledPushTime');
  const typeBtns = document.querySelectorAll('.sp-type-btn');
  const weekdayRow = document.getElementById('spWeekdayRow');
  const weekdayBtns = document.querySelectorAll('.weekday-btn');

  // Set initial state
  toggle.checked = settings.scheduledPushEnabled === true;
  config.style.display = toggle.checked ? 'block' : 'none';

  toggle.addEventListener('change', async (e) => {
    settings.scheduledPushEnabled = e.target.checked;
    await window.inspieye.settings.set('scheduledPushEnabled', e.target.checked);
    config.style.display = e.target.checked ? 'block' : 'none';
  });

  // Set time
  timeInput.value = settings.scheduledPushTime || '09:00';
  timeInput.addEventListener('change', async () => {
    settings.scheduledPushTime = timeInput.value;
    await window.inspieye.settings.set('scheduledPushTime', timeInput.value);
  });

  // Set type (daily/weekly)
  const pushType = settings.scheduledPushType || 'daily';
  typeBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === pushType);
    btn.addEventListener('click', async () => {
      const type = btn.dataset.type;
      settings.scheduledPushType = type;
      await window.inspieye.settings.set('scheduledPushType', type);
      typeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      weekdayRow.style.display = type === 'weekly' ? 'flex' : 'none';
    });
  });
  weekdayRow.style.display = pushType === 'weekly' ? 'flex' : 'none';

  // Set weekdays
  const activeDays = settings.scheduledPushWeekdays || [];
  weekdayBtns.forEach(btn => {
    const day = parseInt(btn.dataset.day);
    btn.classList.toggle('active', activeDays.includes(day));
    btn.addEventListener('click', async () => {
      const days = settings.scheduledPushWeekdays || [];
      const idx = days.indexOf(day);
      if (idx >= 0) {
        days.splice(idx, 1);
      } else {
        days.push(day);
      }
      settings.scheduledPushWeekdays = days;
      await window.inspieye.settings.set('scheduledPushWeekdays', days);
      btn.classList.toggle('active');
    });
  });
}

function renderToggles() {
  const notifToggle = document.getElementById('notificationsToggle');
  notifToggle.checked = settings.notifications !== false;
  notifToggle.addEventListener('change', async (e) => {
    settings.notifications = e.target.checked;
    await window.inspieye.settings.set('notifications', e.target.checked);
  });

  const autoLaunchToggle = document.getElementById('autoLaunchToggle');
  autoLaunchToggle.checked = settings.autoLaunch === true;
  autoLaunchToggle.addEventListener('change', async (e) => {
    settings.autoLaunch = e.target.checked;
    await window.inspieye.settings.set('autoLaunch', e.target.checked);
  });

  document.getElementById('cachePathInput').value = settings.cachePath || 'D:\\inspieye';

  // Browse button for cache path
  document.getElementById('browseCacheBtn').addEventListener('click', async () => {
    const chosen = await window.inspieye.settings.selectCacheDir();
    if (chosen) {
      document.getElementById('cachePathInput').value = chosen;
      settings.cachePath = chosen;
      await window.inspieye.settings.set('cachePath', chosen);
    }
  });

  // Auto-save cache path on input change
  document.getElementById('cachePathInput').addEventListener('change', async (e) => {
    const newPath = e.target.value.trim();
    if (!newPath) return;
    settings.cachePath = newPath;
    await window.inspieye.settings.set('cachePath', newPath);
  });
}

document.getElementById('fetchNowBtn').addEventListener('click', async () => {
  const btn = document.getElementById('fetchNowBtn');
  btn.textContent = '正在更新...';
  btn.disabled = true;
  const result = await window.inspieye.settings.triggerFetch();
  if (result && result.success) {
    if (result.errors && result.errors.length > 0) {
      const failNames = result.errors.map(e => e.source).join('、');
      const totalSources = (settings.sources || []).length;
      const okCount = totalSources - result.errors.length;
      if (result.itemCount > 0) {
        btn.textContent = `完成（${okCount}/${totalSources} 成功，${failNames} 失败）— 共 ${result.itemCount} 条`;
      } else {
        btn.textContent = `完成（${okCount}/${totalSources} 成功，${failNames} 失败）`;
      }
    } else if (result.newCount > 0) {
      btn.textContent = `获取了 ${result.newCount} 条新内容！共 ${result.itemCount || 0} 条`;
    } else {
      btn.textContent = '完成，暂无新内容';
    }
  } else {
    btn.textContent = '更新失败，请检查内容源';
  }
  setTimeout(() => {
    btn.textContent = '立即更新灵感';
    btn.disabled = false;
  }, 2500);
});

//  About mascot — dynamic skin color
// ═══════════════════════════════════════

function updateAboutMascot(skinId) {
  const svg = document.getElementById('aboutPetSvg');
  if (!svg) return;
  const colors = SKIN_GRADIENTS[skinId] || SKIN_GRADIENTS.mint;
  const stop1 = svg.querySelector('#aboutGradStop1');
  const stop2 = svg.querySelector('#aboutGradStop2');
  if (stop1) stop1.setAttribute('stop-color', colors[0]);
  if (stop2) stop2.setAttribute('stop-color', colors[1]);
}

// ═══════════════════════════════════════
//  Theme listener
// ═══════════════════════════════════════

window.inspieye.settings.onThemeChanged((theme) => {
  applyThemeClass(theme);
});

// ═══════════════════════════════════════
//  Init
// ═══════════════════════════════════════

async function init() {
  settings = await window.inspieye.settings.get();
  applyThemeClass(settings.theme);

  // ── Ensure default categories exist in settings ──
  // Categories are fixed (5 types), but we still store them in settings.json
  // so the panel can read them.
  const defaultCats = FIXED_CATEGORIES.map(c => ({ ...c }));
  if (!settings.categories || !Array.isArray(settings.categories) || settings.categories.length === 0) {
    settings.categories = defaultCats;
    await window.inspieye.settings.set('categories', settings.categories);
  }

  // Set initial skin attribute
  document.body.setAttribute('data-skin', settings.petSkin || 'mint');

  // Update about mascot to match current skin
  updateAboutMascot(settings.petSkin || 'mint');

  updateCategorySelect();
  renderSources();
  renderKeywords();
  renderArtists();
  renderSkins();
  renderTheme();
  renderInterval();
  renderScheduledPush();
  renderToggles();
}

// ── Helpers ──
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

init();
