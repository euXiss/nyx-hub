// js/modules/wiki-cms.js
import { db } from '../config/firebase.js';
import {
  collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
  initTagsSync, getAllTags, openTagsModal, openTagFilterModal, DISTRITOS_SUGESTOES
} from './tags-manager.js';

let wikiEntries = [];
let activeCategory = 'Todos';
let activeTag = null;
let unsubscribeWiki = null;

const CATEGORIES = ['Todos', 'Locais', 'NPCs', 'Facções', 'Regras'];

function escapeHtml(str = '') {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

export function getWikiEntries() {
  return wikiEntries;
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

    <div id="wiki-list" class="wiki-grid">
      <p class="text-sm text-[var(--texto-mutado)]">Sincronizando arquivos do universo...</p>
    </div>
  `;

  document.getElementById('btn-manage-tags').addEventListener('click', () => openTagsModal());
  document.getElementById('btn-new-wiki').addEventListener('click', () => openEditorModal());

  initTagsSync(() => {
    if (document.getElementById('tag-filter-control')) renderTagFilterButton();
  });

  renderFilters();
  renderTagFilterButton();
  renderCards();

  if (!unsubscribeWiki) {
    unsubscribeWiki = onSnapshot(collection(db, 'wikis'), (snapshot) => {
      wikiEntries = snapshot.docs
        .filter(d => d.id !== 'nyx_config_tags')
        .map(d => ({ id: d.id, ...d.data() }));
      wikiEntries.sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0));
      if (document.getElementById('wiki-list')) renderCards();
    });
  }
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
      renderFilters();
      renderCards();
    });
  });
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

function renderCards() {
  const listEl = document.getElementById('wiki-list');
  if (!listEl) return;

  const filtered = wikiEntries.filter(item => {
    const matchCat = activeCategory === 'Todos' || item.category === activeCategory;
    const matchTag = !activeTag || (Array.isArray(item.tags) && item.tags.includes(activeTag));
    return matchCat && matchTag;
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

  listEl.innerHTML = filtered.map(item => `
    <article class="wiki-card group" data-open-id="${item.id}" id="wiki-card-${item.id}">
      ${item.imageUrl ? `<img src="${item.imageUrl}" alt="${escapeHtml(item.title)}" class="wiki-card-cover">` : ''}
      <div class="p-5 flex-1 flex flex-col justify-between">
        <div>
          <div class="flex items-center justify-between gap-2 mb-2">
            <span class="wiki-badge">${escapeHtml(item.category || 'Geral')}</span>
            ${item.subtitle ? `<span class="text-xs text-[var(--texto-mutado)] italic">${escapeHtml(item.subtitle)}</span>` : ''}
          </div>
          <h3 class="text-lg font-bold text-[var(--dourado)] group-hover:text-[var(--dourado-claro)] transition mb-2">${escapeHtml(item.title)}</h3>
          <p class="text-sm text-[var(--texto-principal)] opacity-90 wiki-excerpt mb-3">${escapeHtml(item.content)}</p>
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
            <button type="button" data-del="${item.id}" class="text-red-400 hover:text-red-300">Excluir</button>
          </div>
        </div>
      </div>
    </article>
  `).join('');

  listEl.querySelectorAll('.wiki-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      openReaderModal(card.dataset.openId);
    });
  });

  listEl.querySelectorAll('[data-jump-tag]').forEach(b => b.addEventListener('click', () => {
    activeCategory = 'Todos';
    activeTag = b.dataset.jumpTag;
    renderFilters();
    renderTagFilterButton();
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

  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = `
    <div class="nyx-modal-backdrop" id="reader-backdrop">
      <div class="bg-[var(--bg-surface)] border border-[var(--dourado)] rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        ${item.imageUrl ? `<div class="wiki-reader-media-wrap"><img src="${item.imageUrl}" alt="${escapeHtml(item.title)}" class="wiki-reader-media"></div>` : ''}
        <div class="p-6 md:p-8">
          <div class="flex items-center justify-between mb-3">
            <span class="wiki-badge">${escapeHtml(item.category)}</span>
            <button id="close-reader" class="text-sm text-[var(--texto-mutado)] hover:text-[var(--dourado)]">✕ Fechar</button>
          </div>
          <h2 class="text-2xl md:text-3xl font-bold text-[var(--dourado)] mb-1">${escapeHtml(item.title)}</h2>
          ${item.subtitle ? `<p class="text-sm text-[var(--dourado-claro)] italic mb-4">${escapeHtml(item.subtitle)}</p>` : '<div class="mb-4"></div>'}
          ${Array.isArray(item.tags) && item.tags.length > 0 ? `
            <div class="flex flex-wrap gap-1.5 mb-5">
              ${item.tags.map(tag => `<button type="button" data-reader-tag="${escapeHtml(tag)}" class="nyx-tag-pill">#${escapeHtml(tag)}</button>`).join('')}
            </div>
          ` : ''}
          <div class="text-base text-[var(--texto-principal)] wiki-full-text">${escapeHtml(item.content)}</div>
        </div>
      </div>
    </div>
  `;

  modalRoot.querySelectorAll('[data-reader-tag]').forEach(btn => {
    btn.addEventListener('click', () => {
      modalRoot.innerHTML = '';
      activeCategory = 'Todos';
      activeTag = btn.dataset.readerTag;
      renderFilters();
      renderTagFilterButton();
      renderCards();
    });
  });

  document.getElementById('close-reader').addEventListener('click', () => modalRoot.innerHTML = '');
  document.getElementById('reader-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'reader-backdrop') modalRoot.innerHTML = '';
  });
}

function openEditorModal(existing = null) {
  const modalRoot = document.getElementById('modal-root');
  let currentImage = existing?.imageUrl || '';
  let selectedTags = Array.isArray(existing?.tags) ? [...existing.tags] : [];
  const availableTags = getAllTags();

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
                ${CATEGORIES.filter(c => c !== 'Todos').map(c => `<option value="${c}" ${existing?.category === c ? 'selected' : ''}>${c}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="block text-xs text-[var(--dourado-claro)] mb-1">Distrito / Região (Autocompletar)</label>
              <input type="text" id="wiki-sub" list="distritos-list" value="${escapeHtml(existing?.subtitle || '')}" placeholder="Ex: Tex'Otália • Enseada da Gamboa"
                class="w-full bg-[var(--bg-card)] text-[var(--texto-principal)] border border-[var(--borda-fina)] rounded-lg px-3 py-2 text-sm focus:border-[var(--dourado)] focus:outline-none">
              <datalist id="distritos-list">
                ${DISTRITOS_SUGESTOES.map(d => `<option value="${escapeHtml(d)}">`).join('')}
              </datalist>
            </div>
          </div>

          <div>
            <label class="block text-xs text-[var(--dourado-claro)] mb-1">Título do Registro</label>
            <input type="text" id="wiki-title" required value="${escapeHtml(existing?.title || '')}" placeholder="Ex: O Vitruviano ou Diovan Larkin"
              class="w-full bg-[var(--bg-card)] text-[var(--texto-principal)] border border-[var(--borda-fina)] rounded-lg px-3 py-2 text-sm focus:border-[var(--dourado)] focus:outline-none">
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
            <label class="block text-xs text-[var(--dourado-claro)] mb-1">Descrição e Informações</label>
            <textarea id="wiki-content" rows="5" required placeholder="Escreva a história, características ou aparência..."
              class="w-full bg-[var(--bg-card)] text-[var(--texto-principal)] border border-[var(--borda-fina)] rounded-lg p-3 text-sm focus:border-[var(--dourado)] focus:outline-none">${escapeHtml(existing?.content || '')}</textarea>
          </div>

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

    const payload = {
      category: document.getElementById('wiki-cat').value,
      subtitle: document.getElementById('wiki-sub').value.trim(),
      title: document.getElementById('wiki-title').value.trim(),
      tags: selectedTags,
      imageUrl: currentImage,
      content: document.getElementById('wiki-content').value.trim(),
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