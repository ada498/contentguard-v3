'use strict';

/* ─── ContentGuard — popup.js (v3) ─────────────────────────────────────── */

let settings = {
  blockedWords:       [],
  blockedCombos:      [],
  blockedUrlPatterns: [],
  enabled:            true,
  caseSensitive:      false,
  wholeWordOnly:      false,
  scanMediaUrls:      true,
  scanImageAlt:       true,
  contextThreshold:   2
};

async function load() {
  const data = await chrome.storage.sync.get({
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
  settings = data;
  render();
}

async function save() {
  await chrome.storage.sync.set(settings);
}

function render() {
  el('toggle-enabled').checked = settings.enabled;
  el('toggle-case').checked    = settings.caseSensitive;
  el('toggle-whole').checked   = settings.wholeWordOnly;
  el('toggle-media').checked  = settings.scanMediaUrls;
  el('toggle-alt').checked    = settings.scanImageAlt;
  el('threshold').value       = settings.contextThreshold || 2;

  el('word-count').textContent  = settings.blockedWords.length;
  el('combo-count').textContent = settings.blockedCombos.length;
  el('url-count').textContent   = settings.blockedUrlPatterns.length;

  renderList('word-list',  settings.blockedWords,       removeWord,  'word',  'var(--accent)');
  renderList('combo-list', settings.blockedCombos,        removeCombo, 'combo', '#fbbf24');
  renderList('url-list',   settings.blockedUrlPatterns,   removeUrl,   'url',   '#06b6d4');

  const dot  = el('status-dot');
  const text = el('status-text');
  if (settings.enabled) {
    dot.className = 'status-dot';
    const total = settings.blockedWords.length + settings.blockedCombos.length + settings.blockedUrlPatterns.length;
    text.textContent = total === 0 ? 'Actif — aucune règle' : `Actif — ${total} règle(s)`;
  } else {
    dot.className = 'status-dot off';
    text.textContent = 'Désactivé';
  }

  el('main-content').classList.toggle('disabled', !settings.enabled);
}

function renderList(listId, items, removeFn, type, dotColor) {
  const list = el(listId);
  if (items.length === 0) {
    const emptyMsgs = {
      word:  ['📋', 'Aucun mot bloqué.<br>Ajoutez-en un ci-dessus.'],
      combo: ['🔗', 'Aucune combinaison.<br>Ex: "adult content"'],
      url:   ['🖼️', 'Aucun pattern d\'URL.<br>Ex: "adult" ou "*.jpg"']
    };
    const [icon, msg] = emptyMsgs[type];
    list.innerHTML = `<div class="empty-state"><span class="empty-icon">${icon}</span><span class="empty-text">${msg}</span></div>`;
  } else {
    list.innerHTML = items.map((item, i) => `
      <div class="word-item">
        <span class="word-dot" style="background:${dotColor}"></span>
        <span class="word-text" title="${esc(item)}">${esc(item)}</span>
        <button class="word-del" data-i="${i}" title="Supprimer">×</button>
      </div>`).join('');

    list.querySelectorAll('.word-del').forEach(btn => {
      btn.addEventListener('click', () => removeFn(Number(btn.dataset.i)));
    });
  }
}

/* ── Add ── */
async function addWord() {
  const input = el('word-input');
  const word  = input.value.trim();
  if (!word) { flashInput(input); return; }
  if (settings.blockedWords.includes(word)) { flashInput(input, 'Déjà dans la liste.'); return; }
  settings.blockedWords.push(word);
  input.value = '';
  await save(); render(); scrollToBottom('word-list');
}

async function addCombo() {
  const input = el('combo-input');
  const combo = input.value.trim().toLowerCase();
  if (!combo) { flashInput(input); return; }
  if (combo.split(/\s+/).length < 2) { flashInput(input, 'Minimum 2 mots.'); return; }
  if (settings.blockedCombos.includes(combo)) { flashInput(input, 'Déjà dans la liste.'); return; }
  settings.blockedCombos.push(combo);
  input.value = '';
  await save(); render(); scrollToBottom('combo-list');
}

async function addUrlPattern() {
  const input = el('url-input');
  const pattern = input.value.trim().toLowerCase();
  if (!pattern) { flashInput(input); return; }
  if (settings.blockedUrlPatterns.includes(pattern)) { flashInput(input, 'Déjà dans la liste.'); return; }
  settings.blockedUrlPatterns.push(pattern);
  input.value = '';
  await save(); render(); scrollToBottom('url-list');
}

/* ── Remove ── */
async function removeWord(index)  { settings.blockedWords.splice(index, 1);       await save(); render(); }
async function removeCombo(index) { settings.blockedCombos.splice(index, 1);        await save(); render(); }
async function removeUrl(index)   { settings.blockedUrlPatterns.splice(index, 1);   await save(); render(); }

/* ── Helpers ── */
function flashInput(input, msg) {
  input.classList.remove('shake');
  void input.offsetWidth;
  input.classList.add('shake');
  setTimeout(() => input.classList.remove('shake'), 400);
  if (msg) {
    const old = input.placeholder;
    input.placeholder = msg;
    setTimeout(() => input.placeholder = old, 2000);
  }
  input.focus();
}

function scrollToBottom(id) {
  const list = el(id);
  list.scrollTop = list.scrollHeight;
}

function el(id) { return document.getElementById(id); }
function esc(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── Boot ── */
document.addEventListener('DOMContentLoaded', async () => {
  await load();

  el('toggle-enabled').addEventListener('change', async e => { settings.enabled = e.target.checked; await save(); render(); });
  el('toggle-case').addEventListener('change',    async e => { settings.caseSensitive = e.target.checked; await save(); });
  el('toggle-whole').addEventListener('change',   async e => { settings.wholeWordOnly = e.target.checked; await save(); });
  el('toggle-media').addEventListener('change',   async e => { settings.scanMediaUrls = e.target.checked; await save(); });
  el('toggle-alt').addEventListener('change',     async e => { settings.scanImageAlt = e.target.checked; await save(); });
  el('threshold').addEventListener('change',      async e => { settings.contextThreshold = Math.max(2, Math.min(5, parseInt(e.target.value) || 2)); await save(); });

  el('btn-add').addEventListener('click', addWord);
  el('word-input').addEventListener('keydown', e => { if (e.key === 'Enter') addWord(); });

  el('btn-add-combo').addEventListener('click', addCombo);
  el('combo-input').addEventListener('keydown', e => { if (e.key === 'Enter') addCombo(); });

  el('btn-add-url').addEventListener('click', addUrlPattern);
  el('url-input').addEventListener('keydown', e => { if (e.key === 'Enter') addUrlPattern(); });

  el('btn-clear').addEventListener('click', async () => {
    const total = settings.blockedWords.length + settings.blockedCombos.length + settings.blockedUrlPatterns.length;
    if (total === 0) return;
    if (window.confirm(`Supprimer les ${total} règle(s) ?`)) {
      settings.blockedWords = [];
      settings.blockedCombos = [];
      settings.blockedUrlPatterns = [];
      await save();
      render();
    }
  });
});
