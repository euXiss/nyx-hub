// js/modules/auth.js
import { auth } from '../config/firebase.js';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

function escapeHtml(str = '') {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getUserDisplayName(user) {
  if (user.displayName && user.displayName.trim()) {
    return user.displayName.trim();
  }
  if (user.email) {
    return user.email.split('@')[0];
  }
  return 'Aventureiro';
}

function renderUserMenu(user) {
  const statusEl = document.getElementById('auth-status');
  if (!statusEl) return;

  if (!user) {
    statusEl.innerHTML = `
      <span class="inline-block text-xs font-mono-code text-[var(--texto-mutado)] bg-[#120507] border border-[var(--borda-fina)] px-4 py-2 rounded-full">
        Não conectado
      </span>
    `;
    return;
  }

  const username = getUserDisplayName(user);

  statusEl.innerHTML = `
    <div class="relative inline-block text-left" id="user-menu-wrapper">
      <button type="button" id="user-menu-trigger"
        class="flex items-center gap-2 bg-[#160609] hover:bg-[var(--vinho-escuro)] border border-[var(--borda-fina)] hover:border-[var(--dourado)] text-[var(--dourado-claro)] text-xs font-mono-code px-4 py-2.5 rounded-full shadow">
        <span class="w-2 h-2 rounded-full bg-[var(--dourado)]"></span>
        <span class="max-w-[140px] truncate font-bold">${escapeHtml(username)}</span>
        <span class="text-[10px] opacity-80">▾</span>
      </button>

      <div id="user-menu-dropdown"
        class="hidden absolute right-0 mt-2 w-48 rounded-xl bg-[#160609] border border-[var(--dourado)] shadow-2xl py-1.5 z-50 overflow-hidden">
        <div class="px-3.5 py-2 border-b border-[var(--borda-fina)]">
          <p class="text-[10px] font-mono-code uppercase tracking-wider text-[var(--texto-mutado)]">Conectado como</p>
          <p class="text-xs text-[var(--texto-principal)] truncate mt-0.5">${escapeHtml(user.email || username)}</p>
        </div>
        <button type="button" id="btn-switch-account"
          class="w-full text-left px-3.5 py-2.5 text-xs text-[var(--dourado-claro)] hover:bg-[var(--vinho-escuro)] flex items-center gap-2 rounded-none">
          <span>⇄</span> Trocar de conta
        </button>
        <button type="button" id="btn-logout-account"
          class="w-full text-left px-3.5 py-2.5 text-xs text-red-400 hover:bg-[var(--vinho-escuro)] flex items-center gap-2 rounded-none">
          <span>✕</span> Sair
        </button>
      </div>
    </div>
  `;

  const trigger = document.getElementById('user-menu-trigger');
  const dropdown = document.getElementById('user-menu-dropdown');

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('hidden');
  });

  document.getElementById('btn-switch-account').addEventListener('click', async () => {
    dropdown.classList.add('hidden');
    await signOut(auth);
  });

  document.getElementById('btn-logout-account').addEventListener('click', async () => {
    dropdown.classList.add('hidden');
    await signOut(auth);
  });
}

document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('user-menu-dropdown');
  const wrapper = document.getElementById('user-menu-wrapper');
  if (dropdown && wrapper && !wrapper.contains(e.target)) {
    dropdown.classList.add('hidden');
  }
});

export function initAuth(onLogin, onLogout) {
  onAuthStateChanged(auth, (user) => {
    renderUserMenu(user);
    if (user) {
      if (onLogin) onLogin(user);
    } else {
      if (onLogout) onLogout();
    }
  });
}

export function renderLoginScreen(container) {
  let isRegisterMode = false;

  const render = () => {
    container.innerHTML = `
      <div class="max-w-md mx-auto mt-6 bg-[var(--bg-card)] border border-[var(--dourado)] rounded-xl p-7 shadow-2xl">
        <div class="text-center mb-6">
          <h2 class="text-2xl font-bold text-[var(--dourado)] mb-1">
            ${isRegisterMode ? 'Criar Conta no NyX' : 'Acesso ao NyX'}
          </h2>
          <p class="text-xs text-[var(--texto-mutado)]">
            ${isRegisterMode ? 'Cadastre-se para acessar a Wiki e suas fichas.' : 'Entre com suas credenciais da mesa.'}
          </p>
        </div>

        <form id="auth-form" class="space-y-4">
          ${isRegisterMode ? `
            <div>
              <label class="block text-xs text-[var(--dourado-claro)] mb-1">Nome de Exibição (Apelido)</label>
              <input type="text" id="auth-name" required placeholder="Ex: Xiss"
                class="w-full bg-[#100406] border border-[var(--borda-fina)] rounded-lg px-3.5 py-2.5 text-sm text-[var(--texto-principal)] focus:border-[var(--dourado)] focus:outline-none">
            </div>
          ` : ''}

          <div>
            <label class="block text-xs text-[var(--dourado-claro)] mb-1">E-mail</label>
            <input type="email" id="auth-email" required placeholder="seu@email.com"
              class="w-full bg-[#100406] border border-[var(--borda-fina)] rounded-lg px-3.5 py-2.5 text-sm text-[var(--texto-principal)] focus:border-[var(--dourado)] focus:outline-none">
          </div>

          <div>
            <label class="block text-xs text-[var(--dourado-claro)] mb-1">Senha</label>
            <input type="password" id="auth-password" required minlength="6" placeholder="••••••••"
              class="w-full bg-[#100406] border border-[var(--borda-fina)] rounded-lg px-3.5 py-2.5 text-sm text-[var(--texto-principal)] focus:border-[var(--dourado)] focus:outline-none">
          </div>

          <p id="auth-error" class="hidden text-xs text-red-400 bg-red-950/40 border border-red-500/40 rounded-lg px-3 py-2"></p>

          <button type="submit" id="auth-submit-btn"
            class="w-full py-2.5 rounded-lg bg-[var(--vinho-escuro)] hover:bg-[var(--vinho)] border border-[var(--dourado)] text-[var(--dourado-claro)] font-bold text-sm shadow">
            ${isRegisterMode ? 'Cadastrar e Entrar' : 'Entrar no NyX'}
          </button>
        </form>

        <div class="mt-5 pt-4 border-t border-[var(--borda-fina)] text-center">
          <button type="button" id="toggle-auth-mode" class="text-xs text-[var(--dourado)] hover:underline">
            ${isRegisterMode ? 'Já tem uma conta? Fazer login' : 'Não tem conta? Criar acesso agora'}
          </button>
        </div>
      </div>
    `;

    document.getElementById('toggle-auth-mode').addEventListener('click', () => {
      isRegisterMode = !isRegisterMode;
      render();
    });

    document.getElementById('auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('auth-email').value.trim();
      const password = document.getElementById('auth-password').value;
      const errorEl = document.getElementById('auth-error');
      const submitBtn = document.getElementById('auth-submit-btn');

      errorEl.classList.add('hidden');
      submitBtn.disabled = true;
      submitBtn.innerText = 'Aguarde...';

      try {
        if (isRegisterMode) {
          const displayName = document.getElementById('auth-name').value.trim();
          const cred = await createUserWithEmailAndPassword(auth, email, password);
          if (displayName) {
            await updateProfile(cred.user, { displayName });
            renderUserMenu(cred.user);
          }
        } else {
          await signInWithEmailAndPassword(auth, email, password);
        }
      } catch (err) {
        errorEl.innerText = 'Erro de acesso: verifique o e-mail e a senha (mínimo 6 caracteres).';
        errorEl.classList.remove('hidden');
        submitBtn.disabled = false;
        submitBtn.innerText = isRegisterMode ? 'Cadastrar e Entrar' : 'Entrar no NyX';
      }
    });
  };

  render();
}