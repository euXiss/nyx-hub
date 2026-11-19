// js/modules/roles-manager.js
import { db, auth } from '../config/firebase.js';
import {
  doc,
  setDoc,
  getDocs,
  collection,
  writeBatch,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const ROLES_DOC_REF = doc(db, 'wikis', 'nyx_config_roles');
const LAST_BACKUP_KEY = 'nyx_last_backup_at';
const OPTIONAL_COLLECTIONS = ['characters', 'talents', 'fichas', 'talentos'];

let membersMap = {};
let currentUid = null;
let unsubscribeRoles = null;
let roleListeners = [];
let pendingRestoreSnapshot = null;

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function onRoleUpdated(cb) {
  roleListeners.push(cb);
}

function notifyRoleListeners() {
  const role = getCurrentUserRole();
  roleListeners.forEach(cb => cb(role, membersMap));
}

export function getCurrentUserRole() {
  if (!currentUid || !membersMap[currentUid]) return 'jogador';
  return membersMap[currentUid].role || 'jogador';
}

export function isMaster() {
  return getCurrentUserRole() === 'mestre';
}

export function getAllMembers() {
  return Object.values(membersMap);
}

export function initRolesSync(user) {
  if (!user) {
    currentUid = null;
    notifyRoleListeners();
    return;
  }

  currentUid = user.uid;
  const displayName = (user.displayName && user.displayName.trim())
    ? user.displayName.trim()
    : (user.email ? user.email.split('@')[0] : 'Aventureiro');

  if (unsubscribeRoles) {
    unsubscribeRoles();
    unsubscribeRoles = null;
  }

  unsubscribeRoles = onSnapshot(ROLES_DOC_REF, async (snap) => {
    const data = snap.exists() ? (snap.data().members || {}) : {};
    membersMap = data;

    const existing = membersMap[user.uid];
    if (!existing) {
      const hasAnyMaster = Object.values(membersMap).some(m => m.role === 'mestre');
      const assignedRole = hasAnyMaster ? 'jogador' : 'mestre';

      const updatedMembers = {
        ...membersMap,
        [user.uid]: {
          uid: user.uid,
          email: user.email || '',
          displayName,
          role: assignedRole
        }
      };

      membersMap = updatedMembers;
      await setDoc(ROLES_DOC_REF, { members: updatedMembers }, { merge: true });
    } else if (existing.displayName !== displayName || existing.email !== (user.email || '')) {
      const updatedMembers = {
        ...membersMap,
        [user.uid]: {
          ...existing,
          displayName,
          email: user.email || ''
        }
      };
      membersMap = updatedMembers;
      await setDoc(ROLES_DOC_REF, { members: updatedMembers }, { merge: true });
    }

    notifyRoleListeners();
  }, (err) => {
    console.error('Erro ao sincronizar cargos:', err);
  });
}

export async function setMemberRole(targetUid, newRole) {
  if (!isMaster() || !membersMap[targetUid]) return;
  const updatedMembers = {
    ...membersMap,
    [targetUid]: {
      ...membersMap[targetUid],
      role: newRole
    }
  };
  await setDoc(ROLES_DOC_REF, { members: updatedMembers }, { merge: true });
}

/* Exportação e Restauração de Backup Completo (JSON) */
async function exportFullDatabaseBackup() {
  const collectionsData = {};

  const wikisSnap = await getDocs(collection(db, 'wikis'));
  collectionsData.wikis = wikisSnap.docs.map(d => ({
    id: d.id,
    data: d.data()
  }));

  for (const colName of OPTIONAL_COLLECTIONS) {
    try {
      const snap = await getDocs(collection(db, colName));
      if (!snap.empty) {
        collectionsData[colName] = snap.docs.map(d => ({
          id: d.id,
          data: d.data()
        }));
      }
    } catch {
      // Coleção opcional inexistente ou sem leitura configurada
    }
  }

  const now = new Date();
  const payload = {
    app: 'NyX',
    nyxBackupVersion: 1,
    exportedAt: now.toISOString(),
    exportedBy: auth.currentUser?.email || auth.currentUser?.displayName || 'Mestre',
    collections: collectionsData
  };

  const jsonStr = JSON.stringify(payload, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-') + '_' + [
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0')
  ].join('-');

  const a = document.createElement('a');
  a.href = url;
  a.download = `nyx-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  localStorage.setItem(LAST_BACKUP_KEY, now.toLocaleString('pt-BR'));
  return collectionsData.wikis.length;
}

function summarizeBackupSnapshot(snapshot) {
  const wikisDocs = Array.isArray(snapshot?.collections?.wikis) ? snapshot.collections.wikis : [];
  let wikiCount = 0;
  let cardsCount = 0;
  let framesCount = 0;
  let boardsCount = 0;

  for (const item of wikisDocs) {
    if (item.id === 'nyx_config_tags' || item.id === 'nyx_config_roles') continue;
    const type = item.data?.nyxType;
    if (type === 'canvas_card') cardsCount++;
    else if (type === 'canvas_frame') framesCount++;
    else if (type === 'canvas_board') boardsCount++;
    else wikiCount++;
  }

  const extraCollections = Object.keys(snapshot?.collections || {}).filter(k => k !== 'wikis');

  return {
    totalDocs: wikisDocs.length,
    wikiCount,
    cardsCount,
    framesCount,
    boardsCount,
    extraCollections
  };
}

async function restoreDatabaseBackup(snapshot, preserveCurrentRoles = true) {
  if (!isMaster() || !snapshot?.collections) {
    throw new Error('Arquivo de backup inválido.');
  }

  const operations = [];

  for (const [colName, docsList] of Object.entries(snapshot.collections)) {
    if (!Array.isArray(docsList)) continue;

    for (const entry of docsList) {
      if (!entry?.id || !entry?.data || typeof entry.data !== 'object') continue;

      if (colName === 'wikis' && entry.id === 'nyx_config_roles' && preserveCurrentRoles) {
        continue;
      }

      const cleanData = { ...entry.data };
      delete cleanData.createdAt;
      delete cleanData.updatedAt;

      operations.push({
        ref: doc(db, colName, entry.id),
        data: cleanData
      });
    }
  }

  // Envia em lotes de até 400 operações (limite do Firestore é 500 por batch)
  const CHUNK_SIZE = 400;
  for (let i = 0; i < operations.length; i += CHUNK_SIZE) {
    const batch = writeBatch(db);
    const slice = operations.slice(i, i + CHUNK_SIZE);
    for (const op of slice) {
      batch.set(op.ref, op.data, { merge: false });
    }
    await batch.commit();
  }

  return operations.length;
}

export function mountMasterPanel(container, wikiEntries = [], onToggleSecret = null) {
  if (!isMaster()) {
    container.innerHTML = `
      <div class="max-w-lg mx-auto mt-8 bg-[var(--bg-card)] border border-[var(--vinho)] rounded-xl p-8 text-center shadow-2xl">
        <p class="text-2xl mb-2">🔒</p>
        <h2 class="text-xl font-bold text-[var(--dourado)] mb-2">Acesso Restrito ao Mestre</h2>
        <p class="text-sm text-[var(--texto-mutado)]">Apenas contas com o cargo de Mestre podem acessar os controles ocultos da mesa.</p>
      </div>
    `;
    return;
  }

  const members = getAllMembers();
  const entriesWithSecrets = wikiEntries.filter(w => w.masterSecret && w.masterSecret.trim());
  const lastBackupAt = localStorage.getItem(LAST_BACKUP_KEY);

  container.innerHTML = `
    <div class="space-y-6">
      <!-- Controle de Cargos -->
      <div class="bg-[var(--bg-card)] border border-[var(--dourado)] rounded-xl p-6 shadow-xl">
        <h2 class="text-xl font-bold text-[var(--dourado)] mb-1">Controle de Cargos da Mesa</h2>
        <p class="text-xs text-[var(--texto-mutado)] mb-5">Defina quem possui visão de Mestre (acesso a segredos ocultos) e quem atua como Jogador.</p>

        <div class="space-y-2.5">
          ${members.map(m => {
            const isM = m.role === 'mestre';
            const isSelf = m.uid === currentUid;
            return `
              <div class="flex flex-wrap items-center justify-between gap-3 bg-[#100406] border border-[var(--borda-fina)] rounded-lg px-4 py-3">
                <div>
                  <div class="flex items-center gap-2">
                    <span class="font-bold text-sm text-[var(--texto-principal)]">${escapeHtml(m.displayName)}</span>
                    ${isSelf ? `<span class="text-[10px] font-mono-code px-2 py-0.5 rounded bg-black/50 text-[var(--texto-mutado)]">Você</span>` : ''}
                    <span class="text-[10px] font-mono-code uppercase px-2 py-0.5 rounded border ${
                      isM
                        ? 'bg-[var(--vinho-escuro)] border-[var(--dourado)] text-[var(--dourado)]'
                        : 'bg-black/40 border-[var(--borda-fina)] text-[var(--texto-mutado)]'
                    }">${isM ? '👑 Mestre' : '🕵️ Jogador'}</span>
                  </div>
                  <p class="text-xs text-[var(--texto-mutado)] mt-0.5">${escapeHtml(m.email)}</p>
                </div>

                ${!isSelf ? `
                  <button type="button" data-toggle-role="${escapeHtml(m.uid)}" data-next-role="${isM ? 'jogador' : 'mestre'}"
                    class="px-3.5 py-1.5 rounded-lg border text-xs font-semibold ${
                      isM
                        ? 'bg-[#17080b] border-red-500/40 text-red-400 hover:bg-[var(--vinho-escuro)]'
                        : 'bg-[var(--vinho-escuro)] border-[var(--dourado)] text-[var(--dourado-claro)]'
                    }">
                    ${isM ? 'Mudar para Jogador' : 'Promover a Mestre'}
                  </button>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <!-- Backup & Restauração do Universo (JSON) -->
      <div class="bg-[var(--bg-card)] border border-[var(--borda-fina)] rounded-xl p-6 shadow-xl">
        <div class="flex flex-wrap items-start justify-between gap-4 mb-4">
          <div>
            <h2 class="text-xl font-bold text-[var(--dourado)] mb-1">Backup & Restauração do Banco (Snapshot)</h2>
            <p class="text-xs text-[var(--texto-mutado)]">Exporte uma cópia de segurança completa da Wiki, Árvore de Locais, Quadros de Pistas, Molduras e Tags em arquivo <code class="text-[var(--dourado-claro)]">.json</code>.</p>
          </div>
          <span id="backup-last-status" class="text-[11px] font-mono-code px-3 py-1 rounded-lg bg-[#100406] border border-[var(--borda-fina)] text-[var(--texto-mutado)]">
            ${lastBackupAt ? `💾 Último backup: ${escapeHtml(lastBackupAt)}` : '⚠️ Nenhum backup local registrado'}
          </span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <!-- Exportar -->
          <div class="bg-[#100406] border border-[var(--borda-fina)] rounded-lg p-4 flex flex-col justify-between gap-3">
            <div>
              <h3 class="text-sm font-bold text-[var(--dourado-claro)] mb-1">📥 Baixar Cópia de Segurança</h3>
              <p class="text-xs text-[var(--texto-mutado)] leading-relaxed">
                Gera um arquivo JSON datado com todos os registros atuais do Firebase para guardar no seu computador.
              </p>
            </div>
            <button type="button" id="btn-export-backup"
              class="w-full py-2.5 px-4 rounded-lg bg-[var(--vinho-escuro)] hover:bg-[var(--vinho)] border border-[var(--dourado)] text-[var(--dourado-claro)] text-xs font-bold transition shadow">
              ⬇️ Exportar Backup Completo (.json)
            </button>
          </div>

          <!-- Importar / Restaurar -->
          <div class="bg-[#100406] border border-[var(--borda-fina)] rounded-lg p-4 flex flex-col justify-between gap-3">
            <div>
              <h3 class="text-sm font-bold text-[var(--dourado-claro)] mb-1">📤 Restaurar de um Arquivo</h3>
              <p class="text-xs text-[var(--texto-mutado)] leading-relaxed">
                Selecione um arquivo <code class="text-[var(--dourado-claro)]">nyx-backup-*.json</code> para recuperar registros apagados ou reverter alterações.
              </p>
            </div>
            <label class="w-full py-2.5 px-4 rounded-lg bg-[var(--bg-card)] hover:border-[var(--dourado)] border border-[var(--borda-fina)] text-center text-xs font-semibold text-[var(--dourado-claro)] cursor-pointer transition">
              📂 Selecionar Arquivo .json
              <input type="file" id="input-restore-backup" accept=".json,application/json" class="hidden">
            </label>
          </div>
        </div>

        <!-- Prévia de Restauração -->
        <div id="backup-restore-preview" class="hidden mt-4 p-4 rounded-lg bg-[#140508] border border-[var(--dourado)]/70 space-y-3"></div>
      </div>

      <!-- Radar de Segredos -->
      <div class="bg-[var(--bg-card)] border border-[var(--borda-fina)] rounded-xl p-6 shadow-xl">
        <h2 class="text-xl font-bold text-[var(--dourado)] mb-1">Radar de Segredos da Wiki</h2>
        <p class="text-xs text-[var(--texto-mutado)] mb-5">Revele ou esconda rapidamente as anotações secretas dos artigos para os jogadores em tempo real.</p>

        ${entriesWithSecrets.length === 0
          ? `<p class="text-xs text-[var(--texto-mutado)] bg-[#100406] border border-[var(--borda-fina)] rounded-lg p-5 text-center">Nenhum registro da Wiki possui anotações secretas ainda. Edite qualquer artigo na Wiki para adicionar um segredo.</p>`
          : `<div class="space-y-2.5">
              ${entriesWithSecrets.map(item => `
                <div class="flex flex-wrap items-center justify-between gap-3 bg-[#100406] border border-[var(--borda-fina)] rounded-lg px-4 py-3">
                  <div>
                    <div class="flex items-center gap-2">
                      <span class="font-bold text-sm text-[var(--dourado-claro)]">${escapeHtml(item.title)}</span>
                      <span class="text-[10px] font-mono-code px-2 py-0.5 rounded ${
                        item.secretRevealed
                          ? 'bg-amber-950/60 border border-[var(--dourado)] text-[var(--dourado)]'
                          : 'bg-[var(--vinho-escuro)]/70 border border-red-500/40 text-red-300'
                      }">${item.secretRevealed ? '👁️ Revelado' : '🔒 Oculto'}</span>
                    </div>
                    <p class="text-xs text-[var(--texto-mutado)] line-clamp-1 mt-1">${escapeHtml(item.masterSecret)}</p>
                  </div>

                  <button type="button" data-panel-secret="${item.id}"
                    class="px-3.5 py-1.5 rounded-lg border text-xs font-semibold ${
                      item.secretRevealed
                        ? 'bg-[#17080b] border-[var(--borda-fina)] text-[var(--texto-mutado)] hover:text-white'
                        : 'bg-[var(--vinho-escuro)] border-[var(--dourado)] text-[var(--dourado-claro)]'
                    }">
                    ${item.secretRevealed ? 'Ocultar Novamente' : 'Revelar aos Jogadores'}
                  </button>
                </div>
              `).join('')}
            </div>`
        }
      </div>
    </div>
  `;

  container.querySelectorAll('[data-toggle-role]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await setMemberRole(btn.dataset.toggleRole, btn.dataset.nextRole);
    });
  });

  container.querySelectorAll('[data-panel-secret]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (onToggleSecret) await onToggleSecret(btn.dataset.panelSecret);
    });
  });

  // Botão Exportar Backup
  const exportBtn = document.getElementById('btn-export-backup');
  exportBtn.addEventListener('click', async () => {
    const originalText = exportBtn.innerText;
    exportBtn.disabled = true;
    exportBtn.innerText = 'Gerando Snapshot...';
    try {
      const count = await exportFullDatabaseBackup();
      const statusEl = document.getElementById('backup-last-status');
      if (statusEl) {
        statusEl.textContent = `💾 Último backup: ${localStorage.getItem(LAST_BACKUP_KEY)} (${count} docs)`;
      }
    } catch (err) {
      console.error('Erro ao exportar backup:', err);
      alert('Falha ao gerar backup: ' + (err.message || err));
    } finally {
      exportBtn.disabled = false;
      exportBtn.innerText = originalText;
    }
  });

  // Seleção de arquivo para Restaurar Backup
  const restoreInput = document.getElementById('input-restore-backup');
  const previewBox = document.getElementById('backup-restore-preview');

  restoreInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (!parsed || parsed.app !== 'NyX' || !parsed.collections?.wikis) {
          throw new Error('Este arquivo não é um backup válido do NyX.');
        }

        pendingRestoreSnapshot = parsed;
        const stats = summarizeBackupSnapshot(parsed);
        const dateLabel = parsed.exportedAt
          ? new Date(parsed.exportedAt).toLocaleString('pt-BR')
          : 'Data desconhecida';

        previewBox.classList.remove('hidden');
        previewBox.innerHTML = `
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p class="text-xs font-bold text-[var(--dourado)]">📦 Backup Pronto para Restauração</p>
              <p class="text-[11px] font-mono-code text-[var(--texto-mutado)]">Exportado em ${escapeHtml(dateLabel)} por ${escapeHtml(parsed.exportedBy || 'Mestre')}</p>
            </div>
            <button type="button" id="btn-cancel-restore" class="text-xs text-[var(--texto-mutado)] hover:text-white">✕ Cancelar</button>
          </div>

          <div class="flex flex-wrap gap-2 text-[11px] font-mono-code">
            <span class="px-2.5 py-1 rounded bg-black/40 border border-[var(--borda-fina)] text-[var(--dourado-claro)]">📚 ${stats.wikiCount} Wikis</span>
            <span class="px-2.5 py-1 rounded bg-black/40 border border-[var(--borda-fina)] text-[var(--dourado-claro)]">📌 ${stats.cardsCount} Pistas</span>
            <span class="px-2.5 py-1 rounded bg-black/40 border border-[var(--borda-fina)] text-[var(--dourado-claro)]">▢ ${stats.framesCount} Molduras</span>
            <span class="px-2.5 py-1 rounded bg-black/40 border border-[var(--borda-fina)] text-[var(--dourado-claro)]">🗂️ ${stats.boardsCount} Quadros</span>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[var(--borda-fina)]">
            <label class="inline-flex items-center gap-2 text-xs text-[var(--texto-principal)] cursor-pointer">
              <input type="checkbox" id="chk-keep-roles" checked class="accent-[var(--dourado)]">
              <span>Manter permissões de Mestre atuais (recomendado)</span>
            </label>

            <button type="button" id="btn-confirm-restore"
              class="px-4 py-2 rounded-lg bg-[var(--vinho-escuro)] hover:bg-[var(--vinho)] border border-[var(--dourado)] text-[var(--dourado-claro)] text-xs font-bold">
              ⚠️ Confirmar e Restaurar Dados
            </button>
          </div>
        `;

        document.getElementById('btn-cancel-restore').addEventListener('click', () => {
          pendingRestoreSnapshot = null;
          restoreInput.value = '';
          previewBox.classList.add('hidden');
        });

        document.getElementById('btn-confirm-restore').addEventListener('click', async () => {
          if (!pendingRestoreSnapshot) return;
          if (!confirm('Isso irá sobrescrever os registros correspondentes no banco com os dados do backup. Deseja continuar?')) {
            return;
          }

          const confirmBtn = document.getElementById('btn-confirm-restore');
          confirmBtn.disabled = true;
          confirmBtn.innerText = 'Restaurando...';

          try {
            const keepRoles = document.getElementById('chk-keep-roles').checked;
            const restoredCount = await restoreDatabaseBackup(pendingRestoreSnapshot, keepRoles);
            pendingRestoreSnapshot = null;
            restoreInput.value = '';
            previewBox.classList.add('hidden');
            alert(`Restauração concluída com sucesso! ${restoredCount} documentos sincronizados.`);
          } catch (err) {
            console.error('Erro ao restaurar backup:', err);
            alert('Erro ao restaurar backup: ' + (err.message || err));
            confirmBtn.disabled = false;
            confirmBtn.innerText = '⚠️ Confirmar e Restaurar Dados';
          }
        });
      } catch (err) {
        alert('Arquivo JSON inválido: ' + (err.message || err));
        restoreInput.value = '';
      }
    };
    reader.readAsText(file);
  });
}