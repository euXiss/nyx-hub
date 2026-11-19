// js/modules/graph-view.js
import { getWikiEntries, openReaderModal } from './wiki-cms.js';

let animationFrameId = null;
let resizeObserver = null;
let keydownHandler = null;
let lastContainer = null;
let isExpanded = false;

let savedState = {
  activeCategory: 'ALL',
  searchTerm: '',
  showOrphans: true,
  camera: { x: 0, y: 0, zoom: 1 }
};

const STORAGE_WIDTH_KEY = 'nyx_graph_link_width';

const CATEGORY_COLORS = {
  Locais: '#D4AF37',
  NPCs: '#C62828',
  Facções: '#e5e0dc',
  Regras: '#c8a97e',
  Itens: '#3b82f6',
  Eventos: '#8b5cf6'
};

function getCategoryColor(category = '') {
  if (CATEGORY_COLORS[category]) return CATEGORY_COLORS[category];
  let hash = 0;
  for (let i = 0; i < category.length; i++) {
    hash = category.charCodeAt(i) + ((hash << 5) - hash);
  }
  const palette = ['#D4AF37', '#C62828', '#e5e0dc', '#c8a97e', '#10b981', '#8b5cf6', '#f97316'];
  return palette[Math.abs(hash) % palette.length];
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setExpandedMode(active) {
  isExpanded = active;
  document.body.classList.toggle('nyx-canvas-fullscreen', isExpanded);

  const wrapper = document.getElementById('nyx-graph-wrapper');
  const stage = document.getElementById('nyx-graph-stage');
  const expandBtn = document.getElementById('btn-graph-expand');

  if (wrapper) {
    wrapper.classList.toggle('expanded', isExpanded);
  }
  if (stage) {
    stage.classList.toggle('h-[68vh]', !isExpanded);
    stage.classList.toggle('min-h-[460px]', !isExpanded);
    stage.classList.toggle('flex-1', isExpanded);
  }
  if (expandBtn) {
    expandBtn.textContent = isExpanded ? '✕ Voltar ao Normal' : '⛶ Expandir Visão';
  }
}

export function unmountGraphView() {
  setExpandedMode(false);
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (keydownHandler) {
    document.removeEventListener('keydown', keydownHandler);
    keydownHandler = null;
  }
  lastContainer = null;
}

export function refreshGraphView(container = null) {
  const target = container || lastContainer;
  if (!target || !document.body.contains(target)) return;
  if (!container && !target.querySelector('#nyx-graph-canvas')) return;
  mountGraphView(target, true);
}

export function mountGraphView(container, preserveState = false) {
  const keepExpanded = preserveState && isExpanded;

  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (keydownHandler) {
    document.removeEventListener('keydown', keydownHandler);
    keydownHandler = null;
  }

  lastContainer = container;

  if (!preserveState) {
    isExpanded = false;
    document.body.classList.remove('nyx-canvas-fullscreen');
    savedState = {
      activeCategory: 'ALL',
      searchTerm: '',
      showOrphans: true,
      camera: { x: 0, y: 0, zoom: 1 }
    };
  }

  let linkWidth = Math.min(8, Math.max(1, parseFloat(localStorage.getItem(STORAGE_WIDTH_KEY)) || 2));

  const rawEntries = (getWikiEntries() || []).filter(e => e.nyxType !== 'canvas_card');

  const categories = Array.from(
    new Set(rawEntries.map(e => (e.category || 'Geral').trim()).filter(Boolean))
  );

  container.innerHTML = `
    <div id="nyx-graph-wrapper" class="nyx-canvas-wrapper">
      <!-- Barra Superior de Controles -->
      <div class="px-4 py-3 border-b border-[var(--borda-fina)] bg-[#120407] flex flex-wrap items-center justify-between gap-3">
        <!-- Filtros e Busca -->
        <div class="flex flex-wrap items-center gap-2.5">
          <select id="graph-category-filter"
            class="bg-[var(--bg-card)] text-[var(--texto-principal)] border border-[var(--borda-fina)] rounded-lg px-3 py-1.5 text-xs focus:border-[var(--dourado)] focus:outline-none">
            <option value="ALL">Todas as Categorias</option>
            ${categories.map(cat => `<option value="${escapeHtml(cat)}" ${savedState.activeCategory === cat ? 'selected' : ''}>${escapeHtml(cat)}</option>`).join('')}
          </select>

          <input type="text" id="graph-search-input" value="${escapeHtml(savedState.searchTerm)}" placeholder="Localizar nó..."
            class="bg-[var(--bg-card)] text-[var(--texto-principal)] border border-[var(--borda-fina)] rounded-lg px-3 py-1.5 text-xs w-44 focus:border-[var(--dourado)] focus:outline-none">

          <label class="inline-flex items-center gap-1.5 text-xs text-[var(--texto-principal)] cursor-pointer select-none">
            <input type="checkbox" id="graph-show-orphans" ${savedState.showOrphans ? 'checked' : ''} class="accent-[var(--dourado)] rounded cursor-pointer">
            <span>Mostrar sem links</span>
          </label>
        </div>

        <!-- Espessura dos Fios + Zoom + Expandir -->
        <div class="flex flex-wrap items-center gap-2.5">
          <div class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#090204] border border-[var(--borda-fina)]">
            <span class="text-[11px] font-mono-code text-[var(--dourado-claro)]">Fios:</span>
            <button type="button" id="graph-link-thin" title="Diminuir espessura do fio"
              class="w-5 h-5 rounded bg-[var(--bg-card)] border border-[var(--borda-fina)] text-[11px] text-[var(--dourado-claro)] leading-none">−</button>
            <input type="range" id="graph-link-width" min="1" max="8" step="0.5" value="${linkWidth}"
              title="Espessura dos fios de ligação"
              class="w-16 accent-[var(--dourado)] cursor-pointer">
            <button type="button" id="graph-link-thick" title="Aumentar espessura do fio"
              class="w-5 h-5 rounded bg-[var(--bg-card)] border border-[var(--borda-fina)] text-[11px] text-[var(--dourado-claro)] leading-none">+</button>
            <span id="graph-link-width-label" class="text-[10px] font-mono-code text-[var(--texto-mutado)] w-7 text-right">${linkWidth}px</span>
          </div>

          <span id="graph-stats-label" class="text-[11px] font-mono-code text-[var(--texto-mutado)]">0 nós • 0 conexões</span>

          <div class="flex items-center gap-1.5">
            <button type="button" id="graph-zoom-in" title="Aproximar"
              class="px-2.5 py-1 rounded bg-[var(--bg-card)] border border-[var(--borda-fina)] text-xs text-[var(--dourado-claro)]">+</button>
            <button type="button" id="graph-zoom-out" title="Afastar"
              class="px-2.5 py-1 rounded bg-[var(--bg-card)] border border-[var(--borda-fina)] text-xs text-[var(--dourado-claro)]">−</button>
            <button type="button" id="graph-center-btn"
              class="px-2.5 py-1 rounded bg-[var(--bg-card)] border border-[var(--borda-fina)] text-xs text-[var(--texto-mutado)] hover:text-white">
              Centralizar
            </button>
            <button type="button" id="btn-graph-expand"
              class="px-3 py-1 rounded bg-[#1d070c] border border-[var(--dourado)] text-xs text-[var(--dourado)] font-semibold">
              ⛶ Expandir Visão
            </button>
          </div>
        </div>
      </div>

      <!-- Palco do Gráfico -->
      <div id="nyx-graph-stage" class="relative w-full h-[68vh] min-h-[460px] overflow-hidden select-none"
        style="background: radial-gradient(circle at 50% 50%, rgba(105, 14, 22, 0.24) 0%, #090204 78%);">
        <canvas id="nyx-graph-canvas" class="block w-full h-full cursor-grab"></canvas>

        <!-- Legenda Inferior Esquerda -->
        <div id="nyx-graph-legend"
          class="pointer-events-none absolute bottom-3 left-3 px-3 py-1.5 rounded-lg bg-[#0d0305]/90 border border-[var(--borda-fina)] flex flex-wrap items-center gap-3 text-[11px]">
        </div>

        <!-- Dica Inferior Direita -->
        <div class="pointer-events-none absolute bottom-3 right-3 px-3 py-1.5 rounded-lg bg-[#0d0305]/90 border border-[var(--borda-fina)] text-[11px] font-mono-code text-[var(--texto-mutado)]">
          Arraste para mover • Scroll para zoom • Clique no nó para abrir
        </div>
      </div>
    </div>
  `;

  if (keepExpanded) {
    setExpandedMode(true);
  }

  const stage = document.getElementById('nyx-graph-stage');
  const canvas = document.getElementById('nyx-graph-canvas');
  const ctx = canvas.getContext('2d');

  // Construção dos nós e arestas a partir das Wikis
  const titleToId = new Map();
  rawEntries.forEach(entry => {
    if (entry.title) {
      titleToId.set(entry.title.trim().toLowerCase(), entry.id);
    }
  });

  const allNodes = rawEntries.map((entry, idx) => {
    const title = (entry.title || 'Sem Título').trim();
    const category = (entry.category || 'Geral').trim();
    const angle = (idx / Math.max(1, rawEntries.length)) * Math.PI * 2;
    const spread = 110 + (idx % 3) * 45;

    return {
      id: entry.id,
      title,
      category,
      color: getCategoryColor(category),
      x: Math.cos(angle) * spread,
      y: Math.sin(angle) * spread,
      vx: 0,
      vy: 0,
      radius: 9,
      collisionRadius: 15.5, // Rente à borda do anel externo da célula
      degree: 0
    };
  });

  const nodeMap = new Map(allNodes.map(n => [n.id, n]));
  const edgeSet = new Set();
  const allEdges = [];

  rawEntries.forEach(entry => {
    const content = entry.content || '';
    const matches = content.matchAll(/\[\[([^\[\]\n]+)\]\]/g);
    for (const match of matches) {
      const targetTitle = match[1].trim().toLowerCase();
      const targetId = titleToId.get(targetTitle);
      if (targetId && targetId !== entry.id && nodeMap.has(targetId)) {
        const pairKey = [entry.id, targetId].sort().join('::');
        if (!edgeSet.has(pairKey)) {
          edgeSet.add(pairKey);
          allEdges.push({ source: entry.id, target: targetId });
          nodeMap.get(entry.id).degree++;
          nodeMap.get(targetId).degree++;
        }
      }
    }
  });

  // Legenda dinâmica das categorias presentes
  const legendEl = document.getElementById('nyx-graph-legend');
  const legendCats = categories.length > 0 ? categories : ['Locais', 'NPCs', 'Facções', 'Regras'];
  legendEl.innerHTML = legendCats.map(cat => `
    <span class="inline-flex items-center gap-1.5 text-[var(--texto-principal)]">
      <span class="w-2.5 h-2.5 rounded-full" style="background-color: ${getCategoryColor(cat)};"></span>
      <span>${escapeHtml(cat)}</span>
    </span>
  `).join('');

  // Estado da câmera e interação
  let viewWidth = 800;
  let viewHeight = 500;
  let camera = { ...savedState.camera };

  let hoveredNode = null;
  let draggedNode = null;
  let isPanning = false;
  let pointerDownScreen = { x: 0, y: 0 };
  let panStart = { x: 0, y: 0 };
  let dragMoved = false;

  let activeCategory = savedState.activeCategory;
  let searchTerm = savedState.searchTerm;
  let showOrphans = savedState.showOrphans;

  function syncCanvasResolution() {
    const rect = stage.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    viewWidth = rect.width;
    viewHeight = rect.height;
    const targetW = Math.round(rect.width * dpr);
    const targetH = Math.round(rect.height * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
  }

  syncCanvasResolution();
  resizeObserver = new ResizeObserver(() => syncCanvasResolution());
  resizeObserver.observe(stage);

  function screenToWorld(sx, sy) {
    return {
      x: (sx - viewWidth / 2 - camera.x) / camera.zoom,
      y: (sy - viewHeight / 2 - camera.y) / camera.zoom
    };
  }

  function getVisibleGraph() {
    const visibleNodes = allNodes.filter(n => {
      if (activeCategory !== 'ALL' && n.category !== activeCategory) return false;
      if (!showOrphans && n.degree === 0) return false;
      return true;
    });

    const visibleIds = new Set(visibleNodes.map(n => n.id));
    const visibleEdges = allEdges.filter(
      e => visibleIds.has(e.source) && visibleIds.has(e.target)
    );

    const statsEl = document.getElementById('graph-stats-label');
    if (statsEl) {
      statsEl.textContent = `${visibleNodes.length} nós • ${visibleEdges.length} conexões`;
    }

    return { visibleNodes, visibleEdges };
  }

  /* Hitbox precisa cobrindo o círculo e o título do nó */
  function findNodeAtScreen(sx, sy) {
    const { visibleNodes } = getVisibleGraph();
    const { x: wx, y: wy } = screenToWorld(sx, sy);

    const minCircleHit = Math.max(15, 18 / camera.zoom);

    for (let i = visibleNodes.length - 1; i >= 0; i--) {
      const n = visibleNodes[i];

      const dist = Math.hypot(wx - n.x, wy - n.y);
      if (dist <= Math.max(n.radius + 7 / camera.zoom, minCircleHit)) {
        return n;
      }

      const halfLabelW = Math.max(26, n.title.length * 3.6) / Math.max(0.75, camera.zoom * 0.85);
      const labelTop = n.y + n.radius + 2 / camera.zoom;
      const labelBottom = labelTop + 20 / camera.zoom;

      if (
        wx >= n.x - halfLabelW &&
        wx <= n.x + halfLabelW &&
        wy >= labelTop &&
        wy <= labelBottom
      ) {
        return n;
      }
    }
    return null;
  }

  /* Simulação física com colisão rente à borda da célula */
  function stepPhysics(visibleNodes, visibleEdges) {
    const count = visibleNodes.length;
    if (count === 0) return;

    // 1. Gravidade suave para manter o grafo agrupado no centro
    for (let i = 0; i < count; i++) {
      const n = visibleNodes[i];
      if (n === draggedNode) {
        n.vx = 0;
        n.vy = 0;
        continue;
      }
      n.vx += -n.x * 0.006;
      n.vy += -n.y * 0.006;
    }

    // 2. Repulsão leve para não haver barreira invisível distante
    for (let i = 0; i < count; i++) {
      const a = visibleNodes[i];
      for (let j = i + 1; j < count; j++) {
        const b = visibleNodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        if (dist < 0.01) {
          dx = Math.cos(i + j + 1) * 0.5;
          dy = Math.sin(i + j + 1) * 0.5;
          dist = 0.5;
        }
        if (dist < 240) {
          const force = 220 / (dist * dist + 180);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          if (a !== draggedNode) { a.vx -= fx; a.vy -= fy; }
          if (b !== draggedNode) { b.vx += fx; b.vy += fy; }
        }
      }
    }

    // 3. Atração das molas nos fios de ligação
    const idealLength = 135;
    for (let i = 0; i < visibleEdges.length; i++) {
      const edge = visibleEdges[i];
      const a = nodeMap.get(edge.source);
      const b = nodeMap.get(edge.target);
      if (!a || !b) continue;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 1;
      const diff = dist - idealLength;
      const spring = diff * 0.016;
      const fx = (dx / dist) * spring;
      const fy = (dy / dist) * spring;

      if (a !== draggedNode) { a.vx += fx; a.vy += fy; }
      if (b !== draggedNode) { b.vx -= fx; b.vy -= fy; }
    }

    // 4. Integração de velocidade com amortecimento
    const maxSpeed = 14;
    for (let i = 0; i < count; i++) {
      const n = visibleNodes[i];
      if (n === draggedNode) continue;
      n.vx *= 0.8;
      n.vy *= 0.8;
      const speed = Math.hypot(n.vx, n.vy);
      if (speed > maxSpeed) {
        n.vx = (n.vx / speed) * maxSpeed;
        n.vy = (n.vy / speed) * maxSpeed;
      }
      n.x += n.vx;
      n.y += n.vy;
    }

    // 5. Colisão de contato rente à borda da célula (6 passos por frame)
    for (let iter = 0; iter < 6; iter++) {
      for (let i = 0; i < count; i++) {
        const a = visibleNodes[i];
        for (let j = i + 1; j < count; j++) {
          const b = visibleNodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let dist = Math.hypot(dx, dy);
          const minDist = a.collisionRadius + b.collisionRadius;

          if (dist < minDist) {
            if (dist < 0.001) {
              const fallbackAngle = ((i * 73 + j * 37) % 360) * (Math.PI / 180);
              dx = Math.cos(fallbackAngle);
              dy = Math.sin(fallbackAngle);
              dist = 1;
            }

            const nx = dx / dist;
            const ny = dy / dist;
            const overlap = minDist - dist;

            if (a === draggedNode) {
              b.x += nx * overlap;
              b.y += ny * overlap;
              b.vx += nx * 0.5;
              b.vy += ny * 0.5;
            } else if (b === draggedNode) {
              a.x -= nx * overlap;
              a.y -= ny * overlap;
              a.vx -= nx * 0.5;
              a.vy -= ny * 0.5;
            } else {
              const half = overlap * 0.5;
              a.x -= nx * half;
              a.y -= ny * half;
              b.x += nx * half;
              b.y += ny * half;

              const rvx = b.vx - a.vx;
              const rvy = b.vy - a.vy;
              const velAlongNormal = rvx * nx + rvy * ny;
              if (velAlongNormal < 0) {
                const impulse = velAlongNormal * 0.45;
                a.vx += nx * impulse;
                a.vy += ny * impulse;
                b.vx -= nx * impulse;
                b.vy -= ny * impulse;
              }
            }
          }
        }
      }
    }
  }

  function renderFrame() {
    syncCanvasResolution();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const { visibleNodes, visibleEdges } = getVisibleGraph();
    stepPhysics(visibleNodes, visibleEdges);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, viewWidth, viewHeight);

    ctx.save();
    ctx.translate(viewWidth / 2 + camera.x, viewHeight / 2 + camera.y);
    ctx.scale(camera.zoom, camera.zoom);

    const focusNode = draggedNode || hoveredNode;
    const connectedIds = new Set();
    if (focusNode) {
      connectedIds.add(focusNode.id);
      visibleEdges.forEach(e => {
        if (e.source === focusNode.id) connectedIds.add(e.target);
        if (e.target === focusNode.id) connectedIds.add(e.source);
      });
    }

    const query = searchTerm.trim().toLowerCase();

    // 1. Desenha os fios com gradiente natural entre a cor da célula A e da célula B
    for (let i = 0; i < visibleEdges.length; i++) {
      const edge = visibleEdges[i];
      const a = nodeMap.get(edge.source);
      const b = nodeMap.get(edge.target);
      if (!a || !b) continue;

      const isHighlighted =
        focusNode && (edge.source === focusNode.id || edge.target === focusNode.id);

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);

      if (focusNode && !isHighlighted) {
        ctx.globalAlpha = 0.16;
      } else if (isHighlighted) {
        ctx.globalAlpha = 1;
        ctx.shadowColor = focusNode.color;
        ctx.shadowBlur = 10;
      } else {
        ctx.globalAlpha = 0.85;
      }

      if (Math.hypot(b.x - a.x, b.y - a.y) > 0.5) {
        const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
        grad.addColorStop(0, a.color);
        grad.addColorStop(1, b.color);
        ctx.strokeStyle = grad;
      } else {
        ctx.strokeStyle = a.color;
      }

      ctx.lineWidth = (isHighlighted ? linkWidth + 1.2 : linkWidth) / Math.max(0.65, Math.sqrt(camera.zoom));
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();
    }

    // 2. Desenha as células/nós
    for (let i = 0; i < visibleNodes.length; i++) {
      const n = visibleNodes[i];
      const isFocus = focusNode && n.id === focusNode.id;
      const isNeighbor = focusNode && connectedIds.has(n.id);
      const matchesSearch = query && n.title.toLowerCase().includes(query);

      let alpha = 1;
      if (focusNode && !isNeighbor) alpha = 0.22;
      if (query && !matchesSearch && !isFocus) alpha = Math.min(alpha, 0.25);

      ctx.save();
      ctx.globalAlpha = alpha;

      const r = isFocus || matchesSearch ? n.radius + 2 : n.radius;

      // Halo externo (borda física da célula)
      ctx.beginPath();
      ctx.arc(n.x, n.y, r + 5, 0, Math.PI * 2);
      ctx.strokeStyle = isFocus || matchesSearch ? '#D4AF37' : n.color;
      ctx.lineWidth = isFocus || matchesSearch ? 1.8 : 1.1;
      ctx.globalAlpha = alpha * (isFocus || matchesSearch ? 0.9 : 0.42);
      ctx.stroke();

      // Núcleo da célula
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = n.color;
      if (isFocus || matchesSearch) {
        ctx.shadowColor = n.color;
        ctx.shadowBlur = 14;
      }
      ctx.fill();

      // Rótulo abaixo da célula
      const fontSize = Math.max(11, Math.min(14, 12.5 / Math.pow(camera.zoom, 0.25)));
      ctx.font = `${isFocus || matchesSearch ? '700' : '600'} ${fontSize}px Lora, Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.shadowColor = '#050102';
      ctx.shadowBlur = 6;
      ctx.fillStyle = isFocus || matchesSearch ? '#f7e7b4' : '#e8dfd8';
      ctx.fillText(n.title, n.x, n.y + r + 7);

      ctx.restore();
    }

    ctx.restore();
    animationFrameId = requestAnimationFrame(renderFrame);
  }

  // Eventos de Ponteiro (Hitbox, Arraste e Pan)
  canvas.addEventListener('pointerdown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    pointerDownScreen = { x: e.clientX, y: e.clientY };
    dragMoved = false;

    const hit = findNodeAtScreen(sx, sy);
    if (hit) {
      draggedNode = hit;
      canvas.style.cursor = 'grabbing';
    } else {
      isPanning = true;
      panStart = { x: e.clientX - camera.x, y: e.clientY - camera.y };
      canvas.style.cursor = 'grabbing';
    }

    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (Math.hypot(e.clientX - pointerDownScreen.x, e.clientY - pointerDownScreen.y) >= 5) {
      dragMoved = true;
    }

    if (draggedNode) {
      const worldPos = screenToWorld(sx, sy);
      draggedNode.x = worldPos.x;
      draggedNode.y = worldPos.y;
      draggedNode.vx = 0;
      draggedNode.vy = 0;
      return;
    }

    if (isPanning) {
      camera.x = e.clientX - panStart.x;
      camera.y = e.clientY - panStart.y;
      savedState.camera = { ...camera };
      return;
    }

    const hit = findNodeAtScreen(sx, sy);
    hoveredNode = hit;
    canvas.style.cursor = hit ? 'pointer' : 'grab';
  });

  canvas.addEventListener('pointerup', (e) => {
    const clickedNode = draggedNode;
    const wasClick = !dragMoved;

    draggedNode = null;
    isPanning = false;

    const rect = canvas.getBoundingClientRect();
    const hit = findNodeAtScreen(e.clientX - rect.left, e.clientY - rect.top);
    hoveredNode = hit;
    canvas.style.cursor = hit ? 'pointer' : 'grab';

    if (clickedNode && wasClick) {
      openReaderModal(clickedNode.id);
    }
  });

  canvas.addEventListener('pointerleave', () => {
    if (!draggedNode) {
      hoveredNode = null;
      canvas.style.cursor = 'grab';
    }
  });

  // Zoom focado no ponteiro
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    const before = screenToWorld(sx, sy);
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    camera.zoom = Math.min(2.6, Math.max(0.35, camera.zoom * factor));

    camera.x = sx - viewWidth / 2 - before.x * camera.zoom;
    camera.y = sy - viewHeight / 2 - before.y * camera.zoom;
    savedState.camera = { ...camera };
  }, { passive: false });

  // Controles da Barra Superior
  document.getElementById('graph-category-filter').addEventListener('change', (e) => {
    activeCategory = e.target.value;
    savedState.activeCategory = activeCategory;
  });

  document.getElementById('graph-search-input').addEventListener('input', (e) => {
    searchTerm = e.target.value;
    savedState.searchTerm = searchTerm;
    const q = searchTerm.trim().toLowerCase();
    if (q) {
      const match = allNodes.find(n => n.title.toLowerCase().includes(q));
      if (match) {
        camera.x = -match.x * camera.zoom;
        camera.y = -match.y * camera.zoom;
        savedState.camera = { ...camera };
      }
    }
  });

  document.getElementById('graph-show-orphans').addEventListener('change', (e) => {
    showOrphans = e.target.checked;
    savedState.showOrphans = showOrphans;
  });

  document.getElementById('graph-zoom-in').addEventListener('click', () => {
    camera.zoom = Math.min(2.6, camera.zoom * 1.18);
    savedState.camera = { ...camera };
  });

  document.getElementById('graph-zoom-out').addEventListener('click', () => {
    camera.zoom = Math.max(0.35, camera.zoom / 1.18);
    savedState.camera = { ...camera };
  });

  document.getElementById('graph-center-btn').addEventListener('click', () => {
    camera = { x: 0, y: 0, zoom: 1 };
    savedState.camera = { ...camera };
  });

  document.getElementById('btn-graph-expand').addEventListener('click', () => {
    setExpandedMode(!isExpanded);
  });

  keydownHandler = (e) => {
    if (e.key === 'Escape' && isExpanded) {
      const modalRoot = document.getElementById('modal-root');
      if (!modalRoot || modalRoot.innerHTML.trim() === '') {
        setExpandedMode(false);
      }
    }
  };
  document.addEventListener('keydown', keydownHandler);

  // Controles de Espessura dos Fios
  const widthSlider = document.getElementById('graph-link-width');
  const widthLabel = document.getElementById('graph-link-width-label');
  const updateLinkWidth = (val) => {
    linkWidth = Math.min(8, Math.max(1, Number(val) || 2));
    widthSlider.value = linkWidth;
    widthLabel.textContent = `${linkWidth}px`;
    localStorage.setItem(STORAGE_WIDTH_KEY, String(linkWidth));
  };

  widthSlider.addEventListener('input', (e) => updateLinkWidth(e.target.value));
  document.getElementById('graph-link-thin').addEventListener('click', () => updateLinkWidth(linkWidth - 0.5));
  document.getElementById('graph-link-thick').addEventListener('click', () => updateLinkWidth(linkWidth + 0.5));

  animationFrameId = requestAnimationFrame(renderFrame);
}