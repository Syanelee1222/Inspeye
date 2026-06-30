// ═══════════════════════════════════════════
//  Pet Window Logic
// ═══════════════════════════════════════════

const SKINS = {
  mint: {
    stops: [{ offset: '0%', color: '#00E0A8' }, { offset: '100%', color: '#00A878' }],
    bodyClass: ''
  },
  sunset: {
    stops: [{ offset: '0%', color: '#FF8E53' }, { offset: '100%', color: '#FF6B6B' }],
    bodyClass: 'skin-sunset'
  },
  ocean: {
    stops: [{ offset: '0%', color: '#5BA8F5' }, { offset: '100%', color: '#357ABD' }],
    bodyClass: 'skin-ocean'
  },
  mono: {
    stops: [{ offset: '0%', color: '#999' }, { offset: '100%', color: '#555' }],
    bodyClass: 'skin-mono'
  },
  sakura: {
    stops: [{ offset: '0%', color: '#FFB7C5' }, { offset: '100%', color: '#FF6B9D' }],
    bodyClass: 'skin-sakura'
  },
  lavender: {
    stops: [{ offset: '0%', color: '#C39BD3' }, { offset: '100%', color: '#9B59B6' }],
    bodyClass: 'skin-lavender'
  }
};

let hoverTimer = null;
let isHovering = false;

// ── Apply skin ──
function applySkin(skinId) {
  const skin = SKINS[skinId] || SKINS.mint;
  const gradient = document.getElementById('petGradient');

  // Update gradient stops
  gradient.innerHTML = '';
  skin.stops.forEach(stop => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    el.setAttribute('offset', stop.offset);
    el.setAttribute('stop-color', stop.color);
    gradient.appendChild(el);
  });

  // Update body class for shadow color
  document.body.className = document.body.className.replace(/skin-\w+/g, '').trim();
  if (skin.bodyClass) {
    document.body.classList.add(skin.bodyClass);
  }
}

// ── Hover detection ──
// NOTE: -webkit-app-region: drag on body intercepts mouseenter/mouseleave.
// Hover detection is handled by main process cursor polling (startHoverCheck in main.js).
// This function is kept for right-click only.
function setupHover() {
  // No-op — main process handles hover via screen.getCursorScreenPoint() polling
}

// ── Right-click context menu ──
function setupContextMenu() {
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    window.inspieye.pet.onRightClick();
  });
}

// ── Notification dot ──
function updateNotificationDot(count) {
  const dot = document.getElementById('notifDot');
  if (!dot) return;
  if (count > 0) {
    dot.classList.add('visible');
    dot.textContent = count > 99 ? '99+' : '';
  } else {
    dot.classList.remove('visible');
  }
}

// Listen for immediate unread count updates from main process
window.inspieye.pet.onUnreadChanged((count) => {
  updateNotificationDot(count);
});

// ── Periodic update of notification dot (backup) ──
function startNotificationCheck() {
  window.inspieye.data.getUnreadCount().then(count => {
    updateNotificationDot(count);
  });
  setInterval(() => {
    window.inspieye.data.getUnreadCount().then(count => {
      updateNotificationDot(count);
    });
  }, 30000); // Check every 30s as backup
}

// ── Listen for skin changes from main ──
window.inspieye.pet.onSkinChanged((skin) => {
  applySkin(skin);
});

// ── Listen for theme changes ──
window.inspieye.settings.onThemeChanged((theme) => {
  // Pet doesn't change much with theme, but we could adjust
});

// ── Initialize ──
async function init() {
  const settings = await window.inspieye.settings.get();
  applySkin(settings.petSkin || 'mint');

  setupHover();
  setupContextMenu();
  startNotificationCheck();
}

init();
