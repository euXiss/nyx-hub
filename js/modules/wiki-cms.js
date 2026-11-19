// js/modules/wiki-cms.js
import { db } from '../config/firebase.js';
import {
  collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
  initTagsSync, getAllTags, openTagsModal, openTagFilterModal, DISTRITOS_SUGESTOES
} from './tags-manager.js';
import { isMaster } from './roles-manager.js';

let wikiEntries = [];
let activeCategory = 'Todos';
let activeTag = null;
let activeLocationScopeId = null;
let collapsedTreeNodes = new Set();
let unsubscribeWiki = null;
let wikiChangeListeners = [];

const CATEGORIES = ['Todos', 'Locais', 'NPCs', 'Facções', 'Regras'];
const CONFIG_DOC_IDS = ['nyx_config_tags', 'nyx_config_roles'];
const CANVAS_TYPES = ['canvas_card', 'canvas_frame', 'canvas_board'];

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripLinkBrackets(str = '') {
  return String(str).replace(/\[\[([^\[\]\n]+)\]\]/g, '$1');
}

/* Auxiliares da Árvore de Sublocais */
function getAncestorChain(item) {
  const chain = [];
  const visited = new Set([item?.id]);
  let currentParentId = item?.parentId || '';

  while (currentParentId && !visited.has(currentParentId)) {
    visited.add(currentParentId);
    const parent = wikiEntries.find(w => w.id === currentParentId);
    if (!parent) break;
    chain.unshift(parent);
    currentParentId = parent.parentId || '';
  }
  return chain;
}

function getFullHierarchyPath(item) {
  const ancestors = getAncestorChain(item);
  if (ancestors.length === 0) return item.title || 'Sem Título';
  return [...ancestors.map(a => a.title), item.title].join(' › ');
}

function getDescendantIds(rootId) {
  const descendants = new Set();
  const queue = [rootId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    for (const entry of wikiEntries) {
      if (entry.parentId === currentId && !descendants.has(entry.id)) {
        descendants.add(entry.id);
        queue.push(entry.id);
      }
    }
  }
  return descendants;
}

function getDirectChildren(parentId) {
  return wikiEntries
    .filter(w => w.parentId === parentId)
    .sort((a, b) => {
      const aIsLocal = a.category === 'Locais' ? 0 : 1;
      const bIsLocal = b.category === 'Locais' ? 0 : 1;
      if (aIsLocal !== bIsLocal) return aIsLocal - bIsLocal;
      return (a.title || '').localeCompare(b.title || '', 'pt-BR');
    });
}

function renderLinkedText(rawText = '') {
  const escaped = escapeHtml(rawText);
  return escaped.replace(/\[\[([^\[\]\n]+)\]\]/g, (_, innerEscaped) => {
    const cleanTarget = innerEscaped.trim();
    const found = wikiEntries.find(
      w => escapeHtml(w.title).trim().toLowerCase() === cleanTarget.toLowerCase()
    );
    if (found) {
      return `<button type="button" class="nyx-wikilink" data-open-wikilink="${found.id}" title="Abrir registro: ${escapeHtml(found.title)}">${cleanTarget}</button>`;
    }
    return `<button type="button" class="nyx-wikilink-missing" data-create-wikilink="${cleanTarget}" title="Registro ainda não existe — clique para criar">${cleanTarget}</button>`;
  });
}

function getBacklinksFor(targetItem) {
  if (!targetItem || !targetItem.title) return [];
  const targetTitleLower = targetItem.title.trim().toLowerCase();
  const masterMode = isMaster();

  const containsReference = (text = '') => {
    const regex = /\[\[([^\[\]\n]+)\]\]/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (match[1].trim().toLowerCase() === targetTitleLower) {
        return true;
      }
    }
    return false;
  };

  return wikiEntries.filter(other => {
    if (other.id === targetItem.id) return false;
    const inPublic = containsReference(other.content || '');
    const inVisibleSecret = (masterMode || other.secretRevealed) && containsReference(other.masterSecret || '');
    return inPublic || inVisibleSecret;
  });
}

function compressImageToWebP(file, maxWidth = 850, quality = 0.78) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/webp', quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function onWikiEntriesUpdated(cb) {
  wikiChangeListeners.push(cb);
}

export function getWikiEntries() {
  return wikiEntries;
}

export function initWikiSync() {
  if (unsubscribeWiki) return;

  unsubscribeWiki = onSnapshot(collection(db, 'wikis'), (snapshot) => {
    wikiEntries = snapshot.docs
      .filter(d => !CONFIG_DOC_IDS.includes(d.id) && !CANVAS_TYPES.includes(d.data().nyxType))
      .map(d => ({ id: d.id, ...d.data() }));
    wikiEntries.sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0));

    if (activeLocationScopeId && !wikiEntries.some(w => w.id === activeLocationScopeId)) {
      activeLocationScopeId = null;
    }

    if (document.getElementById('wiki-location-tree-wrap')) renderLocationTree();
    if (document.getElementById('wiki-list')) renderCards();
    wikiChangeListeners.forEach(cb => cb(wikiEntries));
  });
}

export async function toggleWikiSecret(id) {
  const item = wikiEntries.find(w => w.id === id);
  if (!item || !isMaster()) return;
  const nextState = !item.secretRevealed;
  item.secretRevealed = nextState;
  await updateDoc(doc(db, 'wikis', id), {
    secretRevealed: nextState,
    updatedAt: serverTimestamp()
  });
}

export function refreshWikiUI() {
  if (document.getElementById('wiki-location-tree-wrap')) renderLocationTree();
  if (document.getElementById('wiki-list')) renderCards();
}

export function mountWikiView(container) {
  container.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-4 mb-6 pb-4 border-b border-[var(--borda-fina)]">
      <div id="wiki-filters" class="flex flex-wrap gap-2"></div>
      <div class="flex flex-wrap items-center gap-2">
        <div id="tag-filter-control" class="flex items-center gap-1.5"></div>
        <button id="btn-manage-tags" class="px-3.5 py-2 rounded-lg bg-[var(--bg-card)] hover:border-[var(--dourado)] border border-[var(--borda-fina)] text-[var(--dourado-claro)] text-xs font-semibold transition">
          🏷️ Gerenciar Tags
        </button>
        <button id="btn-new-wiki" class="px-4 py-2 rounded-lg bg-[var(--vinho-escuro)] hover:bg-[var(--vinho)] border border-[var(--dourado)] text-[var(--dourado-claro)] text-sm font-bold transition shadow">
          + Novo Registro na Wiki
        </button>
      </div>
    </div>

    <div id="wiki-location-tree-wrap" class="mb-6"></div>

    <div id="wiki-list" class="wiki-grid">
      <p class="text-sm text-[var(--texto-mutado)]">Sincronizando arquivos do universo...</p>
    </div>
  `;

  document.getElementById('btn-manage-tags').addEventListener('click', () => openTagsModal());
  document.getElementById('btn-new-wiki').addEventListener('click', () => openEditorModal());

  initTagsSync(() => {
    if (document.getElementById('tag-filter-control')) renderTagFilterButton();
  });

  initWikiSync();
  renderFilters();
  renderTagFilterButton();
  renderLocationTree();
  renderCards();
}

function renderFilters() {
  const filterBar = document.getElementById('wiki-filters');
  if (!filterBar) return;

  filterBar.innerHTML = CATEGORIES.map(cat => {
    const active = cat === activeCategory;
    return `
      <button data-cat="${cat}" class="wiki-cat-btn px-3.5 py-1.5 rounded-lg text-xs font-semibold border transition ${
        active
          ? 'bg-[var(--vinho-escuro)] border-[var(--dourado)] text-[var(--dourado)]'
          : 'bg-[var(--bg-card)] border-[var(--borda-fina)] text-[var(--texto-mutado)] hover:text-[var(--texto-principal)]'
      }">${cat}</button>
    `;
  }).join('');

  filterBar.querySelectorAll('.wiki-cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeCategory = btn.dataset.cat;
      if (activeCategory !== 'Locais') {
        activeLocationScopeId = null;
      }
      renderFilters();
      renderLocationTree();
      renderCards();
    });
  });
}

/* Árvore Interativa de Cidades -> Distritos -> Sublocais */
function renderLocationTree() {
  const wrap = document.getElementById('wiki-location-tree-wrap');
  if (!wrap) return;

  if (activeCategory !== 'Locais') {
    wrap.innerHTML = '';
    return;
  }

  const allLocals = wikiEntries
    .filter(w => w.category === 'Locais')
    .sort((a, b) => (a.title || '').localeCompare(b.title || '', 'pt-BR'));

  if (allLocals.length === 0) {
    wrap.innerHTML = '';
    return;
  }

  const localIds = new Set(allLocals.map(l => l.id));
  const rootLocals = allLocals.filter(l => !l.parentId || !localIds.has(l.parentId));

  const renderBranch = (node, depth = 0) => {
    const children = allLocals.filter(l => l.parentId === node.id);
    const hasChildren = children.length > 0;
    const isCollapsed = collapsedTreeNodes.has(node.id);
    const isSelected = activeLocationScopeId === node.id;
    const linkedRecordsCount = wikiEntries.filter(w => w.parentId === node.id && w.category !== 'Locais').length;

    return `
      <div class="select-none">
        <div class="flex flex-wrap items-center justify-between gap-2 py-1.5 px-2.5 rounded-lg transition ${
          isSelected
            ? 'bg-[var(--vinho-escuro)] border border-[var(--dourado)]'
            : 'hover:bg-white/[0.03] border border-transparent'
        }" style="margin-left: ${depth * 18}px;">
          <div class="flex items-center gap-1.5 min-w-0">
            ${hasChildren ? `
              <button type="button" data-tree-toggle="${node.id}"
                class="w-5 h-5 rounded bg-black/40 border border-[var(--borda-fina)] text-[10px] text-[var(--dourado-claro)] flex items-center justify-center shrink-0">
                ${isCollapsed ? '▸' : '▾'}
              </button>
            ` : `<span class="w-5 text-center text-[10px] text-[var(--texto-mutado)] shrink-0">${depth === 0 ? '🏙️' : '📍'}</span>`}

            <button type="button" data-tree-filter="${node.id}"
              class="text-left text-xs font-bold truncate ${isSelected ? 'text-[var(--dourado)]' : 'text-[var(--texto-principal)] hover:text-[var(--dourado-claro)]'}">
              ${escapeHtml(node.title)}
            </button>

            ${hasChildren ? `
              <span class="text-[10px] font-mono-code px-1.5 py-0.5 rounded bg-black/40 text-[var(--dourado-claro)] shrink-0">
                ${children.length} ${children.length === 1 ? 'sublocal' : 'sublocais'}
              </span>
            ` : ''}

            ${linkedRecordsCount > 0 ? `
              <span class="text-[10px] font-mono-code px-1.5 py-0.5 rounded bg-black/40 text-[var(--texto-mutado)] shrink-0">
                +${linkedRecordsCount} reg.
              </span>
            ` : ''}
          </div>

          <div class="flex items-center gap-2 text-[10px] font-mono-code shrink-0">
            <button type="button" data-tree-add-child="${node.id}" title="Criar distrito ou sublocal dentro de ${escapeHtml(node.title)}"
              class="text-[var(--dourado)] hover:underline">
              + Sublocal
            </button>
            <button type="button" data-tree-open="${node.id}" class="text-[var(--texto-mutado)] hover:text-white">
              Abrir
            </button>
          </div>
        </div>

        ${hasChildren && !isCollapsed ? `
          <div class="border-l border-[var(--borda-fina)]/70 ml-4 pl-1 mt-0.5 space-y-0.5">
            ${children.map(child => renderBranch(child, depth + 1)).join('')}
          </div>
        ` : ''}
      </div>
    `;
  };

  const scopedItem = activeLocationScopeId ? wikiEntries.find(w => w.id === activeLocationScopeId) : null;

  wrap.innerHTML = `
    <div class="bg-[var(--bg-card)] border border-[var(--borda-fina)] rounded-xl p-4 shadow-lg">
      <div class="flex flex-wrap items-center justify-between gap-2 pb-2.5 mb-2.5 border-b border-[var(--borda-fina)]">
        <div class="flex items-center gap-2">
          <span class="text-xs font-bold uppercase tracking-wider text-[var(--dourado)]">🗺️ Árvore de Sublocais</span>
          <span class="text-[11px] font-mono-code text-[var(--texto-mutado)]">(Clique em uma cidade ou distrito para filtrar)</span>
        </div>

        <div class="flex items-center gap-2">
          ${scopedItem ? `
            <span class="text-[11px] font-mono-code text-[var(--dourado-claro)] bg-[var(--vinho-escuro)]/60 border border-[var(--dourado)]/50 px-2.5 py-0.5 rounded-full">
              📍 ${escapeHtml(getFullHierarchyPath(scopedItem))}
            </span>
            <button type="button" id="btn-clear-location-scope"
              class="text-xs text-red-400 hover:underline font-semibold">
              Mostrar todos
            </button>
          ` : ''}
        </div>
      </div>

      <div class="space-y-1 max-h-60 overflow-y-auto pr-1">
        ${rootLocals.map(root => renderBranch(root, 0)).join('')}
      </div>
    </div>
  `;

  wrap.querySelectorAll('[data-tree-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.treeToggle;
      if (collapsedTreeNodes.has(id)) collapsedTreeNodes.delete(id);
      else collapsedTreeNodes.add(id);
      renderLocationTree();
    });
  });

  wrap.querySelectorAll('[data-tree-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.treeFilter;
      activeLocationScopeId = activeLocationScopeId === id ? null : id;
      renderLocationTree();
      renderCards();
    });
  });

  wrap.querySelectorAll('[data-tree-open]').forEach(btn => {
    btn.addEventListener('click', () => openReaderModal(btn.dataset.treeOpen));
  });

  wrap.querySelectorAll('[data-tree-add-child]').forEach(btn => {
    btn.addEventListener('click', () => {
      openEditorModal(null, '', { category: 'Locais', parentId: btn.dataset.treeAddChild });
    });
  });

  const clearScopeBtn = document.getElementById('btn-clear-location-scope');
  if (clearScopeBtn) {
    clearScopeBtn.addEventListener('click', () => {
      activeLocationScopeId = null;
      renderLocationTree();
      renderCards();
    });
  }
}

function renderTagFilterButton() {
  const wrap = document.getElementById('tag-filter-control');
  if (!wrap) return;

  wrap.innerHTML = `
    <button id="btn-open-tag-filter" class="px-3.5 py-2 rounded-lg border text-xs font-semibold transition ${
      activeTag
        ? 'bg-[var(--vinho-escuro)] border-[var(--dourado)] text-[var(--dourado)]'
        : 'bg-[var(--bg-card)] border-[var(--borda-fina)] text-[var(--dourado-claro)] hover:border-[var(--dourado)]'
    }">
      ${activeTag ? `🔍 Tag: #${escapeHtml(activeTag)}` : '🔍 Filtrar por Tags'}
    </button>
    ${activeTag ? `
      <button id="btn-reset-tag-filter" title="Limpar filtro de tag" class="px-2.5 py-2 rounded-lg bg-[var(--bg-card)] border border-red-500/40 text-red-400 hover:bg-[var(--vinho-escuro)] text-xs font-bold transition">
        ✕
      </button>
    ` : ''}
  `;

  document.getElementById('btn-open-tag-filter').addEventListener('click', () => {
    openTagFilterModal(activeTag, (selected) => {
      activeTag = selected;
      renderTagFilterButton();
      renderCards();
    });
  });

  const resetBtn = document.getElementById('btn-reset-tag-filter');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      activeTag = null;
      renderTagFilterButton();
      renderCards();
    });
  }
}

function renderSecretBadge(item) {
  const hasSecret = item.masterSecret && item.masterSecret.trim().length > 0;
  if (!hasSecret) return '';

  if (isMaster()) {
    return item.secretRevealed
      ? `<span class="text-[10px] font-mono-code px-2 py-0.5 rounded bg-amber-950/60 border border-[var(--dourado)] text-[var(--dourado)]">👁️ Revelado</span>`
      : `<span class="text-[10px] font-mono-code px-2 py-0.5 rounded bg-[var(--vinho-escuro)] border border-red-500/40 text-red-200">🔒 Segredo</span>`;
  }

  return item.secretRevealed
    ? `<span class="text-[10px] font-mono-code px-2 py-0.5 rounded bg-amber-950/60 border border-[var(--dourado)] text-[var(--dourado)]">✨ Revelado</span>`
    : '';
}

function renderCards() {
  const listEl = document.getElementById('wiki-list');
  if (!listEl) return;

  let scopedSet = null;
  if (activeCategory === 'Locais' && activeLocationScopeId) {
    scopedSet = getDescendantIds(activeLocationScopeId);
    scopedSet.add(activeLocationScopeId);
  }

  const filtered = wikiEntries.filter(item => {
    const matchCat = activeCategory === 'Todos' || item.category === activeCategory;
    const matchTag = !activeTag || (Array.isArray(item.tags) && item.tags.includes(activeTag));
    const matchScope = !scopedSet || scopedSet.has(item.id);
    return matchCat && matchTag && matchScope;
  });

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div class="col-span-full bg-[var(--bg-card)] border border-[var(--borda-fina)] rounded-xl p-10 text-center">
        <p class="text-[var(--dourado)] font-bold text-lg mb-1">Nenhum registro encontrado</p>
        <p class="text-xs text-[var(--texto-mutado)]">Ajuste os filtros acima ou clique em "+ Novo Registro na Wiki".</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = filtered.map(item => {
    const ancestors = getAncestorChain(item);
    const directChildren = getDirectChildren(item.id);
    const sublocalsCount = directChildren.filter(c => c.category === 'Locais').length;

    return `
      <article class="wiki-card group" data-open-id="${item.id}" id="wiki-card-${item.id}">
        ${item.imageUrl ? `<img src="${item.imageUrl}" alt="${escapeHtml(item.title)}" class="wiki-card-cover">` : ''}
        <div class="p-5 flex-1 flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between gap-2 mb-2">
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="wiki-badge">${escapeHtml(item.category || 'Geral')}</span>
                ${sublocalsCount > 0 ? `
                  <span class="text-[10px] font-mono-code px-2 py-0.5 rounded bg-[#120407] border border-[var(--borda-fina)] text-[var(--dourado-claro)]">
                    🏘️ ${sublocalsCount} ${sublocalsCount === 1 ? 'sublocal' : 'sublocais'}
                  </span>
                ` : ''}
                ${renderSecretBadge(item)}
              </div>
              ${item.subtitle ? `<span class="text-xs text-[var(--texto-mutado)] italic truncate max-w-[140px]">${escapeHtml(item.subtitle)}</span>` : ''}
            </div>

            ${ancestors.length > 0 ? `
              <div class="flex flex-wrap items-center gap-1 text-[11px] font-mono-code text-[var(--dourado-claro)]/85 mb-1.5">
                <span>📍</span>
                ${ancestors.map((anc, i) => `
                  <button type="button" data-jump-parent="${anc.id}" class="hover:text-[var(--dourado)] hover:underline truncate max-w-[140px]">${escapeHtml(anc.title)}</button>
                  ${i < ancestors.length - 1 ? '<span class="text-[var(--texto-mutado)]">›</span>' : ''}
                `).join('')}
              </div>
            ` : ''}

            <h3 class="text-lg font-bold text-[var(--dourado)] group-hover:text-[var(--dourado-claro)] transition mb-2">${escapeHtml(item.title)}</h3>
            <p class="text-sm text-[var(--texto-principal)] opacity-90 wiki-excerpt mb-3">${escapeHtml(stripLinkBrackets(item.content))}</p>
            ${Array.isArray(item.tags) && item.tags.length > 0 ? `
              <div class="flex flex-wrap gap-1.5 mt-2">
                ${item.tags.map(tag => `<button type="button" data-jump-tag="${escapeHtml(tag)}" class="nyx-tag-pill">#${escapeHtml(tag)}</button>`).join('')}
              </div>
            ` : ''}
          </div>

          <div class="mt-4 pt-3 border-t border-[var(--borda-fina)] flex items-center justify-between text-xs">
            <span class="text-[var(--texto-mutado)] group-hover:text-[var(--dourado)] transition">Clique para abrir</span>
            <div class="space-x-3">
              <button type="button" data-edit="${item.id}" class="text-[var(--texto-mutado)] hover:text-[var(--dourado-claro)]">Editar</button>
              ${isMaster() ? `<button type="button" data-del="${item.id}" class="text-red-400 hover:text-red-300">Excluir</button>` : ''}
            </div>
          </div>
        </div>
      </article>
    `;
  }).join('');

  listEl.querySelectorAll('.wiki-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      openReaderModal(card.dataset.openId);
    });
  });

  listEl.querySelectorAll('[data-jump-parent]').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    openReaderModal(b.dataset.jumpParent);
  }));

  listEl.querySelectorAll('[data-jump-tag]').forEach(b => b.addEventListener('click', () => {
    activeCategory = 'Todos';
    activeLocationScopeId = null;
    activeTag = b.dataset.jumpTag;
    renderFilters();
    renderTagFilterButton();
    renderLocationTree();
    renderCards();
  }));

  listEl.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
    const entry = wikiEntries.find(w => w.id === b.dataset.edit);
    if (entry) openEditorModal(entry);
  }));

  listEl.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    if (confirm('Deseja realmente apagar este registro da Wiki?')) {
      await deleteDoc(doc(db, 'wikis', b.dataset.del));
    }
  }));
}

export function openReaderModal(id) {
  const item = wikiEntries.find(w => w.id === id);
  if (!item) return;

  const masterMode = isMaster();
  const hasSecret = item.masterSecret && item.masterSecret.trim().length > 0;
  const canSeeSecret = hasSecret && (masterMode || item.secretRevealed);
  const backlinks = getBacklinksFor(item);
  const ancestors = getAncestorChain(item);
  const directChildren = getDirectChildren(item.id);
  const childLocals = directChildren.filter(c => c.category === 'Locais');
  const childOthers = directChildren.filter(c => c.category !== 'Locais');

  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = `
    <div class="nyx-modal-backdrop" id="reader-backdrop">
      <div class="bg-[var(--bg-surface)] border border-[var(--dourado)] rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        ${item.imageUrl ? `<div class="wiki-reader-media-wrap"><img src="${item.imageUrl}" alt="${escapeHtml(item.title)}" class="wiki-reader-media"></div>` : ''}
        <div class="p-6 md:p-8">
          <div class="flex items-center justify-between mb-3">
            <div class="flex flex-wrap items-center gap-2">
              <span class="wiki-badge">${escapeHtml(item.category)}</span>
              ${item.category === 'Locais' ? `
                <button type="button" id="btn-reader-add-sublocal"
                  class="px-2.5 py-1 rounded-lg bg-[#120407] hover:bg-[var(--vinho-escuro)] border border-[var(--borda-fina)] hover:border-[var(--dourado)] text-[11px] font-semibold text-[var(--dourado-claro)]">
                  + Novo Sublocal aqui
                </button>
              ` : ''}
            </div>
            <button id="close-reader" class="text-sm text-[var(--texto-mutado)] hover:text-[var(--dourado)]">✕ Fechar</button>
          </div>

          ${ancestors.length > 0 ? `
            <nav class="flex flex-wrap items-center gap-1.5 text-xs font-mono-code text-[var(--dourado-claro)] bg-[#120407] border border-[var(--borda-fina)] rounded-lg px-3 py-1.5 mb-3">
              <span>🗺️</span>
              ${ancestors.map(anc => `
                <button type="button" data-open-ancestor="${anc.id}" class="hover:text-[var(--dourado)] hover:underline font-semibold">
                  ${escapeHtml(anc.title)}
                </button>
                <span class="text-[var(--texto-mutado)]">›</span>
              `).join('')}
              <span class="text-[var(--texto-mutado)]">${escapeHtml(item.title)}</span>
            </nav>
          ` : ''}

          <h2 class="text-2xl md:text-3xl font-bold text-[var(--dourado)] mb-1">${escapeHtml(item.title)}</h2>
          ${item.subtitle ? `<p class="text-sm text-[var(--dourado-claro)] italic mb-4">${escapeHtml(item.subtitle)}</p>` : '<div class="mb-4"></div>'}
          ${Array.isArray(item.tags) && item.tags.length > 0 ? `
            <div class="flex flex-wrap gap-1.5 mb-5">
              ${item.tags.map(tag => `<button type="button" data-reader-tag="${escapeHtml(tag)}" class="nyx-tag-pill">#${escapeHtml(tag)}</button>`).join('')}
            </div>
          ` : ''}
          <div class="text-base text-[var(--texto-principal)] wiki-full-text">${renderLinkedText(item.content)}</div>

          ${canSeeSecret ? `
            <div class="nyx-secret-box ${item.secretRevealed ? 'revealed' : ''}">
              <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
                <span class="text-xs font-mono-code font-bold uppercase tracking-wider ${item.secretRevealed ? 'text-[var(--dourado)]' : 'text-red-300'}">
                  ${item.secretRevealed ? '✨ Informação Revelada na Mesa' : '🔒 Anotação Oculta do Mestre (Invisível aos Jogadores)'}
                </span>
                ${masterMode ? `
                  <button type="button" id="btn-toggle-reader-secret"
                    class="px-3 py-1 rounded-lg border text-xs font-bold ${
                      item.secretRevealed
                        ? 'bg-[#17080b] border-[var(--borda-fina)] text-[var(--texto-mutado)] hover:text-white'
                        : 'bg-[var(--vinho-escuro)] border-[var(--dourado)] text-[var(--dourado-claro)]'
                    }">
                    ${item.secretRevealed ? 'Ocultar Novamente' : '👁️ Revelar Segredo aos Jogadores'}
                  </button>
                ` : ''}
              </div>
              <div class="text-sm text-[var(--texto-principal)] wiki-full-text">${renderLinkedText(item.masterSecret)}</div>
            </div>
          ` : ''}

          ${childLocals.length > 0 ? `
            <div class="mt-6 pt-4 border-t border-[var(--borda-fina)]">
              <p class="text-[11px] font-mono-code uppercase tracking-wider text-[var(--dourado)] mb-2.5">
                🏘️ Distritos & Sublocais de ${escapeHtml(item.title)} (${childLocals.length})
              </p>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                ${childLocals.map(sub => {
                  const grandChildrenCount = getDirectChildren(sub.id).filter(g => g.category === 'Locais').length;
                  return `
                    <button type="button" data-open-sublocal="${sub.id}"
                      class="text-left p-3 rounded-lg bg-[#120407] hover:bg-[var(--vinho-escuro)] border border-[var(--borda-fina)] hover:border-[var(--dourado)] transition">
                      <div class="flex items-center justify-between gap-2">
                        <span class="font-bold text-sm text-[var(--dourado-claro)] truncate">📍 ${escapeHtml(sub.title)}</span>
                        ${grandChildrenCount > 0 ? `
                          <span class="text-[10px] font-mono-code text-[var(--texto-mutado)] shrink-0">+${grandChildrenCount}</span>
                        ` : ''}
                      </div>
                      ${sub.subtitle ? `<p class="text-[11px] text-[var(--texto-mutado)] truncate mt-0.5">${escapeHtml(sub.subtitle)}</p>` : ''}
                    </button>
                  `;
                }).join('')}
              </div>
            </div>
          ` : ''}

          ${childOthers.length > 0 ? `
            <div class="mt-5 pt-4 border-t border-[var(--borda-fina)]">
              <p class="text-[11px] font-mono-code uppercase tracking-wider text-[var(--texto-mutado)] mb-2.5">
                📌 Registros Sediados Aqui (${childOthers.length})
              </p>
              <div class="flex flex-wrap gap-2">
                ${childOthers.map(ref => `
                  <button type="button" data-open-sublocal="${ref.id}"
                    class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#120407] hover:bg-[var(--vinho-escuro)] border border-[var(--borda-fina)] hover:border-[var(--dourado)] text-xs text-[var(--dourado-claro)]">
                    <span class="text-[10px] font-mono-code text-[var(--texto-mutado)]">${escapeHtml(ref.category)}</span>
                    <span class="font-bold">${escapeHtml(ref.title)}</span>
                  </button>
                `).join('')}
              </div>
            </div>
          ` : ''}

          ${backlinks.length > 0 ? `
            <div class="nyx-backlinks-box">
              <p class="text-[11px] font-mono-code uppercase tracking-wider text-[var(--texto-mutado)] mb-2.5">
                🔗 Mencionado em (${backlinks.length})
              </p>
              <div class="flex flex-wrap gap-2">
                ${backlinks.map(ref => `
                  <button type="button" data-open-backlink="${ref.id}"
                    class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#120407] hover:bg-[var(--vinho-escuro)] border border-[var(--borda-fina)] hover:border-[var(--dourado)] text-xs text-[var(--dourado-claro)]">
                    <span class="text-[10px] font-mono-code text-[var(--texto-mutado)]">${escapeHtml(ref.category)}</span>
                    <span class="font-bold">${escapeHtml(ref.title)}</span>
                  </button>
                `).join('')}
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    </div>
  `;

  const addSublocalBtn = document.getElementById('btn-reader-add-sublocal');
  if (addSublocalBtn) {
    addSublocalBtn.addEventListener('click', () => {
      openEditorModal(null, '', { category: 'Locais', parentId: item.id });
    });
  }

  modalRoot.querySelectorAll('[data-open-ancestor], [data-open-sublocal], [data-open-backlink], [data-open-wikilink]').forEach(btn => {
    const targetId = btn.dataset.openAncestor || btn.dataset.openSublocal || btn.dataset.openBacklink || btn.dataset.openWikilink;
    btn.addEventListener('click', () => openReaderModal(targetId));
  });

  modalRoot.querySelectorAll('[data-create-wikilink]').forEach(btn => {
    btn.addEventListener('click', () => openEditorModal(null, btn.dataset.createWikilink));
  });

  const toggleBtn = document.getElementById('btn-toggle-reader-secret');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', async () => {
      toggleBtn.disabled = true;
      toggleBtn.innerText = 'Atualizando...';
      await toggleWikiSecret(item.id);
      openReaderModal(item.id);
    });
  }

  modalRoot.querySelectorAll('[data-reader-tag]').forEach(btn => {
    btn.addEventListener('click', () => {
      modalRoot.innerHTML = '';
      activeCategory = 'Todos';
      activeLocationScopeId = null;
      activeTag = btn.dataset.readerTag;
      renderFilters();
      renderTagFilterButton();
      renderLocationTree();
      renderCards();
    });
  });

  document.getElementById('close-reader').addEventListener('click', () => modalRoot.innerHTML = '');
  document.getElementById('reader-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'reader-backdrop') modalRoot.innerHTML = '';
  });
}

export function attachWikiLinkAutocomplete(textarea) {
  if (!textarea || !textarea.parentElement) return;
  textarea.parentElement.classList.add('relative');

  const menu = document.createElement('div');
  menu.className = 'nyx-autocomplete-menu hidden';
  textarea.parentElement.appendChild(menu);

  let activeIdx = 0;
  let matches = [];
  let triggerStart = -1;

  const hideMenu = () => {
    menu.classList.add('hidden');
    matches = [];
    triggerStart = -1;
  };

  const applySelection = (title) => {
    if (triggerStart === -1) return;
    const cursor = textarea.selectionStart;
    const before = textarea.value.slice(0, triggerStart);
    const after = textarea.value.slice(cursor);
    const insertion = `[[${title}]]`;
    textarea.value = before + insertion + after;
    const nextPos = before.length + insertion.length;
    textarea.focus();
    textarea.setSelectionRange(nextPos, nextPos);
    hideMenu();
  };

  const renderMenu = () => {
    if (matches.length === 0) {
      hideMenu();
      return;
    }
    menu.innerHTML = matches.map((entry, idx) => `
      <button type="button" class="nyx-autocomplete-item ${idx === activeIdx ? 'active' : ''}" data-ac-idx="${idx}">
        <span class="font-bold truncate">${escapeHtml(entry.title)}</span>
        <span class="text-[10px] font-mono-code text-[var(--texto-mutado)] shrink-0">${escapeHtml(entry.category || 'Wiki')}</span>
      </button>
    `).join('');
    menu.classList.remove('hidden');

    menu.querySelectorAll('[data-ac-idx]').forEach(btn => {
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const chosen = matches[Number(btn.dataset.acIdx)];
        if (chosen) applySelection(chosen.title);
      });
    });
  };

  textarea.addEventListener('input', () => {
    const cursor = textarea.selectionStart;
    const textBefore = textarea.value.slice(0, cursor);
    const match = textBefore.match(/\[\[([^\[\]\n]*)$/);

    if (!match) {
      hideMenu();
      return;
    }

    triggerStart = cursor - match[0].length;
    const query = match[1].trim().toLowerCase();
    matches = wikiEntries
      .filter(w => !query || (w.title || '').toLowerCase().includes(query))
      .slice(0, 7);
    activeIdx = 0;
    renderMenu();
  });

  textarea.addEventListener('keydown', (e) => {
    if (menu.classList.contains('hidden') || matches.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIdx = (activeIdx + 1) % matches.length;
      renderMenu();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx = (activeIdx - 1 + matches.length) % matches.length;
      renderMenu();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      applySelection(matches[activeIdx].title);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      hideMenu();
    }
  });

  textarea.addEventListener('blur', () => {
    setTimeout(hideMenu, 140);
  });
}

export function openEditorModal(existing = null, prefillTitle = '', prefillOptions = {}) {
  const modalRoot = document.getElementById('modal-root');
  let currentImage = existing?.imageUrl || '';
  let selectedTags = Array.isArray(existing?.tags) ? [...existing.tags] : [];
  const availableTags = getAllTags();
  const masterMode = isMaster();
  const initialTitle = existing?.title || prefillTitle || '';
  const initialCategory = existing?.category || prefillOptions.category || 'Locais';
  const initialParentId = existing?.parentId || prefillOptions.parentId || '';

  const blockedIds = existing ? getDescendantIds(existing.id) : new Set();
  if (existing) blockedIds.add(existing.id);

  const availableParents = wikiEntries
    .filter(w => w.category === 'Locais' && !blockedIds.has(w.id))
    .map(w => ({ id: w.id, path: getFullHierarchyPath(w) }))
    .sort((a, b) => a.path.localeCompare(b.path, 'pt-BR'));

  modalRoot.innerHTML = `
    <div class="nyx-modal-backdrop" id="editor-backdrop">
      <div class="bg-[var(--bg-surface)] border border-[var(--dourado)] rounded-xl max-w-xl w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl">
        <div class="flex items-center justify-between border-b border-[var(--borda-fina)] pb-3 mb-4">
          <h3 class="text-xl font-bold text-[var(--dourado)]">${existing ? 'Editar Registro' : 'Novo Registro na Wiki'}</h3>
          <button id="close-editor" class="text-sm text-[var(--texto-mutado)] hover:text-white">✕</button>
        </div>

        <form id="wiki-editor-form" class="space-y-4">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label class="block text-xs text-[var(--dourado-claro)] mb-1">Categoria</label>
              <select id="wiki-cat" class="w-full bg-[var(--bg-card)] text-[var(--texto-principal)] border border-[var(--borda-fina)] rounded-lg px-3 py-2 text-sm focus:border-[var(--dourado)] focus:outline-none">
                ${CATEGORIES.filter(c => c !== 'Todos').map(c => `<option value="${c}" ${initialCategory === c ? 'selected' : ''}>${c}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="block text-xs text-[var(--dourado-claro)] mb-1">Local Pai (Árvore Cidade › Distrito)</label>
              <select id="wiki-parent-id" class="w-full bg-[var(--bg-card)] text-[var(--texto-principal)] border border-[var(--borda-fina)] rounded-lg px-3 py-2 text-sm focus:border-[var(--dourado)] focus:outline-none">
                <option value="">— Nenhum (Cidade / Raiz) —</option>
                ${availableParents.map(p => `<option value="${p.id}" ${initialParentId === p.id ? 'selected' : ''}>${escapeHtml(p.path)}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label class="block text-xs text-[var(--dourado-claro)] mb-1">Título do Registro</label>
              <input type="text" id="wiki-title" required value="${escapeHtml(initialTitle)}" placeholder="Ex: Enseada da Gamboa ou Diovan Larkin"
                class="w-full bg-[var(--bg-card)] text-[var(--texto-principal)] border border-[var(--borda-fina)] rounded-lg px-3 py-2 text-sm focus:border-[var(--dourado)] focus:outline-none">
            </div>
            <div>
              <label class="block text-xs text-[var(--dourado-claro)] mb-1">Subtítulo / Região (Opcional)</label>
              <input type="text" id="wiki-sub" list="distritos-list" value="${escapeHtml(existing?.subtitle || '')}" placeholder="Ex: Distrito Portuário, Conselheiro..."
                class="w-full bg-[var(--bg-card)] text-[var(--texto-principal)] border border-[var(--borda-fina)] rounded-lg px-3 py-2 text-sm focus:border-[var(--dourado)] focus:outline-none">
              <datalist id="distritos-list">
                ${DISTRITOS_SUGESTOES.map(d => `<option value="${escapeHtml(d)}">`).join('')}
              </datalist>
            </div>
          </div>

          <div>
            <label class="block text-xs text-[var(--dourado-claro)] mb-1.5">Tags Vinculadas (Clique para marcar)</label>
            <div id="editor-tags-picker" class="flex flex-wrap gap-1.5 p-2.5 rounded-lg bg-[var(--bg-card)] border border-[var(--borda-fina)]">
              ${availableTags.length === 0
                ? `<span class="text-xs text-[var(--texto-mutado)]">Nenhuma tag criada ainda. Use "🏷️ Gerenciar Tags" na tela anterior.</span>`
                : availableTags.map(t => `
                  <button type="button" data-pick-tag="${escapeHtml(t.name)}" class="nyx-tag-selectable ${selectedTags.includes(t.name) ? 'selected' : ''}">
                    #${escapeHtml(t.name)}
                  </button>
                `).join('')
              }
            </div>
          </div>

          <div>
            <label class="block text-xs text-[var(--dourado-claro)] mb-1">Imagem (Envie do PC ou cole um Link)</label>
            <div class="flex flex-col sm:flex-row gap-2">
              <input type="file" id="wiki-file" accept="image/*" class="text-xs text-[var(--texto-mutado)] file:mr-2 file:py-1.5 file:px-3 file:rounded file:border file:border-[var(--borda-fina)] file:bg-[var(--bg-card)] file:text-[var(--dourado-claro)]">
              <input type="url" id="wiki-url" value="${currentImage.startsWith('http') ? escapeHtml(currentImage) : ''}" placeholder="Ou cole URL https://..."
                class="flex-1 bg-[var(--bg-card)] text-[var(--texto-principal)] border border-[var(--borda-fina)] rounded-lg px-3 py-1.5 text-xs focus:border-[var(--dourado)] focus:outline-none">
            </div>
            <img id="wiki-preview" src="${currentImage}" class="${currentImage ? '' : 'hidden'} mt-2 max-h-36 rounded border border-[var(--borda-fina)] object-contain bg-[#09090c]">
          </div>

          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="text-xs text-[var(--dourado-claro)]">Descrição Pública (Visível para todos)</label>
              <span class="text-[10px] font-mono-code text-[var(--texto-mutado)]">Digite <strong class="text-[var(--dourado)]">[[</strong> para conectar wikis</span>
            </div>
            <textarea id="wiki-content" rows="4" required placeholder="Escreva a história, características ou use [[Nome da Wiki]] para criar links..."
              class="w-full bg-[var(--bg-card)] text-[var(--texto-principal)] border border-[var(--borda-fina)] rounded-lg p-3 text-sm focus:border-[var(--dourado)] focus:outline-none">${escapeHtml(existing?.content || '')}</textarea>
          </div>

          ${masterMode ? `
            <div class="p-3.5 rounded-xl border border-dashed border-[var(--vinho)] bg-[#100305] space-y-2.5">
              <div class="flex items-center justify-between">
                <label class="text-xs font-bold text-[var(--dourado)]">🔒 Segredo / Anotação do Mestre</label>
                <label class="flex items-center gap-1.5 text-xs text-[var(--dourado-claro)] cursor-pointer">
                  <input type="checkbox" id="wiki-secret-revealed" ${existing?.secretRevealed ? 'checked' : ''} class="accent-[#D4AF37]">
                  Já revelado aos jogadores
                </label>
              </div>
              <div class="relative">
                <textarea id="wiki-master-secret" rows="3" placeholder="Intenções ocultas, segredos de clã ou pistas com [[Links]]..."
                  class="w-full bg-[var(--bg-card)] text-[var(--texto-principal)] border border-[var(--borda-fina)] rounded-lg p-3 text-sm focus:border-[var(--dourado)] focus:outline-none">${escapeHtml(existing?.masterSecret || '')}</textarea>
              </div>
            </div>
          ` : ''}

          <div class="flex justify-end gap-3 pt-2">
            <button type="button" id="cancel-editor" class="px-4 py-2 rounded-lg text-xs text-[var(--texto-mutado)] hover:text-white">Cancelar</button>
            <button type="submit" id="save-wiki-btn" class="px-5 py-2 rounded-lg bg-[var(--vinho-escuro)] hover:bg-[var(--vinho)] border border-[var(--dourado)] text-[var(--dourado-claro)] font-bold text-sm transition">
              Salvar no NyX
            </button>
          </div>
        </form>
      </div>
    </div>
  `;

  attachWikiLinkAutocomplete(document.getElementById('wiki-content'));
  if (masterMode) {
    attachWikiLinkAutocomplete(document.getElementById('wiki-master-secret'));
  }

  modalRoot.querySelectorAll('[data-pick-tag]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tag = btn.dataset.pickTag;
      if (selectedTags.includes(tag)) {
        selectedTags = selectedTags.filter(t => t !== tag);
        btn.classList.remove('selected');
      } else {
        selectedTags.push(tag);
        btn.classList.add('selected');
      }
    });
  });

  const previewEl = document.getElementById('wiki-preview');
  const urlInput = document.getElementById('wiki-url');
  const fileInput = document.getElementById('wiki-file');

  urlInput.addEventListener('input', () => {
    currentImage = urlInput.value.trim();
    previewEl.src = currentImage;
    previewEl.classList.toggle('hidden', !currentImage);
  });

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    currentImage = await compressImageToWebP(file);
    urlInput.value = '';
    previewEl.src = currentImage;
    previewEl.classList.remove('hidden');
  });

  const close = () => modalRoot.innerHTML = '';
  document.getElementById('close-editor').addEventListener('click', close);
  document.getElementById('cancel-editor').addEventListener('click', close);

  document.getElementById('wiki-editor-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const saveBtn = document.getElementById('save-wiki-btn');
    saveBtn.disabled = true;
    saveBtn.innerText = 'Salvando...';

    const masterSecretVal = masterMode
      ? document.getElementById('wiki-master-secret').value.trim()
      : (existing?.masterSecret || '');

    const secretRevealedVal = masterMode
      ? document.getElementById('wiki-secret-revealed').checked
      : (existing?.secretRevealed || false);

    const payload = {
      category: document.getElementById('wiki-cat').value,
      parentId: document.getElementById('wiki-parent-id').value || '',
      subtitle: document.getElementById('wiki-sub').value.trim(),
      title: document.getElementById('wiki-title').value.trim(),
      tags: selectedTags,
      imageUrl: currentImage,
      content: document.getElementById('wiki-content').value.trim(),
      masterSecret: masterSecretVal,
      secretRevealed: secretRevealedVal,
      updatedAt: serverTimestamp()
    };

    if (existing) {
      await updateDoc(doc(db, 'wikis', existing.id), payload);
    } else {
      await addDoc(collection(db, 'wikis'), { ...payload, createdAt: serverTimestamp() });
    }
    close();
  });
}