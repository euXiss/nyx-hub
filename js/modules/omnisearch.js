// js/modules/omnisearch.js
import { getWikiEntries, openReaderModal } from './wiki-cms.js';
import { isMaster } from './roles-manager.js';

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildSnippet(text = '', query = '') {
  const clean = text.replace(/\[\[([^\[\]]+)\]\]/g, '$1').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const idx = clean.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return clean.slice(0, 95) + (clean.length > 95 ? '...' : '');
  const start = Math.max(0, idx - 32);
  const end = Math.min(clean.length, idx + query.length + 58);
  return (start > 0 ? '...' : '') + clean.slice(start, end) + (end < clean.length ? '...' : '');
}

export function initOmnisearch(canSearchFn) {
  const input = document.getElementById('omnisearch-input');
  const resultsBox = document.getElementById('omnisearch-results');
  if (!input || !resultsBox) return;

  let activeIndex = -1;
  let currentMatches = [];

  const closeResults = () => {
    resultsBox.classList.add('hidden');
    activeIndex = -1;
  };

  const renderResults = (queryRaw) => {
    const query = queryRaw.trim();
    if (!query || (canSearchFn && !canSearchFn())) {
      closeResults();
      return;
    }

    const qLower = query.toLowerCase();
    const entries = getWikiEntries();
    const masterMode = isMaster();

    const scored = [];

    entries.forEach(item => {
      const titleMatch = (item.title || '').toLowerCase().includes(qLower);
      const subMatch = (item.subtitle || '').toLowerCase().includes(qLower);
      const catMatch = (item.category || '').toLowerCase().includes(qLower);
      const tagMatch = Array.isArray(item.tags) && item.tags.some(t => t.toLowerCase().includes(qLower));
      const contentMatch = (item.content || '').toLowerCase().includes(qLower);

      const canReadSecret = item.masterSecret && (masterMode || item.secretRevealed);
      const secretMatch = canReadSecret && item.masterSecret.toLowerCase().includes(qLower);

      if (!titleMatch && !subMatch && !catMatch && !tagMatch && !contentMatch && !secretMatch) {
        return;
      }

      let score = 0;
      if (titleMatch) score += 10;
      if (tagMatch) score += 6;
      if (subMatch) score += 5;
      if (catMatch) score += 3;
      if (contentMatch) score += 2;
      if (secretMatch) score += 1;

      const isSecretOnly = secretMatch && !titleMatch && !subMatch && !tagMatch && !contentMatch;
      const snippetSource = isSecretOnly ? item.masterSecret : (item.content || '');

      scored.push({
        item,
        score,
        isSecretOnly,
        snippet: buildSnippet(snippetSource, query)
      });
    });

    scored.sort((a, b) => b.score - a.score);
    currentMatches = scored.slice(0, 8);
    activeIndex = -1;

    if (currentMatches.length === 0) {
      resultsBox.innerHTML = `
        <div class="px-4 py-5 text-center text-xs text-[var(--texto-mutado)]">
          Nenhum registro encontrado para <span class="text-[var(--dourado)] font-bold">"${escapeHtml(query)}"</span>.
        </div>
      `;
      resultsBox.classList.remove('hidden');
      return;
    }

    resultsBox.innerHTML = currentMatches.map((match, idx) => {
      const { item, isSecretOnly, snippet } = match;
      return `
        <button type="button" class="nyx-omni-item" data-omni-idx="${idx}">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 min-w-0">
              <span class="wiki-badge shrink-0">${escapeHtml(item.category || 'Geral')}</span>
              <span class="font-bold text-sm text-[var(--dourado)] truncate">${escapeHtml(item.title)}</span>
              ${isSecretOnly ? `<span class="text-[10px] font-mono-code px-1.5 py-0.5 rounded bg-[var(--vinho-escuro)] text-red-200 shrink-0">🔒 Segredo</span>` : ''}
            </div>
            ${item.subtitle ? `<span class="text-[11px] text-[var(--texto-mutado)] italic truncate max-w-[160px] shrink-0">${escapeHtml(item.subtitle)}</span>` : ''}
          </div>
          ${snippet ? `<p class="text-xs text-[var(--texto-principal)] opacity-80 line-clamp-1">${escapeHtml(snippet)}</p>` : ''}
        </button>
      `;
    }).join('');

    resultsBox.classList.remove('hidden');

    resultsBox.querySelectorAll('[data-omni-idx]').forEach(btn => {
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const picked = currentMatches[Number(btn.dataset.omniIdx)];
        if (picked) {
          closeResults();
          input.blur();
          openReaderModal(picked.item.id);
        }
      });
    });
  };

  const updateActiveHighlight = () => {
    const items = resultsBox.querySelectorAll('.nyx-omni-item');
    items.forEach((el, i) => el.classList.toggle('active', i === activeIndex));
  };

  input.addEventListener('input', (e) => renderResults(e.target.value));

  input.addEventListener('focus', () => {
    if (input.value.trim()) renderResults(input.value);
  });

  input.addEventListener('keydown', (e) => {
    if (resultsBox.classList.contains('hidden') || currentMatches.length === 0) {
      if (e.key === 'Escape') closeResults();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % currentMatches.length;
      updateActiveHighlight();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + currentMatches.length) % currentMatches.length;
      updateActiveHighlight();
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      const picked = currentMatches[activeIndex];
      if (picked) {
        closeResults();
        input.blur();
        openReaderModal(picked.item.id);
      }
    } else if (e.key === 'Escape') {
      closeResults();
    }
  });

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !resultsBox.contains(e.target)) {
      closeResults();
    }
  });

  // Atalho rápido "/" para focar na busca quando não estiver digitando em outro campo
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
      if (!canSearchFn || canSearchFn()) {
        e.preventDefault();
        input.focus();
      }
    }
  });
}