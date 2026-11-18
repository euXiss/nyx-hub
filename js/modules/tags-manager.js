// js/modules/tags-manager.js
import { db } from '../config/firebase.js';
import {
  doc,
  setDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const TAGS_DOC_REF = doc(db, 'wikis', 'nyx_config_tags');

let customTags = [];
let unsubscribeTags = null;
let onTagsChangedCallback = null;

export const SCENARIO_BASE_TAGS = [
  { name: "Tex'Otália", group: "Cidade" },
  { name: "Anarkamundo", group: "Cidade" },
  { name: "Biomassa", group: "Cidade" },
  { name: "Descarte", group: "Região" },
  { name: "Terras Livres", group: "Região" },
  { name: "Terras Selvagens", group: "Região" },
  { name: "Terras Mortas", group: "Região" }
];

export const DISTRITOS_SUGESTOES = [
  "Tex'Otália • Boa Praça", "Tex'Otália • Mercês", "Tex'Otália • Engenho",
  "Tex'Otália • Alto da Sé", "Tex'Otália • Enseada da Gamboa", "Tex'Otália • Encantado",
  "Anarkamundo • Altamira", "Anarkamundo • Ponto Cego", "Anarkamundo • Valão",
  "Anarkamundo • Ponta Fumenta", "Anarkamundo • Poço Fundo", "Anarkamundo • Beirada",
  "Biomassa • Alto Regente", "Biomassa • Belverde", "Biomassa • Horto",
  "Biomassa • Estrada da Passagem", "Biomassa • Portão Cardeal", "Biomassa • Vila Vimera"
];

function escapeHtml(str = '') {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function initTagsSync(onUpdate) {
  onTagsChangedCallback = onUpdate;
  if (unsubscribeTags) return;

  unsubscribeTags = onSnapshot(TAGS_DOC_REF, (snap) => {
    if (snap.exists() && Array.isArray(snap.data().items)) {
      customTags = snap.data().items;
    } else {
      customTags = [];
    }
    if (onTagsChangedCallback) onTagsChangedCallback(customTags);
  }, (err) => {
    console.error("Erro ao sincronizar tags:", err);
  });
}

export function getAllTags() {
  return customTags;
}

async function saveTagsList(newList) {
  await setDoc(TAGS_DOC_REF, { items: newList }, { merge: true });
  customTags = newList;
  if (onTagsChangedCallback) onTagsChangedCallback(customTags);
}

export function openTagsModal() {
  const modalRoot = document.getElementById('modal-root');

  const renderModal = () => {
    modalRoot.innerHTML = `
      <div class="nyx-modal-backdrop" id="tags-backdrop">
        <div class="bg-[var(--bg-surface)] border border-[var(--dourado)] rounded-xl max-w-lg w-full max-h-[88vh] overflow-y-auto p-6 shadow-2xl">
          <div class="flex items-center justify-between border-b border-[var(--borda-fina)] pb-3 mb-4">
            <h3 class="text-xl font-bold text-[var(--dourado)]">Gerenciar Tags do NyX</h3>
            <button id="close-tags-modal" class="text-sm text-[var(--texto-mutado)] hover:text-white">✕</button>
          </div>

          <form id="add-tag-form" class="flex flex-col sm:flex-row gap-2 mb-4">
            <input type="text" id="new-tag-name" required placeholder="Nome da tag (ex: Vampiro, Clã Venebre...)"
              class="flex-1 bg-[var(--bg-card)] text-[var(--texto-principal)] border border-[var(--borda-fina)] rounded-lg px-3 py-2 text-sm focus:border-[var(--dourado)] focus:outline-none">
            <select id="new-tag-group" class="bg-[var(--bg-card)] text-[var(--texto-principal)] border border-[var(--borda-fina)] rounded-lg px-3 py-2 text-xs focus:border-[var(--dourado)] focus:outline-none">
              <option value="Cenário">Cenário</option>
              <option value="Personagem">Personagem</option>
              <option value="Sistema">Sistema</option>
              <option value="Geral">Geral</option>
            </select>
            <button type="submit" id="btn-submit-tag" class="px-4 py-2 rounded-lg bg-[var(--vinho-escuro)] hover:bg-[var(--vinho)] border border-[var(--dourado)] text-[var(--dourado-claro)] text-xs font-bold transition">
              + Criar
            </button>
          </form>

          <div class="mb-4 pb-4 border-b border-[var(--borda-fina)] flex items-center justify-between">
            <span class="text-xs text-[var(--texto-mutado)]">Cidades e regiões principais do mundo:</span>
            <button type="button" id="btn-seed-regions" class="text-xs text-[var(--dourado)] hover:underline font-semibold">
              + Importar Cidades & Regiões Base
            </button>
          </div>

          <div class="space-y-2 max-h-64 overflow-y-auto pr-1">
            ${customTags.length === 0
              ? `<p class="text-xs text-[var(--texto-mutado)] text-center py-4">Nenhuma tag criada ainda. Crie acima ou importe as cidades base.</p>`
              : customTags.map((t, idx) => `
                <div class="flex items-center justify-between bg-[var(--bg-card)] border border-[var(--borda-fina)] rounded-lg px-3 py-2">
                  <div class="flex items-center gap-2">
                    <span class="text-sm text-[var(--dourado-claro)] font-semibold">#${escapeHtml(t.name)}</span>
                    <span class="text-[10px] font-mono-code px-2 py-0.5 rounded bg-black/40 text-[var(--texto-mutado)]">${escapeHtml(t.group || 'Geral')}</span>
                  </div>
                  <button data-del-tag="${idx}" class="text-xs text-red-400 hover:text-red-300">Remover</button>
                </div>
              `).join('')
            }
          </div>
        </div>
      </div>
    `;

    document.getElementById('close-tags-modal').addEventListener('click', () => modalRoot.innerHTML = '');
    document.getElementById('tags-backdrop').addEventListener('click', (e) => {
      if (e.target.id === 'tags-backdrop') modalRoot.innerHTML = '';
    });

    document.getElementById('add-tag-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const nameInput = document.getElementById('new-tag-name');
      const submitBtn = document.getElementById('btn-submit-tag');
      const name = nameInput.value.trim();
      const group = document.getElementById('new-tag-group').value;
      if (!name) return;

      if (customTags.some(t => t.name.toLowerCase() === name.toLowerCase())) {
        alert('Essa tag já existe.');
        return;
      }

      try {
        submitBtn.disabled = true;
        submitBtn.innerText = '...';
        await saveTagsList([...customTags, { name, group }]);
        renderModal();
      } catch (err) {
        alert('Erro ao salvar tag no Firebase: ' + err.message);
        submitBtn.disabled = false;
        submitBtn.innerText = '+ Criar';
      }
    });

    document.getElementById('btn-seed-regions').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const merged = [...customTags];
      SCENARIO_BASE_TAGS.forEach(base => {
        if (!merged.some(t => t.name.toLowerCase() === base.name.toLowerCase())) {
          merged.push(base);
        }
      });

      try {
        btn.disabled = true;
        btn.innerText = 'Importando...';
        await saveTagsList(merged);
        renderModal();
      } catch (err) {
        alert('Erro ao importar regiões no Firebase: ' + err.message);
        btn.disabled = false;
        btn.innerText = '+ Importar Cidades & Regiões Base';
      }
    });

    modalRoot.querySelectorAll('[data-del-tag]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const index = Number(btn.dataset.delTag);
        const updated = customTags.filter((_, i) => i !== index);
        try {
          await saveTagsList(updated);
          renderModal();
        } catch (err) {
          alert('Erro ao remover tag: ' + err.message);
        }
      });
    });
  };

  renderModal();
}

export function openTagFilterModal(activeTag, onSelectTag) {
  const modalRoot = document.getElementById('modal-root');
  let searchTerm = '';

  const renderModal = () => {
    const filtered = customTags.filter(t =>
      t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (t.group || '').toLowerCase().includes(searchTerm.toLowerCase())
    );

    const grouped = filtered.reduce((acc, tag) => {
      const grp = tag.group || 'Geral';
      if (!acc[grp]) acc[grp] = [];
      acc[grp].push(tag);
      return acc;
    }, {});

    modalRoot.innerHTML = `
      <div class="nyx-modal-backdrop" id="filter-tags-backdrop">
        <div class="bg-[var(--bg-surface)] border border-[var(--dourado)] rounded-xl max-w-lg w-full max-h-[85vh] overflow-y-auto p-6 shadow-2xl">
          <div class="flex items-center justify-between border-b border-[var(--borda-fina)] pb-3 mb-4">
            <h3 class="text-xl font-bold text-[var(--dourado)]">Filtrar Wikis por Tag</h3>
            <button id="close-filter-tags" class="text-sm text-[var(--texto-mutado)] hover:text-white">✕</button>
          </div>

          <div class="flex gap-2 mb-4">
            <input type="text" id="filter-tag-search" value="${escapeHtml(searchTerm)}" placeholder="Buscar tag..."
              class="flex-1 bg-[var(--bg-card)] text-[var(--texto-principal)] border border-[var(--borda-fina)] rounded-lg px-3 py-2 text-sm focus:border-[var(--dourado)] focus:outline-none">
            ${activeTag ? `
              <button type="button" id="btn-clear-active-tag" class="px-3 py-2 rounded-lg border border-red-500/50 text-red-400 hover:bg-[var(--vinho-escuro)] text-xs font-semibold transition">
                Limpar Filtro
              </button>
            ` : ''}
          </div>

          <div class="space-y-4 max-h-72 overflow-y-auto pr-1">
            ${customTags.length === 0
              ? `<p class="text-xs text-[var(--texto-mutado)] text-center py-6">Nenhuma tag criada ainda. Use "🏷️ Gerenciar Tags" para cadastrar.</p>`
              : Object.keys(grouped).length === 0
                ? `<p class="text-xs text-[var(--texto-mutado)] text-center py-6">Nenhuma tag encontrada para essa busca.</p>`
                : Object.entries(grouped).map(([groupName, tags]) => `
                  <div>
                    <p class="text-[11px] font-mono-code uppercase tracking-wider text-[var(--texto-mutado)] mb-2">${escapeHtml(groupName)}</p>
                    <div class="flex flex-wrap gap-2">
                      ${tags.map(t => `
                        <button type="button" data-choose-tag="${escapeHtml(t.name)}" class="nyx-tag-pill ${activeTag === t.name ? 'active' : ''}">
                          #${escapeHtml(t.name)}
                        </button>
                      `).join('')}
                    </div>
                  </div>
                `).join('')
            }
          </div>
        </div>
      </div>
    `;

    const close = () => modalRoot.innerHTML = '';
    document.getElementById('close-filter-tags').addEventListener('click', close);
    document.getElementById('filter-tags-backdrop').addEventListener('click', (e) => {
      if (e.target.id === 'filter-tags-backdrop') close();
    });

    const searchInput = document.getElementById('filter-tag-search');
    searchInput.focus();
    searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
    searchInput.addEventListener('input', (e) => {
      searchTerm = e.target.value;
      renderModal();
    });

    const clearBtn = document.getElementById('btn-clear-active-tag');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        onSelectTag(null);
        close();
      });
    }

    modalRoot.querySelectorAll('[data-choose-tag]').forEach(btn => {
      btn.addEventListener('click', () => {
        const chosen = btn.dataset.chooseTag;
        onSelectTag(activeTag === chosen ? null : chosen);
        close();
      });
    });
  };

  renderModal();
}