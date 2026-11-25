// js/modules/transitions.js

const NYX_SETTLE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const NYX_SPRING_FALLBACK = 'cubic-bezier(0.34, 1.4, 0.64, 1)';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function getSpringEasing() {
  if (typeof CSS !== 'undefined' && CSS.supports?.('transition-timing-function', 'linear(0, 1)')) {
    return getComputedStyle(document.documentElement).getPropertyValue('--nyx-spring').trim() || NYX_SPRING_FALLBACK;
  }
  return NYX_SPRING_FALLBACK;
}

/* ==========================================================================
   1. TABS SLIDING
   ========================================================================== */
export function moveSlidingPill(tablistEl, targetTab, instant = false) {
  if (!tablistEl || !targetTab) return;
  const pill = tablistEl.querySelector('.nyx-tabs-pill');
  if (!pill) return;

  if (instant || prefersReducedMotion()) {
    pill.style.transition = 'none';
  }
  pill.style.width = `${targetTab.offsetWidth}px`;
  pill.style.height = `${targetTab.offsetHeight}px`;
  pill.style.transform = `translate(${targetTab.offsetLeft}px, ${targetTab.offsetTop}px)`;

  if (instant || prefersReducedMotion()) {
    void pill.offsetWidth;
    pill.style.transition = '';
  }
}

export function bindSlidingTabs(tablistEl, onSelect = null) {
  if (!tablistEl) return;
  const tabs = Array.from(tablistEl.querySelectorAll('.nyx-tab'));
  if (tabs.length === 0) return;

  const getActiveTab = () => tabs.find(t => t.getAttribute('aria-selected') === 'true') || tabs[0];

  if (!tablistEl.dataset.nyxTabsBound) {
    tablistEl.dataset.nyxTabsBound = 'true';

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.setAttribute('aria-selected', String(t === tab)));
        moveSlidingPill(tablistEl, tab, false);
        if (onSelect) onSelect(tab);
      });
    });

    const ro = new ResizeObserver(() => moveSlidingPill(tablistEl, getActiveTab(), true));
    ro.observe(tablistEl);
    document.fonts?.ready.then(() => moveSlidingPill(tablistEl, getActiveTab(), true));
  }

  moveSlidingPill(tablistEl, getActiveTab(), true);
}

/* ==========================================================================
   2. PLUS TO MENU MORPH
   ========================================================================== */
export function bindMorphMenu(morphEl) {
  if (!morphEl || morphEl.dataset.nyxMorphBound) return;
  morphEl.dataset.nyxMorphBound = 'true';

  const trigger = morphEl.querySelector('.nyx-morph-trigger');
  const menu = morphEl.querySelector('.nyx-morph-menu');
  if (!trigger || !menu) return;

  const setOpen = (open) => {
    morphEl.dataset.open = String(open);
    trigger.setAttribute('aria-expanded', String(open));
    if (open) {
      morphEl.style.width = `${menu.offsetWidth}px`;
      morphEl.style.height = `${menu.offsetHeight}px`;
    } else {
      morphEl.style.width = '';
      morphEl.style.height = '';
    }
  };

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(morphEl.dataset.open !== 'true');
  });

  menu.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => setOpen(false));
  });

  document.addEventListener('pointerdown', (e) => {
    if (morphEl.dataset.open === 'true' && !morphEl.contains(e.target)) {
      setOpen(false);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && morphEl.dataset.open === 'true') {
      setOpen(false);
    }
  });
}

/* ==========================================================================
   3. INPUT CLEAR WITH DISSOLVE
   ========================================================================== */
function easeOutExpoish(t) {
  return 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3.2);
}

function measureWordStreaks(mirrorEl) {
  const textNode = mirrorEl.firstChild;
  if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return [];
  const text = textNode.textContent || '';
  const boxRect = mirrorEl.getBoundingClientRect();
  const streaks = [];
  const wordRegex = /\S+/g;
  let match;

  while ((match = wordRegex.exec(text)) !== null) {
    const range = document.createRange();
    range.setStart(textNode, match.index);
    range.setEnd(textNode, match.index + match[0].length);
    const rect = range.getBoundingClientRect();
    if (rect.width > 0) {
      streaks.push({
        cx: rect.left - boxRect.left + rect.width / 2,
        cy: rect.top - boxRect.top + rect.height / 2,
        rx: Math.max(18, rect.width * 0.78),
        ry: Math.max(11, rect.height * 0.85)
      });
    }
  }
  return streaks;
}

export function bindDissolveClearInput(wrapperEl) {
  if (!wrapperEl || wrapperEl.dataset.nyxClearBound) return;
  wrapperEl.dataset.nyxClearBound = 'true';

  const input = wrapperEl.querySelector('input');
  const mirror = wrapperEl.querySelector('.nyx-clear-mirror');
  const placeholder = wrapperEl.querySelector('.nyx-clear-placeholder');
  const glow = wrapperEl.querySelector('.nyx-clear-glow');
  const clearBtn = wrapperEl.querySelector('.nyx-clear-btn');
  if (!input || !mirror || !placeholder || !glow || !clearBtn) return;

  let rafId = null;

  const syncMirror = () => {
    mirror.textContent = input.value;
    mirror.scrollLeft = input.scrollLeft;
    wrapperEl.classList.toggle('has-value', input.value.length > 0);
  };

  input.addEventListener('input', () => {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
      wrapperEl.classList.remove('is-clearing');
      mirror.style.transform = '';
      mirror.style.opacity = '';
      mirror.style.filter = '';
      placeholder.style.transform = '';
      placeholder.style.opacity = '';
      glow.style.opacity = '0';
    }
    syncMirror();
  });

  input.addEventListener('scroll', () => {
    mirror.scrollLeft = input.scrollLeft;
  });

  clearBtn.addEventListener('click', () => {
    if (!input.value || wrapperEl.classList.contains('is-clearing')) return;

    if (prefersReducedMotion()) {
      input.value = '';
      syncMirror();
      input.focus();
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    const styles = getComputedStyle(document.documentElement);
    const totalDur = parseFloat(styles.getPropertyValue('--nyx-clear-dur')) || 950;
    const outDur = parseFloat(styles.getPropertyValue('--nyx-clear-out-dur')) || 380;
    const inDur = parseFloat(styles.getPropertyValue('--nyx-clear-in-dur')) || 380;
    const outFly = parseFloat(styles.getPropertyValue('--nyx-clear-out-fly')) || 11;
    const inFly = parseFloat(styles.getPropertyValue('--nyx-clear-in-fly')) || 11;
    const maxBlur = parseFloat(styles.getPropertyValue('--nyx-clear-blur')) || 2;
    const glowDelay = parseFloat(styles.getPropertyValue('--nyx-glow-delay')) || 45;
    const glowPeakAt = parseFloat(styles.getPropertyValue('--nyx-glow-peak-at')) || 0.16;
    const glowMaxOp = parseFloat(styles.getPropertyValue('--nyx-glow-opacity')) || 0.88;

    const streaks = measureWordStreaks(mirror);
    glow.style.backgroundImage = streaks.length
      ? streaks
          .map(
            s =>
              `radial-gradient(${s.rx.toFixed(1)}px ${s.ry.toFixed(1)}px at ${s.cx.toFixed(1)}px ${s.cy.toFixed(1)}px, rgba(247, 231, 180, 0.95) 0%, rgba(212, 175, 55, 0.58) 45%, rgba(198, 40, 40, 0) 100%)`
          )
          .join(', ')
      : 'none';

    wrapperEl.classList.add('is-clearing');
    wrapperEl.classList.remove('has-value');
    input.value = '';
    input.focus();
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const start = performance.now();
    const tick = (now) => {
      const elapsed = now - start;
      const outP = easeOutExpoish(elapsed / outDur);
      mirror.style.transform = `translateY(${(-outFly * outP).toFixed(2)}px)`;
      mirror.style.opacity = String((1 - outP).toFixed(3));
      mirror.style.filter = `blur(${(maxBlur * outP).toFixed(2)}px)`;

      const inP = easeOutExpoish(elapsed / inDur);
      placeholder.style.transform = `translateY(${(inFly * (1 - inP)).toFixed(2)}px)`;
      placeholder.style.opacity = String(inP.toFixed(3));

      const glowElapsed = Math.max(0, elapsed - glowDelay);
      const glowDur = Math.max(1, totalDur - glowDelay);
      const gNorm = Math.min(1, glowElapsed / glowDur);

      let glowOp = 0;
      if (glowElapsed > 0 && gNorm < 1) {
        glowOp =
          gNorm <= glowPeakAt
            ? glowMaxOp * easeOutExpoish(gNorm / glowPeakAt)
            : glowMaxOp * Math.pow(1 - (gNorm - glowPeakAt) / (1 - glowPeakAt), 1.8);
      }
      glow.style.opacity = String(glowOp.toFixed(3));

      if (elapsed < totalDur) {
        rafId = requestAnimationFrame(tick);
      } else {
        rafId = null;
        wrapperEl.classList.remove('is-clearing');
        mirror.textContent = '';
        mirror.style.transform = '';
        mirror.style.opacity = '';
        mirror.style.filter = '';
        placeholder.style.transform = '';
        placeholder.style.opacity = '';
        glow.style.opacity = '0';
        glow.style.backgroundImage = 'none';
      }
    };
    rafId = requestAnimationFrame(tick);
  });

  syncMirror();
}

/* ==========================================================================
   4. GRADUAL BLUR (Com suporte a position: sticky para containers com scroll)
   ========================================================================== */
const BLUR_CURVES = {
  linear: t => t,
  bezier: t => t * t * (3 - 2 * t),
  'ease-in': t => t * t,
  'ease-out': t => 1 - (1 - t) * (1 - t),
  'ease-in-out': t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
};
const BLUR_DIRECTIONS = { top: 'to top', bottom: 'to bottom', left: 'to left', right: 'to right' };

export function attachGradualBlur(hostEl, options = {}) {
  if (!hostEl) return () => {};
  const {
    position = 'bottom',
    height = '3.25rem',
    strength = 1.4,
    layers = 6,
    curve = 'ease-out',
    exponential = true,
    tint = 'rgba(16, 4, 7, 0.92)',
    autoHide = true,
    sticky = true,
    zIndex = 12
  } = options;

  const existing = hostEl.querySelector(':scope > .nyx-gradual-blur');
  if (existing) existing.remove();

  const edge = BLUR_DIRECTIONS[position] ? position : 'bottom';
  const vertical = edge === 'top' || edge === 'bottom';
  const direction = BLUR_DIRECTIONS[edge];
  const shape = BLUR_CURVES[curve] || BLUR_CURVES.linear;
  const count = Math.min(Math.max(Math.round(layers), 1), 12);
  const maxBlur = Math.max(strength, 0) * 12;
  const sizeVal = typeof height === 'number' ? `${height}px` : height;

  const root = document.createElement('div');
  root.className = 'nyx-gradual-blur';
  root.setAttribute('aria-hidden', 'true');
  root.style.zIndex = String(zIndex);

  if (sticky && hostEl !== document.body) {
    root.style.position = 'sticky';
    root.style.left = '0';
    root.style.right = '0';
    root.style.width = '100%';
    root.style.height = sizeVal;
    if (edge === 'bottom') {
      root.style.bottom = '0';
      root.style.marginTop = `calc(-1 * ${sizeVal})`;
    } else {
      root.style.top = '0';
      root.style.marginBottom = `calc(-1 * ${sizeVal})`;
    }
  } else {
    root.style.position = hostEl === document.body ? 'fixed' : 'absolute';
    root.style.borderRadius = 'inherit';
    if (vertical) {
      root.style.left = '0';
      root.style.right = '0';
      root.style.height = sizeVal;
      root.style[edge === 'top' ? 'top' : 'bottom'] = '0';
    } else {
      root.style.top = '0';
      root.style.bottom = '0';
      root.style.width = sizeVal;
      root.style[edge === 'left' ? 'left' : 'right'] = '0';
    }
  }

  const level = (u) => {
    const t = shape(Math.min(Math.max(u, 0), 1));
    return maxBlur * (exponential ? (Math.pow(2, 4 * t) - 1) / 15 : t);
  };

  for (let i = 0; i < count; i++) {
    const from = level(i / count);
    const to = level((i + 1) / count);
    const radius = Math.sqrt(Math.max(to * to - from * from, 0));
    const filter = `blur(calc(${radius.toFixed(3)}px * var(--nyx-blur-reveal, 1)))`;
    const mask = `linear-gradient(${direction}, transparent ${((i / count) * 100).toFixed(2)}%, #000 ${(((i + 1) / count) * 100).toFixed(2)}%)`;

    const stepEl = document.createElement('div');
    stepEl.className = 'nyx-gradual-blur-layer';
    stepEl.style.backdropFilter = filter;
    stepEl.style.webkitBackdropFilter = filter;
    stepEl.style.maskImage = mask;
    stepEl.style.webkitMaskImage = mask;
    stepEl.style.transition = 'backdrop-filter 200ms ease-out, -webkit-backdrop-filter 200ms ease-out';
    root.appendChild(stepEl);
  }

  if (tint && tint !== 'transparent') {
    const stops = Array.from({ length: 9 }, (_, k) => {
      const u = k / 8;
      const t = shape(u);
      const alpha = t * t * t * (t * (t * 6 - 15) + 10);
      return `rgba(0, 0, 0, ${alpha.toFixed(3)}) ${(u * 100).toFixed(1)}%`;
    }).join(', ');

    const wash = document.createElement('div');
    wash.className = 'nyx-gradual-blur-wash';
    wash.style.background = tint;
    wash.style.maskImage = `linear-gradient(${direction}, ${stops})`;
    wash.style.webkitMaskImage = `linear-gradient(${direction}, ${stops})`;
    wash.style.opacity = 'var(--nyx-blur-reveal, 1)';
    wash.style.transition = 'opacity 200ms ease-out';
    root.appendChild(wash);
  }

  hostEl.appendChild(root);
  if (!autoHide) return () => root.remove();

  const scrollTarget = hostEl === document.body ? window : hostEl;
  const isStart = edge === 'top' || edge === 'left';

  const updateReveal = () => {
    const isWin = scrollTarget === window;
    const offset = isWin
      ? vertical ? window.scrollY : window.scrollX
      : vertical ? scrollTarget.scrollTop : scrollTarget.scrollLeft;
    const limit = isWin
      ? vertical
        ? document.documentElement.scrollHeight - window.innerHeight
        : document.documentElement.scrollWidth - window.innerWidth
      : vertical
        ? scrollTarget.scrollHeight - scrollTarget.clientHeight
        : scrollTarget.scrollWidth - scrollTarget.clientWidth;

    if (limit <= 4) {
      root.style.setProperty('--nyx-blur-reveal', '0');
      return;
    }
    const box = root.getBoundingClientRect();
    const reach = Math.max(vertical ? box.height : box.width, 1);
    const room = isStart ? offset : limit - offset;
    root.style.setProperty('--nyx-blur-reveal', Math.min(Math.max(room / reach, 0), 1).toFixed(3));
  };

  requestAnimationFrame(updateReveal);
  scrollTarget.addEventListener('scroll', updateReveal, { passive: true });
  window.addEventListener('resize', updateReveal);
  const ro = scrollTarget instanceof Element ? new ResizeObserver(updateReveal) : null;
  if (ro && scrollTarget instanceof Element) ro.observe(scrollTarget);

  return () => {
    scrollTarget.removeEventListener('scroll', updateReveal);
    window.removeEventListener('resize', updateReveal);
    ro?.disconnect();
    root.remove();
  };
}

/* ==========================================================================
   5. SPRING STEPPER
   ========================================================================== */
export function createNyxStepper(rootEl, options = {}) {
  const { steps = [], initialStep = 0, onStepChange = null } = options;
  if (!rootEl || steps.length === 0) return null;

  let current = Math.min(Math.max(initialStep, 0), steps.length - 1);
  let placed = false;

  const track = rootEl.querySelector('.nyx-stepper-track');
  const glider = rootEl.querySelector('.nyx-stepper-glider');
  const viewport = rootEl.querySelector('.nyx-stepper-viewport');
  const backBtn = rootEl.querySelector('[data-stepper-back]');
  const nextBtn = rootEl.querySelector('[data-stepper-next]');
  const submitBtn = rootEl.querySelector('[data-stepper-submit]');

  const checkSvg = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M5 13l4 4L19 7" style="stroke-dasharray: 24; stroke-dashoffset: 0;"></path>
    </svg>
  `;

  const segments = steps.map((step, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nyx-stepper-segment';
    btn.innerHTML = `<span class="nyx-stepper-badge">${idx + 1}</span><span class="nyx-stepper-title">${step.title}</span>`;
    btn.addEventListener('click', () => goTo(idx));
    track.appendChild(btn);
    return btn;
  });

  const placeGlider = (animate = true) => {
    const activeSeg = segments[current];
    if (!activeSeg || !glider) return;
    const spring = getSpringEasing();
    glider.style.transition = animate && !prefersReducedMotion()
      ? `transform 520ms ${spring}, width 520ms ${spring}, height 520ms ${spring}`
      : 'none';
    glider.style.width = `${activeSeg.offsetWidth}px`;
    glider.style.height = `${activeSeg.offsetHeight}px`;
    glider.style.transform = `translate3d(${activeSeg.offsetLeft}px, ${activeSeg.offsetTop}px, 0)`;
    if (!animate || prefersReducedMotion()) void glider.offsetWidth;
  };

  const syncHeaderStates = (prevIdx = -1) => {
    segments.forEach((seg, idx) => {
      const status = idx < current ? 'complete' : idx === current ? 'active' : 'upcoming';
      seg.dataset.status = status;
      const badge = seg.querySelector('.nyx-stepper-badge');
      if (!badge) return;
      if (status === 'complete') {
        badge.innerHTML = checkSvg;
        if (idx === prevIdx && !prefersReducedMotion()) {
          badge.querySelector('path')?.animate([{ strokeDashoffset: 24 }, { strokeDashoffset: 0 }], {
            duration: 360,
            easing: NYX_SETTLE
          });
        }
      } else {
        badge.textContent = String(idx + 1);
      }
    });

    const isLast = current === steps.length - 1;
    if (backBtn) backBtn.classList.toggle('hidden', current === 0);
    if (nextBtn) nextBtn.classList.toggle('hidden', isLast);
    if (submitBtn) submitBtn.classList.toggle('hidden', !isLast);
  };

  const goTo = (nextIdx) => {
    const target = Math.min(Math.max(nextIdx, 0), steps.length - 1);
    if (target === current && placed) return;

    const prevIdx = current;
    const direction = target > prevIdx ? 1 : -1;
    const fromHeight = viewport.offsetHeight;
    const oldPane = steps[prevIdx]?.el;
    const newPane = steps[target]?.el;
    if (!newPane) return;

    current = target;
    syncHeaderStates(prevIdx);
    placeGlider(placed);

    const reduced = prefersReducedMotion();
    const spring = getSpringEasing();

    if (placed && oldPane && oldPane !== newPane && typeof viewport.animate === 'function') {
      const clone = oldPane.cloneNode(true);
      clone.classList.add('nyx-stepper-pane--leaving');
      viewport.appendChild(clone);

      oldPane.classList.add('hidden');
      newPane.classList.remove('hidden');

      const toHeight = viewport.offsetHeight;
      if (Math.abs(fromHeight - toHeight) > 0.5) {
        viewport.animate([{ height: `${fromHeight}px` }, { height: `${toHeight}px` }], {
          duration: reduced ? 200 : 520,
          easing: reduced ? NYX_SETTLE : spring
        });
      }

      const shift = reduced ? 0 : 34;
      if (shift) {
        newPane.animate([{ transform: `translateX(${direction * shift}px)` }, { transform: 'none' }], {
          duration: 520,
          easing: spring
        });
      }
      newPane.animate([{ opacity: 0 }, { opacity: 0, offset: 0.22 }, { opacity: 1 }], {
        duration: 400,
        easing: 'ease-out'
      });

      clone.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: 'ease-out', fill: 'forwards' });
      const exitAnim = clone.animate(
        [{ transform: 'none' }, { transform: `translateX(${-direction * shift}px)` }],
        { duration: 200, easing: 'ease-in', fill: 'forwards' }
      );
      exitAnim.onfinish = () => clone.remove();
    } else {
      steps.forEach((s, idx) => s.el.classList.toggle('hidden', idx !== current));
    }

    placed = true;
    if (onStepChange) onStepChange(current);
  };

  backBtn?.addEventListener('click', () => goTo(current - 1));
  nextBtn?.addEventListener('click', () => goTo(current + 1));

  const ro = new ResizeObserver(() => {
    track.classList.remove('is-tight');
    track.classList.toggle('is-tight', track.scrollWidth > track.clientWidth + 2);
    placeGlider(false);
  });
  ro.observe(track);

  goTo(current);
  return { goTo, getCurrentStep: () => current, destroy: () => ro.disconnect() };
}

/* ==========================================================================
   6. WARM TOOLTIP (Delegação Global)
   ========================================================================== */
export function initNyxWarmTooltips(options = {}) {
  if (typeof document === 'undefined' || document.getElementById('nyx-warm-tooltip')) return;
  const { delay = 360, warmWindow = 320, grace = 80, gap = 8, margin = 8, maxLeanDeg = 4.5 } = options;

  const root = document.createElement('div');
  root.id = 'nyx-warm-tooltip';
  root.className = 'nyx-tooltip hidden';
  root.setAttribute('role', 'tooltip');
  root.innerHTML = `
    <div class="nyx-tooltip-box">
      <div class="nyx-tooltip-clip"></div>
      <span class="nyx-tooltip-arrow" aria-hidden="true"></span>
    </div>
  `;
  document.body.appendChild(root);

  const box = root.querySelector('.nyx-tooltip-box');
  const clip = root.querySelector('.nyx-tooltip-clip');
  const arrow = root.querySelector('.nyx-tooltip-arrow');

  let activeTrigger = null;
  let state = 'closed';
  let warmUntil = -Infinity;
  let lastAnchor = null;
  let openTimer = null;
  let leaveTimer = null;
  let closeTimer = null;

  const isWarm = () => state !== 'closed' || performance.now() < warmUntil;
  const getAnchor = (trigger, side) => {
    const r = trigger.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: side === 'bottom' ? r.bottom + gap : r.top - gap };
  };

  const measureContent = (text, kbd) => {
    const probe = document.createElement('div');
    probe.className = 'nyx-tooltip-layer';
    probe.style.position = 'fixed';
    probe.style.visibility = 'hidden';
    probe.innerHTML = `<span class="nyx-tooltip-text"><span>${text}</span>${kbd ? `<kbd class="nyx-tooltip-kbd">${kbd}</kbd>` : ''}</span>`;
    document.body.appendChild(probe);
    const inner = probe.firstElementChild;
    const dims = { width: Math.ceil(inner.offsetWidth), height: Math.ceil(inner.offsetHeight) };
    probe.remove();
    return dims;
  };

  const show = (trigger, mode) => {
    clearTimeout(closeTimer);
    clearTimeout(leaveTimer);
    const text = trigger.dataset.nyxTip;
    if (!text) return;

    const kbd = trigger.dataset.nyxKbd || '';
    const side = trigger.dataset.nyxTipSide === 'bottom' ? 'bottom' : 'top';
    const reduced = prefersReducedMotion();

    const { width, height } = measureContent(text, kbd);
    const anchor = getAnchor(trigger, side);
    const X = Math.min(Math.max(anchor.x - width / 2, margin), Math.max(margin, window.innerWidth - margin - width));
    const Y = side === 'top' ? anchor.y - height : anchor.y;
    const arrowX = Math.min(Math.max(anchor.x - X, 10), width - 10);

    const prevTrigger = activeTrigger;
    const prevAnchor = lastAnchor;
    activeTrigger = trigger;
    lastAnchor = anchor;
    trigger.setAttribute('aria-describedby', root.id);

    root.dataset.side = side;
    root.classList.remove('hidden');

    const isGliding = mode === 'move' && !reduced && prevAnchor && prevTrigger !== trigger;
    const dir = prevAnchor ? Math.sign(anchor.x - prevAnchor.x) || 1 : 0;

    root.style.transition = isGliding
      ? `transform 260ms ${NYX_SETTLE}, width 260ms ${NYX_SETTLE}, height 260ms ${NYX_SETTLE}`
      : 'none';
    root.style.width = `${width}px`;
    root.style.height = `${height}px`;
    root.style.transform = `translate3d(${X}px, ${Y}px, 0)`;

    arrow.style.transition = isGliding ? `left 260ms ${NYX_SETTLE}` : 'none';
    arrow.style.left = `${arrowX}px`;
    if (!isGliding) void root.offsetWidth;

    if (isGliding && typeof box.animate === 'function') {
      const dist = anchor.x - prevAnchor.x;
      const lean = Math.max(-maxLeanDeg, Math.min(maxLeanDeg, (-dist / 220) * maxLeanDeg));
      if (Math.abs(lean) > 0.3) {
        box.animate(
          [{ transform: 'rotate(0deg)' }, { transform: `rotate(${lean.toFixed(2)}deg)`, offset: 0.35 }, { transform: 'rotate(0deg)' }],
          { duration: 340, easing: NYX_SETTLE }
        );
      }
    } else if (mode === 'cold' && !reduced && typeof box.animate === 'function') {
      const rise = side === 'top' ? 4 : -4;
      box.animate(
        [
          { opacity: 0, transform: `translateY(${rise}px) scale(0.94)`, filter: 'blur(3px)' },
          { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0px)' }
        ],
        { duration: 170, easing: NYX_SETTLE, fill: 'forwards' }
      );
    }

    const oldLayers = Array.from(clip.children);
    const newLayer = document.createElement('div');
    newLayer.className = 'nyx-tooltip-layer';
    newLayer.innerHTML = `<span class="nyx-tooltip-text"><span>${text}</span>${kbd ? `<kbd class="nyx-tooltip-kbd">${kbd}</kbd>` : ''}</span>`;
    clip.appendChild(newLayer);

    if (isGliding && typeof newLayer.animate === 'function') {
      newLayer.animate(
        [
          { opacity: 0, transform: `translateX(${10 * dir}px)`, filter: 'blur(3px)' },
          { opacity: 1, transform: 'translateX(0)', filter: 'blur(0px)' }
        ],
        { duration: 150, easing: NYX_SETTLE, fill: 'forwards' }
      );
      oldLayers.forEach(old => {
        const out = old.animate(
          [
            { opacity: 1, transform: 'translateX(0)', filter: 'blur(0px)' },
            { opacity: 0, transform: `translateX(${-10 * dir}px)`, filter: 'blur(3px)' }
          ],
          { duration: 130, easing: NYX_SETTLE, fill: 'forwards' }
        );
        out.onfinish = () => old.remove();
      });
    } else {
      oldLayers.forEach(old => old.remove());
    }
    state = 'open';
  };

  const beginClose = (instant = false) => {
    if (state === 'closed') return;
    state = 'closing';
    warmUntil = performance.now() + warmWindow;
    if (activeTrigger) {
      activeTrigger.removeAttribute('aria-describedby');
      activeTrigger = null;
    }
    const finish = () => {
      state = 'closed';
      lastAnchor = null;
      root.classList.add('hidden');
      clip.innerHTML = '';
    };
    if (instant || prefersReducedMotion() || typeof box.animate !== 'function') {
      finish();
      return;
    }
    box.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.95)' }], {
      duration: 130,
      easing: NYX_SETTLE,
      fill: 'forwards'
    });
    closeTimer = setTimeout(finish, 130);
  };

  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const trigger = e.target.closest?.('[data-nyx-tip]');
    if (!trigger || trigger === activeTrigger) return;
    clearTimeout(openTimer);
    clearTimeout(leaveTimer);
    if (state === 'open') show(trigger, 'move');
    else if (isWarm()) show(trigger, 'warm');
    else openTimer = setTimeout(() => show(trigger, 'cold'), delay);
  });

  document.addEventListener('pointerout', (e) => {
    const trigger = e.target.closest?.('[data-nyx-tip]');
    if (!trigger || (e.relatedTarget && trigger.contains(e.relatedTarget))) return;
    clearTimeout(openTimer);
    if (trigger === activeTrigger && state === 'open') {
      leaveTimer = setTimeout(() => beginClose(false), grace);
    }
  });

  document.addEventListener('pointerdown', () => {
    clearTimeout(openTimer);
    beginClose(true);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      clearTimeout(openTimer);
      beginClose(true);
    }
  });
}