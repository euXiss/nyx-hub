// js/modules/graph-view.js
import { getWikiEntries, openReaderModal } from './wiki-cms.js';
import { isMaster } from './roles-manager.js';

let animationFrameId = null;
let resizeHandler = null;

let nodes = [];
let edges = [];
const positionCache = new Map();

let camera = { x: 0, y: 0, zoom: 1 };
let hoveredNode = null;
let draggedNode = null;
let isPanning = false;
let panStart = { x: 0, y: 0 };
let pointerDownPos = { x: 0, y: 0 };

let showOrphans = true;
let categoryFilter = 'Todos';
let highlightQuery = '';

const CATEGORY_COLORS = {
  'Locais': '#D4AF37',     // Dourado
  'NPCs': '#C62828',       // Carmesim
  'Facções': '#f7e7b4',    // Dourado Claro
  'Regras': '#e5e0dc'      // Branco Quente
};

function getCategoryColor(category) {
  return CATEGORY_COLORS[category] || '#b88924';
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function rebuildGraphData() {
  const entries = getWikiEntries();
  const masterMode = isMaster();

  const titleToId = new Map();
  entries.forEach(item => {
    if (item.title) {
      titleToId.set(item.title.trim().toLowerCase(), item.id);
    }
  });

  const edgeSet = new Set();
  const builtEdges = [];
  const degreeMap = new Map();
  entries.forEach(item => degreeMap.set(item.id, 0));

  entries.forEach(item => {
    let searchableText = item.content || '';
    if (item.masterSecret && (masterMode || item.secretRevealed)) {
      searchableText += '\n' + item.masterSecret;
    }

    const regex = /\[\[([^\[\]\n]+)\]\]/g;
    let match;
    while ((match = regex.exec(searchableText)) !== null) {
      const targetTitle = match[1].trim().toLowerCase();
      const targetId = titleToId.get(targetTitle);
      if (targetId && targetId !== item.id) {
        const pairKey = [item.id, targetId].sort().join('::');
        if (!edgeSet.has(pairKey)) {
          edgeSet.add(pairKey);
          builtEdges.push({ source: item.id, target: targetId });
          degreeMap.set(item.id, (degreeMap.get(item.id) || 0) + 1);
          degreeMap.set(targetId, (degreeMap.get(targetId) || 0) + 1);
        }
      }
    }
  });

  const visibleEntries = entries.filter(item => {
    const matchCat = categoryFilter === 'Todos' || item.category === categoryFilter;
    const deg = degreeMap.get(item.id) || 0;
    const matchOrphan = showOrphans || deg > 0;
    return matchCat && matchOrphan;
  });

  const visibleIds = new Set(visibleEntries.map(e => e.id));

  nodes = visibleEntries.map((item, idx) => {
    const cached = positionCache.get(item.id);
    const angle = (idx / Math.max(1, visibleEntries.length)) * Math.PI * 2;
    const spread = 90 + (idx % 5) * 35;

    const degree = degreeMap.get(item.id) || 0;
    const radius = Math.min(18, 6.5 + degree * 1.6);

    const nodeObj = {
      id: item.id,
      title: item.title || 'Sem título',
      category: item.category || 'Geral',
      subtitle: item.subtitle || '',
      degree,
      radius,
      color: getCategoryColor(item.category),
      x: cached ? cached.x : Math.cos(angle) * spread,
      y: cached ? cached.y : Math.sin(angle) * spread,
      vx: cached ? cached.vx : 0,
      vy: cached ? cached.vy : 0
    };

    positionCache.set(item.id, nodeObj);
    return nodeObj;
  });

  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  edges = builtEdges
    .filter(e => visibleIds.has(e.source) && visibleIds.has(e.target))
    .map(e => ({
      source: nodeMap.get(e.source),
      target: nodeMap.get(e.target)
    }));

  const statsEl = document.getElementById('graph-stats');
  if (statsEl) {
    statsEl.textContent = `${nodes.length} nós • ${edges.length} conexões`;
  }
}

export function unmountGraphView() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler);
    resizeHandler = null;
  }
  hoveredNode = null;
  draggedNode = null;
  isPanning = false;
}

export function refreshGraphView() {
  if (!document.getElementById('nyx-graph-canvas')) return;
  rebuildGraphData();
}

export function mountGraphView(container) {
  unmountGraphView();

  container.innerHTML = `
    <div class="bg-[var(--bg-card)] border border-[var(--borda-fina)] rounded-xl overflow-hidden shadow-2xl flex flex-col">
      <!-- Barra Superior de Controles do Grafo -->
      <div class="p-4 border-b border-[var(--borda-fina)] bg-[#110406] flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <select id="graph-cat-filter" class="bg-[var(--bg-card)] text-[var(--texto-principal)] border border-[var(--borda-fina)] rounded-lg px-3 py-1.5 text-xs focus:border-[var(--dourado)] focus:outline-none">
            <option value="Todos">Todas as Categorias</option>
            <option value="Locais">Locais</option>
            <option value="NPCs">NPCs</option>
            <option value="Facções">Facções</option>
            <option value="Regras">Regras</option>
          </select>

          <input type="text" id="graph-search-node" placeholder="Localizar nó..."
            class="bg-[var(--bg-card)] text-[var(--texto-principal)] border border-[var(--borda-fina)] rounded-lg px-3 py-1.5 text-xs w-40 sm:w-48 focus:border-[var(--dourado)] focus:outline-none">

          <label class="flex items-center gap-1.5 text-xs text-[var(--texto-mutado)] cursor-pointer select-none px-2">
            <input type="checkbox" id="graph-toggle-orphans" ${showOrphans ? 'checked' : ''} class="accent-[#D4AF37]">
            Mostrar sem links
          </label>
        </div>

        <div class="flex items-center gap-2">
          <span id="graph-stats" class="text-[11px] font-mono-code text-[var(--texto-mutado)] mr-2">0 nós • 0 conexões</span>
          <button type="button" id="graph-zoom-in" title="Aproximar" class="px-2.5 py-1 rounded bg-[var(--bg-card)] border border-[var(--borda-fina)] text-xs text-[var(--dourado-claro)]">+</button>
          <button type="button" id="graph-zoom-out" title="Afastar" class="px-2.5 py-1 rounded bg-[var(--bg-card)] border border-[var(--borda-fina)] text-xs text-[var(--dourado-claro)]">−</button>
          <button type="button" id="graph-reset-view" class="px-3 py-1 rounded bg-[var(--vinho-escuro)] border border-[var(--dourado)] text-xs text-[var(--dourado-claro)] font-semibold">
            Centralizar
          </button>
        </div>
      </div>

      <!-- Área Interativa do Grafo -->
      <div id="nyx-graph-stage" class="relative w-full h-[68vh] min-h-[440px] bg-[radial-gradient(circle_at_center,#1b060a_0%,#070203_100%)] select-none overflow-hidden">
        <canvas id="nyx-graph-canvas" class="block w-full h-full cursor-grab"></canvas>

        <!-- Legenda de Cores -->
        <div class="absolute bottom-3 left-3 bg-[#100305]/90 backdrop-blur-md border border-[var(--borda-fina)] rounded-lg px-3 py-2 flex flex-wrap items-center gap-3 text-[11px] font-mono-code pointer-events-none">
          <span class="flex items-center gap-1.5 text-[var(--dourado)]"><span class="w-2.5 h-2.5 rounded-full bg-[#D4AF37]"></span>Locais</span>
          <span class="flex items-center gap-1.5 text-red-300"><span class="w-2.5 h-2.5 rounded-full bg-[#C62828]"></span>NPCs</span>
          <span class="flex items-center gap-1.5 text-[var(--dourado-claro)]"><span class="w-2.5 h-2.5 rounded-full bg-[#f7e7b4]"></span>Facções</span>
          <span class="flex items-center gap-1.5 text-[var(--texto-principal)]"><span class="w-2.5 h-2.5 rounded-full bg-[#e5e0dc]"></span>Regras</span>
        </div>

        <!-- Dica de Navegação -->
        <div class="absolute bottom-3 right-3 hidden sm:block bg-[#100305]/80 border border-[var(--borda-fina)] rounded-lg px-3 py-1.5 text-[10px] font-mono-code text-[var(--texto-mutado)] pointer-events-none">
          Arraste para mover • Scroll para zoom • Clique no nó para abrir
        </div>
      </div>
    </div>
  `;

  const stage = document.getElementById('nyx-graph-stage');
  const canvas = document.getElementById('nyx-graph-canvas');
  const ctx = canvas.getContext('2d');

  let width = 0;
  let height = 0;

  const resizeCanvas = () => {
    const rect = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  resizeCanvas();
  resizeHandler = resizeCanvas;
  window.addEventListener('resize', resizeHandler);

  rebuildGraphData();

  // Controles da barra superior
  const catSelect = document.getElementById('graph-cat-filter');
  catSelect.value = categoryFilter;
  catSelect.addEventListener('change', (e) => {
    categoryFilter = e.target.value;
    rebuildGraphData();
  });

  document.getElementById('graph-search-node').addEventListener('input', (e) => {
    highlightQuery = e.target.value.trim().toLowerCase();
  });

  document.getElementById('graph-toggle-orphans').addEventListener('change', (e) => {
    showOrphans = e.target.checked;
    rebuildGraphData();
  });

  document.getElementById('graph-zoom-in').addEventListener('click', () => {
    camera.zoom = Math.min(3.2, camera.zoom * 1.2);
  });

  document.getElementById('graph-zoom-out').addEventListener('click', () => {
    camera.zoom = Math.max(0.3, camera.zoom / 1.2);
  });

  document.getElementById('graph-reset-view').addEventListener('click', () => {
    camera = { x: 0, y: 0, zoom: 1 };
  });

  // Conversão de coordenadas Tela <-> Mundo do Grafo
  const screenToWorld = (clientX, clientY) => {
    const rect = canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return {
      x: (sx - width / 2 - camera.x) / camera.zoom,
      y: (sy - height / 2 - camera.y) / camera.zoom
    };
  };

  const findNodeAt = (wx, wy) => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const hitRadius = n.radius + 6 / camera.zoom;
      if (Math.hypot(wx - n.x, wy - n.y) <= hitRadius) {
        return n;
      }
    }
    return null;
  };

  // Eventos de Ponteiro (Mouse e Toque)
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointerDownPos = { x: e.clientX, y: e.clientY };
    const worldPos = screenToWorld(e.clientX, e.clientY);
    const hit = findNodeAt(worldPos.x, worldPos.y);

    if (hit) {
      draggedNode = hit;
      canvas.style.cursor = 'grabbing';
    } else {
      isPanning = true;
      panStart = { x: e.clientX - camera.x, y: e.clientY - camera.y };
      canvas.style.cursor = 'grabbing';
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const worldPos = screenToWorld(e.clientX, e.clientY);

    if (draggedNode) {
      draggedNode.x = worldPos.x;
      draggedNode.y = worldPos.y;
      draggedNode.vx = 0;
      draggedNode.vy = 0;
      return;
    }

    if (isPanning) {
      camera.x = e.clientX - panStart.x;
      camera.y = e.clientY - panStart.y;
      return;
    }

    const hit = findNodeAt(worldPos.x, worldPos.y);
    hoveredNode = hit;
    canvas.style.cursor = hit ? 'pointer' : 'grab';
  });

  canvas.addEventListener('pointerup', (e) => {
    const moveDist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);

    if (draggedNode && moveDist < 5) {
      openReaderModal(draggedNode.id);
    }

    draggedNode = null;
    isPanning = false;
    canvas.style.cursor = hoveredNode ? 'pointer' : 'grab';
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    const nextZoom = Math.min(3.5, Math.max(0.28, camera.zoom * factor));

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left - width / 2;
    const my = e.clientY - rect.top - height / 2;

    camera.x = mx - ((mx - camera.x) / camera.zoom) * nextZoom;
    camera.y = my - ((my - camera.y) / camera.zoom) * nextZoom;
    camera.zoom = nextZoom;
  }, { passive: false });

  // Simulação física de forças
  const stepPhysics = () => {
    const count = nodes.length;
    if (count === 0) return;

    const repulsion = 2400;
    const springLength = 125;
    const springStrength = 0.018;
    const centerGravity = 0.008;
    const damping = 0.85;

    for (let i = 0; i < count; i++) {
      const a = nodes[i];
      if (a === draggedNode) continue;

      // Gravidade suave para o centro
      a.vx += -a.x * centerGravity;
      a.vy += -a.y * centerGravity;

      // Repulsão entre nós
      for (let j = i + 1; j < count; j++) {
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distSq = dx * dx + dy * dy;
        if (distSq < 25) {
          dx = (Math.random() - 0.5) * 6;
          dy = (Math.random() - 0.5) * 6;
          distSq = 36;
        }
        const dist = Math.sqrt(distSq);
        const force = repulsion / distSq;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        a.vx -= fx;
        a.vy -= fy;
        if (b !== draggedNode) {
          b.vx += fx;
          b.vy += fy;
        }
      }
    }

    // Atração pelas conexões [[Link]]
    for (let i = 0; i < edges.length; i++) {
      const { source, target } = edges[i];
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.max(1, Math.hypot(dx, dy));
      const displacement = dist - springLength;
      const force = displacement * springStrength;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      if (source !== draggedNode) {
        source.vx += fx;
        source.vy += fy;
      }
      if (target !== draggedNode) {
        target.vx -= fx;
        target.vy -= fy;
      }
    }

    for (let i = 0; i < count; i++) {
      const n = nodes[i];
      if (n === draggedNode) continue;
      n.vx *= damping;
      n.vy *= damping;
      n.x += n.vx;
      n.y += n.vy;
    }
  };

  // Renderização no Canvas
  const renderFrame = () => {
    stepPhysics();

    ctx.clearRect(0, 0, width, height);

    if (nodes.length === 0) {
      ctx.fillStyle = '#b8a9a5';
      ctx.font = '14px Lora, serif';
      ctx.textAlign = 'center';
      ctx.fillText('Nenhum registro encontrado para exibir no gráfico.', width / 2, height / 2);
      animationFrameId = requestAnimationFrame(renderFrame);
      return;
    }

    ctx.save();
    ctx.translate(width / 2 + camera.x, height / 2 + camera.y);
    ctx.scale(camera.zoom, camera.zoom);

    // Determina vizinhos iluminados se houver hover
    const connectedIds = new Set();
    if (hoveredNode) {
      connectedIds.add(hoveredNode.id);
      edges.forEach(e => {
        if (e.source.id === hoveredNode.id) connectedIds.add(e.target.id);
        if (e.target.id === hoveredNode.id) connectedIds.add(e.source.id);
      });
    }

    // 1. Desenha as linhas de conexão
    edges.forEach(e => {
      const isHighlighted = hoveredNode &&
        (e.source.id === hoveredNode.id || e.target.id === hoveredNode.id);

      ctx.beginPath();
      ctx.moveTo(e.source.x, e.source.y);
      ctx.lineTo(e.target.x, e.target.y);

      if (hoveredNode) {
        ctx.strokeStyle = isHighlighted
          ? 'rgba(212, 175, 55, 0.85)'
          : 'rgba(212, 175, 55, 0.06)';
        ctx.lineWidth = (isHighlighted ? 2 : 0.8) / camera.zoom;
      } else {
        ctx.strokeStyle = 'rgba(212, 175, 55, 0.26)';
        ctx.lineWidth = 1.15 / camera.zoom;
      }
      ctx.stroke();
    });

    // 2. Desenha cada nó (célula) e seu título
    nodes.forEach(n => {
      const matchesSearch = !highlightQuery || n.title.toLowerCase().includes(highlightQuery);
      const isDimmedByHover = hoveredNode && !connectedIds.has(n.id);
      const isDimmed = isDimmedByHover || !matchesSearch;
      const isFocus = hoveredNode?.id === n.id || (highlightQuery && matchesSearch);

      ctx.save();
      ctx.globalAlpha = isDimmed ? 0.16 : 1;

      // Aura luminosa ao redor do nó
      if (isFocus || n.degree >= 2) {
        const glow = ctx.createRadialGradient(n.x, n.y, n.radius * 0.4, n.x, n.y, n.radius * 2.4);
        glow.addColorStop(0, n.color + '55');
        glow.addColorStop(1, 'transparent');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius * 2.4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Corpo do nó
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
      ctx.fillStyle = isFocus ? n.color : '#140407';
      ctx.fill();

      ctx.lineWidth = (isFocus ? 2.4 : 1.7) / camera.zoom;
      ctx.strokeStyle = n.color;
      ctx.stroke();

      // Núcleo interno
      if (!isFocus) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius * 0.36, 0, Math.PI * 2);
        ctx.fillStyle = n.color;
        ctx.fill();
      }

      // Rótulo de texto abaixo do nó
      if (camera.zoom >= 0.45 || isFocus || n.degree >= 2) {
        const fontSize = Math.max(10, 12.5 / Math.pow(camera.zoom, 0.35));
        ctx.font = `${isFocus ? '700' : '500'} ${fontSize}px Lora, serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        const labelY = n.y + n.radius + 5 / camera.zoom;
        ctx.lineWidth = 3 / camera.zoom;
        ctx.strokeStyle = 'rgba(7, 2, 3, 0.9)';
        ctx.strokeText(n.title, n.x, labelY);

        ctx.fillStyle = isFocus ? '#ffffff' : '#f5f0ec';
        ctx.fillText(n.title, n.x, labelY);
      }

      ctx.restore();
    });

    ctx.restore();
    animationFrameId = requestAnimationFrame(renderFrame);
  };

  animationFrameId = requestAnimationFrame(renderFrame);
}