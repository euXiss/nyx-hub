// js/modules/auth.js
import { auth } from '../config/firebase.js';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signOut
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

export function initAuth(onUserAuthenticated, onUserLoggedOut) {
  const statusEl = document.getElementById('auth-status');

  onAuthStateChanged(auth, (user) => {
    if (user) {
      const nome = user.displayName || user.email.split('@')[0];
      statusEl.innerHTML = `
        <div class="flex items-center space-x-3">
          <span class="text-[var(--dourado-claro)]">● ${nome}</span>
          <button id="btn-logout" class="text-xs border border-[var(--vinho)] text-red-400 hover:bg-[var(--vinho-escuro)] px-2.5 py-1 rounded transition">
            Sair
          </button>
        </div>
      `;
      document.getElementById('btn-logout').addEventListener('click', () => signOut(auth));
      onUserAuthenticated(user);
    } else {
      statusEl.innerHTML = `<span class="text-[var(--texto-mutado)]">Desconectado</span>`;
      onUserLoggedOut();
    }
  });
}

export function renderLoginScreen(container) {
  let isRegisterMode = false;

  const draw = () => {
    container.innerHTML = `
      <div class="max-w-md mx-auto mt-12 bg-[var(--bg-card)] border border-[var(--borda-fina)] rounded-xl p-8 shadow-2xl">
        <div class="text-center mb-6">
          <div class="w-12 h-12 mx-auto mb-3 rounded bg-[var(--vinho-escuro)] border border-[var(--dourado)] flex items-center justify-center font-bold text-2xl text-[var(--dourado)]">
            N
          </div>
          <h2 class="text-2xl font-bold text-[var(--dourado)]">${isRegisterMode ? 'Criar Credencial no NyX' : 'Acesso ao Arquivo NyX'}</h2>
          <p class="text-xs text-[var(--texto-mutado)] mt-1">Entre com sua conta da mesa para sincronizar wikis e fichas.</p>
        </div>

        <form id="auth-form" class="space-y-4">
          ${isRegisterMode ? `
            <div>
              <label class="block text-xs text-[var(--dourado-claro)] mb-1">Nome (Jogador ou Mestre)</label>
              <input type="text" id="auth-name" required placeholder="Ex: Jefferson (Mestre)"
                class="w-full bg-[var(--bg-surface)] border border-[var(--borda-fina)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--dourado)]">
            </div>
          ` : ''}
          <div>
            <label class="block text-xs text-[var(--dourado-claro)] mb-1">E-mail</label>
            <input type="email" id="auth-email" required placeholder="seu@email.com"
              class="w-full bg-[var(--bg-surface)] border border-[var(--borda-fina)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--dourado)]">
          </div>
          <div>
            <label class="block text-xs text-[var(--dourado-claro)] mb-1">Senha (mín. 6 caracteres)</label>
            <input type="password" id="auth-pass" required minlength="6" placeholder="••••••"
              class="w-full bg-[var(--bg-surface)] border border-[var(--borda-fina)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--dourado)]">
          </div>

          <p id="auth-error" class="text-xs text-red-400 hidden"></p>

          <button type="submit" class="w-full py-2.5 rounded-lg bg-[var(--vinho-escuro)] hover:bg-[var(--vinho)] border border-[var(--dourado)] text-[var(--dourado-claro)] font-bold text-sm transition">
            ${isRegisterMode ? 'Registrar e Entrar' : 'Entrar no NyX'}
          </button>
        </form>

        <div class="mt-5 text-center border-t border-[var(--borda-fina)] pt-4">
          <button id="toggle-auth-mode" class="text-xs text-[var(--dourado)] hover:underline">
            ${isRegisterMode ? 'Já possui conta? Faça login' : 'Primeiro acesso? Criar conta da mesa'}
          </button>
        </div>
      </div>
    `;

    document.getElementById('toggle-auth-mode').addEventListener('click', () => {
      isRegisterMode = !isRegisterMode;
      draw();
    });

    document.getElementById('auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('auth-email').value.trim();
      const pass = document.getElementById('auth-pass').value;
      const errorEl = document.getElementById('auth-error');
      errorEl.classList.add('hidden');

      try {
        if (isRegisterMode) {
          const name = document.getElementById('auth-name').value.trim();
          const cred = await createUserWithEmailAndPassword(auth, email, pass);
          await updateProfile(cred.user, { displayName: name });
        } else {
          await signInWithEmailAndPassword(auth, email, pass);
        }
      } catch (err) {
        errorEl.innerText = 'Erro ao autenticar: verifique e-mail, senha ou se o login por E-mail/Senha está ativo no Firebase.';
        errorEl.classList.remove('hidden');
      }
    });
  };

  draw();
}