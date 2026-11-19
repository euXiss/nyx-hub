// js/modules/roles-manager.js
import { db } from '../config/firebase.js';
import {
  doc,
  setDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const ROLES_DOC_REF = doc(db, 'wikis', 'nyx_config_roles');

let membersMap = {};
let currentUid = null;
let unsubscribeRoles = null;
let roleListeners = [];

function escapeHtml(str = '') {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

  container.innerHTML = `
    <div class="space-y-6">
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
}