'use strict';

/* ─── ContentGuard — content.js (v3) ─────────────────────────────────────
   Nouveautés :
   - Détection des attributs `alt` des images
   - Scan des URLs des médias (images, vidéos, iframes)
   - Détection par COMBINAISONS de mots (contexte)
   - Zones de contexte : regroupe les éléments proches
   ─────────────────────────────────────────────────────────────────────── */

let blockShown  = false;
let lastUrl     = location.href;
let domObserver = null;
let settings    = null;

async function loadSettings() {
  try {
    settings = await chrome.storage.sync.get({
      blockedWords:       [],
      blockedCombos:      [],
      blockedUrlPatterns: [],
      enabled:            true,
      caseSensitive:      false,
      wholeWordOnly:      false,
      scanMediaUrls:      true,
      scanImageAlt:       true,
      contextThreshold:   2
    });
  } catch (_) {
    settings = {
      blockedWords: [], blockedCombos: [], blockedUrlPatterns: [],
      enabled: false, scanMediaUrls: true, scanImageAlt: true
    };
  }
  return settings;
}

/* ═══════════════════════════════════════════════════════════════════
   SCAN ÉTENDU
   ═══════════════════════════════════════════════════════════════════ */

function getPageText() {
  if (!document.body) return { fullText: '', titleText: '', metaText: '', altText: '', mediaUrls: '' };

  const titleText = document.title || '';

  const metaText = [...document.querySelectorAll(
    'meta[name="description"], meta[property^="og:"], meta[name="keywords"]'
  )].map(m => m.getAttribute('content') || '').join(' ');

  let altText = '';
  if (settings.scanImageAlt) {
    altText = [...document.querySelectorAll('img[alt]')]
      .map(img => img.getAttribute('alt') || '')
      .filter(a => a.trim().length > 0)
      .join(' ');
  }

  let mediaUrls = '';
  if (settings.scanMediaUrls) {
    const mediaSelectors = [
      'img[src]', 'img[data-src]', 'img[data-original]',
      'video[src]', 'video source[src]',
      'audio[src]', 'audio source[src]',
      'iframe[src]', 'embed[src]', 'object[data]',
      '[style*="background-image"]'
    ];

    mediaUrls = mediaSelectors.flatMap(sel => {
      return [...document.querySelectorAll(sel)].map(el => {
        let url = el.src || el.getAttribute('src') || el.getAttribute('data-src') ||
                  el.getAttribute('data-original') || el.getAttribute('data') || '';
        if (!url && el.style.backgroundImage) {
          const match = el.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/);
          if (match) url = match[1];
        }
        return url;
      }).filter(u => u.length > 0);
    }).join(' ');
  }

  const bodyText = document.body.innerText || '';
  const fullText = [titleText, metaText, altText, bodyText].join(' ');

  return { fullText, titleText, metaText, altText, mediaUrls };
}

function containsWord(text, word) {
  const needle = settings.caseSensitive ? word : word.toLowerCase();
  const haystack = settings.caseSensitive ? text : text.toLowerCase();

  if (settings.wholeWordOnly) {
    const re = new RegExp(`(?<![\\wÀ-ÿ])${escapeRe(needle)}(?![\\wÀ-ÿ])`,
                           settings.caseSensitive ? '' : 'i');
    return re.test(text);
  }
  return haystack.includes(needle);
}

function countComboMatches(text, comboWords) {
  return comboWords.filter(word => containsWord(text, word)).length;
}

function scan() {
  if (blockShown || !settings || !settings.enabled) return;

  const { fullText, altText, mediaUrls } = getPageText();
  const foundWords = [];
  const foundCombos = [];
  const foundUrlPatterns = [];

  /* 1️⃣ Mots simples */
  const words = (settings.blockedWords || [])
    .map(w => w.trim())
    .filter(w => w.length > 0);

  for (const word of words) {
    if (containsWord(fullText, word)) foundWords.push(word);
  }

  /* 2️⃣ Combinaisons contextuelles */
  const combos = (settings.blockedCombos || [])
    .map(c => c.trim())
    .filter(c => c.length > 0);

  for (const combo of combos) {
    const comboWords = combo.split(/\s+/).filter(w => w.length > 0);
    if (comboWords.length < 2) continue;

    const matches = countComboMatches(fullText, comboWords);
    if (matches >= (settings.contextThreshold || 2)) {
      foundCombos.push(`${combo} (${matches}/${comboWords.length})`);
      continue;
    }

    const contextZones = document.querySelectorAll(
      'article, [data-testid="tweet"], [data-testid="post"], .post, .entry, ' +
      '[role="article"], .thread, .comment, .card, .stream-item, ' +
      'ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer'
    );

    for (const zone of contextZones) {
      const zoneText = zone.innerText || '';
      const zoneAlt = [...zone.querySelectorAll('img[alt]')]
        .map(img => img.getAttribute('alt') || '').join(' ');
      const zoneFull = zoneText + ' ' + zoneAlt;

      const zoneMatches = countComboMatches(zoneFull, comboWords);
      if (zoneMatches >= (settings.contextThreshold || 2)) {
        foundCombos.push(`${combo} [zone] (${zoneMatches}/${comboWords.length})`);
        break;
      }
    }
  }

  /* 3️⃣ Patterns dans URLs médias */
  const urlPatterns = (settings.blockedUrlPatterns || [])
    .map(p => p.trim())
    .filter(p => p.length > 0);

  const mediaUrlsLower = settings.caseSensitive ? mediaUrls : mediaUrls.toLowerCase();

  for (const pattern of urlPatterns) {
    const pat = settings.caseSensitive ? pattern : pattern.toLowerCase();
    if (mediaUrlsLower.includes(pat)) {
      foundUrlPatterns.push(`URL: ${pattern}`);
    }
    if (pattern.includes('*')) {
      const regexPattern = pattern
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\\\*/g, '.*');
      const re = new RegExp(regexPattern, settings.caseSensitive ? '' : 'i');
      if (re.test(mediaUrls)) foundUrlPatterns.push(`URL pattern: ${pattern}`);
    }
  }

  const totalFound = [...foundWords, ...foundCombos, ...foundUrlPatterns];
  if (totalFound.length > 0) {
    blockShown = true;
    stopObserver();
    showOverlay(totalFound, { words: foundWords, combos: foundCombos, urls: foundUrlPatterns });
  }
}

/* ── Démarrage ── */
async function start() {
  blockShown = false;
  const old = document.getElementById('contentguard-overlay');
  if (old) {
    old.remove();
    document.documentElement.style.overflow = '';
    if (document.body) document.body.style.overflow = '';
  }

  if (!settings) await loadSettings();
  if (!settings.enabled) return;
  if (!settings.blockedWords.length && !settings.blockedCombos.length && !settings.blockedUrlPatterns.length) return;

  scan();
  setTimeout(scan, 400);
  setTimeout(scan, 1200);
  setTimeout(scan, 3000);
  setTimeout(scan, 6000);
  setupObserver();
}

/* ── MutationObserver ── */
function setupObserver() {
  stopObserver();
  if (!document.body) return;

  let debounce;
  domObserver = new MutationObserver((mutations) => {
    if (blockShown) return;
    const hasNewMedia = mutations.some(m => {
      return [...m.addedNodes].some(node => {
        if (node.nodeType !== 1) return false;
        return node.matches?.('img, video, iframe, [style*="background-image"]') ||
               node.querySelector?.('img, video, iframe');
      });
    });
    clearTimeout(debounce);
    debounce = setTimeout(scan, hasNewMedia ? 150 : 350);
  });

  domObserver.observe(document.body, {
    childList:     true,
    subtree:       true,
    characterData: true
  });
}

function stopObserver() {
  if (domObserver) {
    domObserver.disconnect();
    domObserver = null;
  }
}

/* ── SPA navigation ── */
function onUrlChange() {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    start();
  }
}

(function patchHistory() {
  const wrap = (orig) => function (...args) {
    const result = orig.apply(this, args);
    setTimeout(onUrlChange, 80);
    return result;
  };
  try {
    history.pushState    = wrap(history.pushState);
    history.replaceState = wrap(history.replaceState);
  } catch (_) {}
})();

window.addEventListener('popstate',  () => setTimeout(onUrlChange, 80));
window.addEventListener('hashchange',() => setTimeout(onUrlChange, 80));

chrome.storage.onChanged.addListener((changes) => {
  const relevant = ['blockedWords','blockedCombos','blockedUrlPatterns',
                    'enabled','caseSensitive','wholeWordOnly',
                    'scanMediaUrls','scanImageAlt','contextThreshold'];
  if (relevant.some(k => changes[k])) {
    loadSettings().then(() => {
      blockShown = false;
      const old = document.getElementById('contentguard-overlay');
      if (old) {
        old.remove();
        document.documentElement.style.overflow = '';
        if (document.body) document.body.style.overflow = '';
      }
      start();
    });
  }
});

/* ── Overlay ── */
function showOverlay(foundItems, categories) {
  document.documentElement.style.setProperty('overflow', 'hidden', 'important');
  if (document.body) document.body.style.setProperty('overflow', 'hidden', 'important');

  const formatItems = (items, icon, color) => {
    if (!items || items.length === 0) return '';
    const badges = items.map(w =>
      `<span class="cg-badge" style="background:${color}20;border-color:${color}60;color:${color}">${esc(w)}</span>`
    ).join('');
    return `
      <div style="margin-bottom:16px">
        <div class="cg-section-label" style="color:${color}">${icon} ${items.length} détecté(s)</div>
        <div class="cg-badges">${badges}</div>
      </div>`;
  };

  const wordsSection = formatItems(categories?.words, '📝', '#fca5a5');
  const combosSection = formatItems(categories?.combos, '🔗', '#fbbf24');
  const urlsSection = formatItems(categories?.urls, '🖼️', '#67e8f9');

  const overlay = document.createElement('div');
  overlay.id = 'contentguard-overlay';
  overlay.innerHTML = `
<style>
  #contentguard-overlay {
    position: fixed !important; inset: 0 !important;
    width: 100vw !important; height: 100vh !important;
    z-index: 2147483647 !important;
    display: flex !important; align-items: center !important; justify-content: center !important;
    background: linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #1a1042 100%) !important;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif !important;
  }
  #contentguard-overlay * { box-sizing: border-box; margin: 0; padding: 0; }
  .cg-card {
    background: rgba(255,255,255,0.06); backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
    border: 1px solid rgba(255,255,255,0.1); border-radius: 22px;
    padding: 32px 40px; max-width: 520px; width: calc(100vw - 40px);
    max-height: 90vh; overflow-y: auto;
    text-align: center; color: #e8e8f4;
    box-shadow: 0 32px 80px rgba(0,0,0,0.55);
  }
  .cg-icon-wrap {
    width: 72px; height: 72px;
    background: linear-gradient(135deg, rgba(239,68,68,0.25), rgba(239,68,68,0.1));
    border: 1px solid rgba(239,68,68,0.35); border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    margin: 0 auto 20px; font-size: 34px;
  }
  .cg-title { font-size: 26px; font-weight: 800; letter-spacing: -0.4px; margin-bottom: 8px; }
  .cg-sub { font-size: 14px; color: rgba(232,232,244,0.5); line-height: 1.65; margin-bottom: 22px; }
  .cg-section-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1.8px; color: rgba(232,232,244,0.3); margin-bottom: 10px; }
  .cg-badges { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-bottom: 6px; }
  .cg-badge { background: rgba(239,68,68,0.14); border: 1px solid rgba(239,68,68,0.38); color: #fca5a5; padding: 5px 14px; border-radius: 99px; font-size: 12px; font-weight: 600; }
  .cg-actions { display: flex; gap: 10px; justify-content: center; margin-top: 24px; }
  .cg-btn { padding: 11px 22px; border-radius: 11px; font-size: 13px; font-weight: 700; cursor: pointer; border: none; outline: none; transition: transform .12s, opacity .12s; }
  .cg-btn:hover { opacity: .82; } .cg-btn:active { transform: scale(.97); }
  .cg-btn-back { background: rgba(255,255,255,0.09); color: #e8e8f4; border: 1px solid rgba(255,255,255,0.13) !important; }
  .cg-footer { margin-top: 20px; font-size: 11px; color: rgba(232,232,244,0.18); letter-spacing: 0.5px; }
  .cg-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 20px; }
  .cg-stat { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; padding: 10px; font-size: 11px; }
  .cg-stat-num { font-size: 18px; font-weight: 800; color: #fff; }
  .cg-stat-label { color: rgba(232,232,244,0.4); margin-top: 2px; }
</style>
<div class="cg-card">
  <div class="cg-icon-wrap">🛡️</div>
  <h1 class="cg-title">Page Bloquée</h1>
  <p class="cg-sub">Contenu inapproprié détecté sur cette page.</p>
  <div class="cg-stats">
    <div class="cg-stat"><div class="cg-stat-num">${categories?.words?.length || 0}</div><div class="cg-stat-label">Mots simples</div></div>
    <div class="cg-stat"><div class="cg-stat-num">${categories?.combos?.length || 0}</div><div class="cg-stat-label">Combinaisons</div></div>
    <div class="cg-stat"><div class="cg-stat-num">${categories?.urls?.length || 0}</div><div class="cg-stat-label">URLs médias</div></div>
  </div>
  ${wordsSection}
  ${combosSection}
  ${urlsSection}
  <div class="cg-actions">
    <button class="cg-btn cg-btn-back" id="cg-back">← Retour</button>
  </div>
  <div class="cg-footer">ContentGuard v3 — Protection intelligente</div>
</div>`;

  document.documentElement.appendChild(overlay);

  overlay.querySelector('#cg-back').addEventListener('click', () => {
    history.length > 1 ? history.back() : window.close();
  });


}

function esc(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

start();
