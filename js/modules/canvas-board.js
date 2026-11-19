// js/modules/canvas-board.js
import { db, auth } from '../config/firebase.js';
import {
  collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getWikiEntries, openReaderModal, openEditorModal, attachWikiLinkAutocomplete } from './wiki-cms.js';
import { isMaster } from './roles-manager.js';

let boardCards = [];
let unsubscribeBoard = null;
let escapeKeyHandler = null;

let camera = { x: 120, y: 80, zoom: 1 };
let isExpanded = false;

let isPanning = false;
let panStart = { x: 0, y: 0 };

let draggingCardId = null;
let dragOffset = { x: 0, y: 0 };
let dragCurrentPos = { x: 0, y: 0 };
let activeAlignGuides = []; // Guias visuais de alinhamento/simetria

// Controle de criação e reatribuição de fios
let pendingEdgeInteraction = null;
let wiringDrag = null; // { mode: 'create' | 'rewire-target' | 'rewire-source', ... }
let hoveredTarget = null; // { cardId, side }
let pointerWorldPos = { x: 0, y: 0 };

const PIN_PRESETS = {
  gold: { label: 'Pista', color: '#D4AF37' },
  crimson: { label: 'Suspeita', color: '#C62828' },
  white: { label: 'Teoria', color: '#f5f0ec' }
};

const PALETTE_SWATCHES = [
  '#D4AF37', '#C62828', '#f5f0ec', '#8b5cf6',
  '#3b82f6', '#10b981', '#f97316', '#ec4899'
];

const LEGACY_EDGE_COLORS = {
  crimson: '#C62828',
  gold: '#D4AF37',
  white: '#e5e0dc'
};

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function resolvePinVisual(pinColor = 'gold') {
  if (PIN_PRESETS[pinColor]) {
    const { label, color } = PIN_PRESETS[pinColor];
    return { label, color, border: `${color}88` };
  }
  const safeColor = /^#[0-9A-Fa-f]{6}$/.test(pinColor) ? pinColor : '#D4AF37';
  return { label: 'Anotação', color: safeColor, border: `${safeColor}88` };
}

function resolveEdgeColor(conn) {
  if (conn.color && /^#[0-9A-Fa-f]{6}$/.test(conn.color)) return conn.color;
  return LEGACY_EDGE_COLORS[conn.style] || '#C62828';
}

function resolveEdgeLineStyle(conn) {
  if (conn.lineStyle === 'dashed' || conn.style === 'white') return 'dashed';
  return 'solid';
}

function resolveEdgeDirection(conn) {
  if (conn.direction === 'uni' || conn.direction === 'bi' || conn.direction === 'none') {
    return conn.direction;
  }
  return 'none';
}

function getCurrentAuthorName() {
  const user = auth.currentUser;
  if (!user) return 'Investigador';
  if (user.displayName && user.displayName.trim()) return user.displayName.trim();
  if (user.email) return user.email.split('@')[0];
  return 'Investigador';
}

function renderCardLinkedText(rawText = '') {
  const entries = getWikiEntries();
  const escaped = escapeHtml(rawText);
  return escaped.replace(/\[\[([^\[\]\n]+)\]\]/g, (_, innerEscaped) => {
    const cleanTarget = innerEscaped.trim();
    const found = entries.find(
      w => escapeHtml(w.title).trim().toLowerCase() === cleanTarget.toLowerCase()
    );
    if (found) {
      return `<button type="button" class="nyx-wikilink" data-board-wikilink="${found.id}" title="Abrir Wiki: ${escapeHtml(found.title)}">${cleanTarget}</button>`;
    }
    return `<button type="button" class="nyx-wikilink-missing" data-board-create-wiki="${cleanTarget}" title="Wiki não encontrada — clique para criar">${cleanTarget}</button>`;
  });
}

function compressBoardImage(file, maxWidth = 850, quality = 0.78) {
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

function applyCameraTransform() {
  const world = document.getElementById('nyx-canvas-world');
  const zoomLabel = document.getElementById('canvas-zoom-label');
  if (world) {
    world.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`;
  }
  if (zoomLabel) {
    zoomLabel.textContent = `${Math.round(camera.zoom * 100)}%`;
  }
}

function getCardBounds(card) {
  const el = document.getElementById(`board-card-${card.id}`);
  const w = el ? el.offsetWidth : 265;
  const h = el ? el.offsetHeight : 145;
  const x = (draggingCardId === card.id) ? dragCurrentPos.x : (card.x || 0);
  const y = (draggingCardId === card.id) ? dragCurrentPos.y : (card.y || 0);
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
}

function getPortCoords(card, side) {
  const b = getCardBounds(card);
  if (side === 'top') return { x: b.cx, y: b.y, side: 'top' };
  if (side === 'bottom') return { x: b.cx, y: b.y + b.h, side: 'bottom' };
  if (side === 'left') return { x: b.x, y: b.cy, side: 'left' };
  return { x: b.x + b.w, y: b.cy, side: 'right' };
}

function findClosestPortOnCard(card, wx, wy) {
  const sides = ['top', 'right', 'bottom', 'left'];
  let best = null;
  for (const side of sides) {
    const coords = getPortCoords(card, side);
    const dist = Math.hypot(wx - coords.x, wy - coords.y);
    if (!best || dist < best.dist) {
      best = { ...coords, dist };
    }
  }
  return best;
}

function getBestAnchorPair(cardA, cardB) {
  const sides = ['top', 'right', 'bottom', 'left'];
  let best = null;
  let minDist = Infinity;

  for (const sA of sides) {
    const pA = getPortCoords(cardA, sA);
    for (const sB of sides) {
      const pB = getPortCoords(cardB, sB);
      const d = Math.hypot(pB.x - pA.x, pB.y - pA.y);
      if (d < minDist) {
        minDist = d;
        best = { p1: pA, p2: pB };
      }
    }
  }
  return best;
}

/* Usa os pontos escolhidos pelo usuário; só calcula automático se for fio antigo sem ponto salvo */
function getEdgeEndpoints(sourceCard, targetCard, conn) {
  let fallback = null;
  if (!conn.fromSide || !conn.toSide) {
    fallback = getBestAnchorPair(sourceCard, targetCard);
  }
  const fromSide = conn.fromSide || fallback.p1.side;
  const toSide = conn.toSide || fallback.p2.side;
  return {
    p1: getPortCoords(sourceCard, fromSide),
    p2: getPortCoords(targetCard, toSide)
  };
}

function getControlOffset(side, dist) {
  const pull = Math.min(85, Math.max(32, dist * 0.35));
  if (side === 'top') return { dx: 0, dy: -pull };
  if (side === 'bottom') return { dx: 0, dy: pull };
  if (side === 'left') return { dx: -pull, dy: 0 };
  return { dx: pull, dy: 0 };
}

/* Alinhamento magnético opcional (estilo Obsidian) + Guias de Simetria */
function computeSmartAlignment(movingId, rawX, rawY) {
  const el = document.getElementById(`board-card-${movingId}`);
  const mw = el ? el.offsetWidth : 265;
  const mh = el ? el.offsetHeight : 145;
  const threshold = Math.max(5, Math.min(11, 8 / camera.zoom));

  let snappedX = rawX;
  let snappedY = rawY;
  let bestDx = threshold + 1;
  let bestDy = threshold + 1;
  let alignedLineX = null;
  let alignedLineY = null;

  for (const other of boardCards) {
    if (other.id === movingId) continue;
    const ob = getCardBounds(other);

    const xChecks = [
      { diff: ob.x - rawX, targetLine: ob.x },
      { diff: ob.cx - (rawX + mw / 2), targetLine: ob.cx },
      { diff: (ob.x + ob.w) - (rawX + mw), targetLine: ob.x + ob.w },
      { diff: (ob.x + ob.w) - rawX, targetLine: ob.x + ob.w },
      { diff: ob.x - (rawX + mw), targetLine: ob.x }
    ];

    for (const c of xChecks) {
      if (Math.abs(c.diff) < bestDx) {
        bestDx = Math.abs(c.diff);
        snappedX = rawX + c.diff;
        alignedLineX = c.targetLine;
      }
    }

    const yChecks = [
      { diff: ob.y - rawY, targetLine: ob.y },
      { diff: ob.cy - (rawY + mh / 2), targetLine: ob.cy },
      { diff: (ob.y + ob.h) - (rawY + mh), targetLine: ob.y + ob.h },
      { diff: (ob.y + ob.h) - rawY, targetLine: ob.y + ob.h },
      { diff: ob.y - (rawY + mh), targetLine: ob.y }
    ];

    for (const c of yChecks) {
      if (Math.abs(c.diff) < bestDy) {
        bestDy = Math.abs(c.diff);
        snappedY = rawY + c.diff;
        alignedLineY = c.targetLine;
      }
    }
  }

  const guides = [];

  if (alignedLineX !== null) {
    let minY = snappedY;
    let maxY = snappedY + mh;
    for (const other of boardCards) {
      if (other.id === movingId) continue;
      const ob = getCardBounds(other);
      if (
        Math.abs(ob.x - alignedLineX) < 1.5 ||
        Math.abs(ob.cx - alignedLineX) < 1.5 ||
        Math.abs(ob.x + ob.w - alignedLineX) < 1.5
      ) {
        minY = Math.min(minY, ob.y);
        maxY = Math.max(maxY, ob.y + ob.h);
      }
    }
    guides.push({ type: 'v', x: alignedLineX, y1: minY - 12, y2: maxY + 12 });
  }

  if (alignedLineY !== null) {
    let minX = snappedX;
    let maxX = snappedX + mw;
    for (const other of boardCards) {
      if (other.id === movingId) continue;
      const ob = getCardBounds(other);
      if (
        Math.abs(ob.y - alignedLineY) < 1.5 ||
        Math.abs(ob.cy - alignedLineY) < 1.5 ||
        Math.abs(ob.y + ob.h - alignedLineY) < 1.5
      ) {
        minX = Math.min(minX, ob.x);
        maxX = Math.max(maxX, ob.x + ob.w);
      }
    }
    guides.push({ type: 'h', y: alignedLineY, x1: minX - 12, x2: maxX + 12 });
  }

  return { x: snappedX, y: snappedY, guides };
}

/* Colisão de bordas para evitar sobreposição entre etiquetas */
function resolveCardCollision(movingId, rawX, rawY) {
  const movingCard = boardCards.find(c => c.id === movingId);
  if (!movingCard) return { x: rawX, y: rawY };

  const el = document.getElementById(`board-card-${movingId}`);
  const mw = el ? el.offsetWidth : 265;
  const mh = el ? el.offsetHeight : 145;
  const GAP = 14;

  let x = rawX;
  let y = rawY;
  const prevX = movingCard.x || 0;
  const prevY = movingCard.y || 0;

  for (let pass = 0; pass < 3; pass++) {
    for (const other of boardCards) {
      if (other.id === movingId) continue;
      const ob = getCardBounds(other);

      const overlapX = x < ob.x + ob.w + GAP && x + mw + GAP > ob.x;
      const overlapY = y < ob.y + ob.h + GAP && y + mh + GAP > ob.y;

      if (overlapX && overlapY) {
        const pushLeft = (x + mw + GAP) - ob.x;
        const pushRight = (ob.x + ob.w + GAP) - x;
        const pushUp = (y + mh + GAP) - ob.y;
        const pushDown = (ob.y + ob.h + GAP) - y;

        const minH = Math.min(pushLeft, pushRight);
        const minV = Math.min(pushUp, pushDown);

        if (minH < minV && Math.abs(rawX - prevX) >= 0) {
          x = pushLeft < pushRight ? ob.x - mw - GAP : ob.x + ob.w + GAP;
        } else {
          y = pushUp < pushDown ? ob.y - mh - GAP : ob.y + ob.h + GAP;
        }
      }
    }
  }

  return { x: Math.round(x), y: Math.round(y) };
}

function findNonOverlappingSpawn(baseX, baseY) {
  let x = baseX;
  let y = baseY;
  const GAP = 18;
  const w = 265;
  const h = 155;

  for (let i = 0; i < 15; i++) {
    const collides = boardCards.some(other => {
      const ob = getCardBounds(other);
      return x < ob.x + ob.w + GAP && x + w + GAP > ob.x &&
             y < ob.y + ob.h + GAP && y + h + GAP > ob.y;
    });
    if (!collides) break;
    x += 34;
    y += 34;
  }
  return { x: Math.round(x), y: Math.round(y) };
}

function updateHoveredTargetVisuals(nextTarget) {
  const prevCardId = hoveredTarget?.cardId || null;
  const prevSide = hoveredTarget?.side || null;
  const nextCardId = nextTarget?.cardId || null;
  const nextSide = nextTarget?.side || null;

  if (prevCardId === nextCardId && prevSide === nextSide) return;

  if (prevCardId) {
    const prevCardEl = document.getElementById(`board-card-${prevCardId}`);
    prevCardEl?.classList.remove('link-target-hover');
    prevCardEl?.querySelectorAll('.port-target-hover').forEach(p => p.classList.remove('port-target-hover'));
  }

  hoveredTarget = nextTarget;

  if (nextCardId) {
    const nextCardEl = document.getElementById(`board-card-${nextCardId}`);
    nextCardEl?.classList.add('link-target-hover');
    if (nextSide) {
      nextCardEl?.querySelector(`[data-port-side="${nextSide}"]`)?.classList.add('port-target-hover');
    }
  }
}

function renderEdges() {
  const svg = document.getElementById('nyx-canvas-svg');
  if (!svg) return;

  const OFFSET = 5000;
  const cardMap = new Map(boardCards.map(c => [c.id, c]));
  const markerColors = new Set();
  let pathsMarkup = '';

  if (draggingCardId && activeAlignGuides.length > 0) {
    activeAlignGuides.forEach(g => {
      if (g.type === 'v') {
        const gx = g.x + OFFSET;
        const gy1 = g.y1 + OFFSET;
        const gy2 = g.y2 + OFFSET;
        pathsMarkup += `
          <line x1="${gx}" y1="${gy1}" x2="${gx}" y2="${gy2}" stroke="#a855f7" stroke-width="1.3" stroke-dasharray="4 3" opacity="0.85"></line>
          <circle cx="${gx}" cy="${gy1}" r="3" fill="#a855f7"></circle>
          <circle cx="${gx}" cy="${gy2}" r="3" fill="#a855f7"></circle>
        `;
      } else {
        const gy = g.y + OFFSET;
        const gx1 = g.x1 + OFFSET;
        const gx2 = g.x2 + OFFSET;
        pathsMarkup += `
          <line x1="${gx1}" y1="${gy}" x2="${gx2}" y2="${gy}" stroke="#a855f7" stroke-width="1.3" stroke-dasharray="4 3" opacity="0.85"></line>
          <circle cx="${gx1}" cy="${gy}" r="3" fill="#a855f7"></circle>
          <circle cx="${gx2}" cy="${gy}" r="3" fill="#a855f7"></circle>
        `;
      }
    });
  }

  boardCards.forEach(sourceCard => {
    const conns = Array.isArray(sourceCard.connections) ? sourceCard.connections : [];

    conns.forEach((conn, idx) => {
      if (
        wiringDrag &&
        ((wiringDrag.mode === 'rewire-target' && wiringDrag.sourceId === sourceCard.id && wiringDrag.edgeIndex === idx) ||
         (wiringDrag.mode === 'rewire-source' && wiringDrag.originalSourceId === sourceCard.id && wiringDrag.edgeIndex === idx))
      ) {
        return;
      }

      const targetCard = cardMap.get(conn.to);
      if (!targetCard) return;

      const { p1, p2 } = getEdgeEndpoints(sourceCard, targetCard, conn);
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const c1 = getControlOffset(p1.side, dist);
      const c2 = getControlOffset(p2.side, dist);

      const x1 = p1.x + OFFSET;
      const y1 = p1.y + OFFSET;
      const x2 = p2.x + OFFSET;
      const y2 = p2.y + OFFSET;

      const cx1 = x1 + c1.dx;
      const cy1 = y1 + c1.dy;
      const cx2 = x2 + c2.dx;
      const cy2 = y2 + c2.dy;

      const pathData = `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
      const strokeColor = resolveEdgeColor(conn);
      const lineStyle = resolveEdgeLineStyle(conn);
      const direction = resolveEdgeDirection(conn);

      const colorKey = strokeColor.replace('#', '');
      markerColors.add(strokeColor);

      const markerEndAttr = (direction === 'uni' || direction === 'bi')
        ? `marker-end="url(#nyx-arrow-${colorKey})"`
        : '';
      const markerStartAttr = (direction === 'bi')
        ? `marker-start="url(#nyx-arrow-${colorKey})"`
        : '';

      const midX = (x1 + 3 * cx1 + 3 * cx2 + x2) / 8;
      const midY = (y1 + 3 * cy1 + 3 * cy2 + y2) / 8;

      pathsMarkup += `
        <g class="nyx-edge-group">
          <path d="${pathData}" class="nyx-edge-hit" data-edge-source="${sourceCard.id}" data-edge-idx="${idx}"></path>
          <path d="${pathData}" class="nyx-edge-line" stroke="${strokeColor}"
            ${lineStyle === 'dashed' ? 'stroke-dasharray="7 5"' : ''}
            ${markerStartAttr} ${markerEndAttr}></path>
          <circle cx="${x1}" cy="${y1}" r="4.5" stroke="${strokeColor}" class="nyx-edge-endpoint"
            data-edge-source="${sourceCard.id}" data-edge-idx="${idx}" data-edge-end="source"></circle>
          <circle cx="${x2}" cy="${y2}" r="4.5" stroke="${strokeColor}" class="nyx-edge-endpoint"
            data-edge-source="${sourceCard.id}" data-edge-idx="${idx}" data-edge-end="target"></circle>
          ${conn.label ? `
            <g transform="translate(${midX}, ${midY})" style="pointer-events:none;">
              <rect x="-52" y="-11" width="104" height="20" rx="5" fill="#120407" stroke="${strokeColor}" stroke-width="1"></rect>
              <text x="0" y="3" text-anchor="middle" fill="#f7e7b4" font-size="10" font-family="JetBrains Mono, monospace">${escapeHtml(conn.label.slice(0, 16))}</text>
            </g>
          ` : ''}
        </g>
      `;
    });
  });

  if (wiringDrag) {
    let anchorCoords = null;
    let previewColor = '#D4AF37';
    let isDashedPreview = true;

    if (wiringDrag.mode === 'create') {
      const sourceCard = cardMap.get(wiringDrag.sourceId);
      if (sourceCard) anchorCoords = getPortCoords(sourceCard, wiringDrag.sourceSide);
    } else if (wiringDrag.mode === 'rewire-target') {
      const sourceCard = cardMap.get(wiringDrag.sourceId);
      if (sourceCard) {
        anchorCoords = getPortCoords(sourceCard, wiringDrag.sourceSide);
        previewColor = resolveEdgeColor(wiringDrag.originalEdge);
        isDashedPreview = resolveEdgeLineStyle(wiringDrag.originalEdge) === 'dashed';
      }
    } else if (wiringDrag.mode === 'rewire-source') {
      const targetCard = cardMap.get(wiringDrag.targetId);
      if (targetCard) {
        anchorCoords = getPortCoords(targetCard, wiringDrag.targetSide);
        previewColor = resolveEdgeColor(wiringDrag.originalEdge);
        isDashedPreview = resolveEdgeLineStyle(wiringDrag.originalEdge) === 'dashed';
      }
    }

    if (anchorCoords) {
      let endCoords = { x: pointerWorldPos.x, y: pointerWorldPos.y, side: null };
      if (hoveredTarget) {
        const hoverCard = cardMap.get(hoveredTarget.cardId);
        if (hoverCard) {
          endCoords = getPortCoords(hoverCard, hoveredTarget.side);
        }
      }

      const x1 = anchorCoords.x + OFFSET;
      const y1 = anchorCoords.y + OFFSET;
      const x2 = endCoords.x + OFFSET;
      const y2 = endCoords.y + OFFSET;
      const dist = Math.hypot(x2 - x1, y2 - y1);
      const c1 = getControlOffset(anchorCoords.side, dist);

      let pathD = `M ${x1} ${y1} Q ${x1 + c1.dx} ${y1 + c1.dy}, ${x2} ${y2}`;
      if (endCoords.side) {
        const c2 = getControlOffset(endCoords.side, dist);
        pathD = `M ${x1} ${y1} C ${x1 + c1.dx} ${y1 + c1.dy}, ${x2 + c2.dx} ${y2 + c2.dy}, ${x2} ${y2}`;
      }

      pathsMarkup += `
        <path d="${pathD}" fill="none" stroke="${previewColor}" stroke-width="2.4"
          ${isDashedPreview ? 'stroke-dasharray="6 4"' : ''}></path>
      `;
    }
  }

  const defsMarkup = `
    <defs>
      ${Array.from(markerColors).map(hex => {
        const key = hex.replace('#', '');
        return `
          <marker id="nyx-arrow-${key}" viewBox="0 0 10 10" refX="8" refY="5"
            markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
            <path d="M 1 1.5 L 8.5 5 L 1 8.5 z" fill="${hex}"></path>
          </marker>
        `;
      }).join('')}
    </defs>
  `;

  svg.innerHTML = defsMarkup + pathsMarkup;

  svg.querySelectorAll('.nyx-edge-hit, .nyx-edge-endpoint').forEach(el => {
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();

      const stage = document.getElementById('nyx-canvas-stage');
      if (!stage) return;

      const rect = stage.getBoundingClientRect();
      const wx = (e.clientX - rect.left - camera.x) / camera.zoom;
      const wy = (e.clientY - rect.top - camera.y) / camera.zoom;

      pendingEdgeInteraction = {
        sourceId: el.dataset.edgeSource,
        edgeIndex: Number(el.dataset.edgeIdx),
        forceEnd: el.dataset.edgeEnd || null,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startWorldX: wx,
        startWorldY: wy
      };

      stage.setPointerCapture(e.pointerId);
    });
  });
}

function renderBoardCards() {
  const cardsLayer = document.getElementById('nyx-canvas-cards');
  if (!cardsLayer) return;

  const currentUid = auth.currentUser?.uid || '';
  const masterMode = isMaster();

  cardsLayer.innerHTML = boardCards.map(card => {
    const pin = resolvePinVisual(card.pinColor);
    const canDelete = masterMode || (card.createdByUid && card.createdByUid === currentUid);
    const isTargetHover = hoveredTarget?.cardId === card.id;

    return `
      <div id="board-card-${card.id}"
        data-card-id="${card.id}"
        style="left: ${Math.round(card.x || 0)}px; top: ${Math.round(card.y || 0)}px; border-color: ${pin.border};"
        class="nyx-board-card ${isTargetHover ? 'link-target-hover' : ''}">

        <div class="nyx-port nyx-port-top ${isTargetHover && hoveredTarget?.side === 'top' ? 'port-target-hover' : ''}"
          data-port-card="${card.id}" data-port-side="top" title="Ponto Superior"></div>
        <div class="nyx-port nyx-port-right ${isTargetHover && hoveredTarget?.side === 'right' ? 'port-target-hover' : ''}"
          data-port-card="${card.id}" data-port-side="right" title="Ponto Direito"></div>
        <div class="nyx-port nyx-port-bottom ${isTargetHover && hoveredTarget?.side === 'bottom' ? 'port-target-hover' : ''}"
          data-port-card="${card.id}" data-port-side="bottom" title="Ponto Inferior"></div>
        <div class="nyx-port nyx-port-left ${isTargetHover && hoveredTarget?.side === 'left' ? 'port-target-hover' : ''}"
          data-port-card="${card.id}" data-port-side="left" title="Ponto Esquerdo"></div>
        
        <div class="px-3.5 py-2.5 border-b border-[var(--borda-fina)] flex items-center gap-2 bg-black/30 rounded-t-xl">
          <span class="nyx-board-pin" style="background-color: ${pin.color};" title="${pin.label}"></span>
          <span class="text-xs font-bold text-[var(--dourado-claro)] truncate">${escapeHtml(card.title || 'Anotação de Pista')}</span>
        </div>

        ${card.imageUrl ? `
          <div class="nyx-board-card-media-wrap">
            <img src="${card.imageUrl}" alt="${escapeHtml(card.title || 'Pista')}" class="nyx-board-card-media">
          </div>
        ` : ''}

        <div class="p-3.5 text-xs text-[var(--texto-principal)] leading-relaxed whitespace-pre-line break-words">
          ${renderCardLinkedText(card.content || '')}
        </div>

        <div class="px-3.5 py-2 border-t border-[var(--borda-fina)] bg-black/25 rounded-b-xl flex items-center justify-between gap-2 text-[10px] font-mono-code">
          <span class="text-[var(--texto-mutado)] truncate" title="Registrado por ${escapeHtml(card.createdBy || 'Investigador')}">
            ✒️ ${escapeHtml(card.createdBy || 'Investigador')}
          </span>
          <div class="flex items-center gap-2 shrink-0">
            <button type="button" data-edit-card="${card.id}" class="text-[var(--dourado-claro)] hover:underline">Editar</button>
            ${canDelete ? `<button type="button" data-del-card="${card.id}" class="text-red-400 hover:underline">✕</button>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');

  cardsLayer.querySelectorAll('[data-board-wikilink]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openReaderModal(btn.dataset.boardWikilink);
    });
  });

  cardsLayer.querySelectorAll('[data-board-create-wiki]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditorModal(null, btn.dataset.boardCreateWiki);
    });
  });

  cardsLayer.querySelectorAll('[data-edit-card]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = boardCards.find(c => c.id === btn.dataset.editCard);
      if (card) openBoardCardModal(card);
    });
  });

  cardsLayer.querySelectorAll('[data-del-card]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.delCard;
      if (confirm('Remover esta anotação do quadro de investigação?')) {
        await deleteDoc(doc(db, 'wikis', id));
      }
    });
  });

  cardsLayer.querySelectorAll('.nyx-port').forEach(portEl => {
    portEl.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();

      const stage = document.getElementById('nyx-canvas-stage');
      if (!stage) return;

      wiringDrag = {
        mode: 'create',
        sourceId: portEl.dataset.portCard,
        sourceSide: portEl.dataset.portSide
      };
      updateHoveredTargetVisuals(null);

      const rect = stage.getBoundingClientRect();
      pointerWorldPos = {
        x: (e.clientX - rect.left - camera.x) / camera.zoom,
        y: (e.clientY - rect.top - camera.y) / camera.zoom
      };

      stage.classList.add('connecting-wire');
      stage.setPointerCapture(e.pointerId);
      renderEdges();
    });
  });

  cardsLayer.querySelectorAll('.nyx-board-card').forEach(cardEl => {
    cardEl.addEventListener('dblclick', (e) => {
      if (e.target.closest('button') || e.target.closest('.nyx-port')) return;
      e.stopPropagation();
      const card = boardCards.find(c => c.id === cardEl.dataset.cardId);
      if (card) openBoardCardReaderModal(card);
    });

    cardEl.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button') || e.target.closest('.nyx-port')) return;
      e.stopPropagation();

      const cardId = cardEl.dataset.cardId;
      const card = boardCards.find(c => c.id === cardId);
      if (!card) return;

      draggingCardId = cardId;
      activeAlignGuides = [];
      cardEl.classList.add('dragging');
      cardEl.setPointerCapture(e.pointerId);

      const stage = document.getElementById('nyx-canvas-stage');
      const rect = stage.getBoundingClientRect();
      const wx = (e.clientX - rect.left - camera.x) / camera.zoom;
      const wy = (e.clientY - rect.top - camera.y) / camera.zoom;

      dragOffset = { x: wx - (card.x || 0), y: wy - (card.y || 0) };
      dragCurrentPos = { x: card.x || 0, y: card.y || 0 };
    });

    cardEl.addEventListener('pointermove', (e) => {
      if (draggingCardId !== cardEl.dataset.cardId) return;
      const stage = document.getElementById('nyx-canvas-stage');
      const rect = stage.getBoundingClientRect();
      const wx = (e.clientX - rect.left - camera.x) / camera.zoom;
      const wy = (e.clientY - rect.top - camera.y) / camera.zoom;

      const rawX = Math.round(wx - dragOffset.x);
      const rawY = Math.round(wy - dragOffset.y);

      const aligned = computeSmartAlignment(draggingCardId, rawX, rawY);
      const resolved = resolveCardCollision(draggingCardId, aligned.x, aligned.y);

      activeAlignGuides = aligned.guides.filter(g => {
        const el = document.getElementById(`board-card-${draggingCardId}`);
        const mw = el ? el.offsetWidth : 265;
        const mh = el ? el.offsetHeight : 145;
        if (g.type === 'v') {
          return Math.abs(resolved.x - g.x) < 2 || Math.abs(resolved.x + mw / 2 - g.x) < 2 || Math.abs(resolved.x + mw - g.x) < 2;
        }
        return Math.abs(resolved.y - g.y) < 2 || Math.abs(resolved.y + mh / 2 - g.y) < 2 || Math.abs(resolved.y + mh - g.y) < 2;
      });

      dragCurrentPos = resolved;
      cardEl.style.left = `${resolved.x}px`;
      cardEl.style.top = `${resolved.y}px`;
      renderEdges();
    });

    cardEl.addEventListener('pointerup', async () => {
      if (draggingCardId !== cardEl.dataset.cardId) return;
      const finishedId = draggingCardId;
      const finalX = dragCurrentPos.x;
      const finalY = dragCurrentPos.y;

      draggingCardId = null;
      activeAlignGuides = [];
      cardEl.classList.remove('dragging');
      renderEdges();

      const card = boardCards.find(c => c.id === finishedId);
      if (card && (card.x !== finalX || card.y !== finalY)) {
        card.x = finalX;
        card.y = finalY;
        await updateDoc(doc(db, 'wikis', finishedId), {
          x: finalX,
          y: finalY,
          updatedAt: serverTimestamp()
        });
      }
    });
  });

  requestAnimationFrame(renderEdges);
}

/* Janela Flutuante de Leitura Detalhada da Pista (Duplo Clique) */
function openBoardCardReaderModal(card) {
  const modalRoot = document.getElementById('modal-root');
  const pin = resolvePinVisual(card.pinColor);

  modalRoot.innerHTML = `
    <div class="nyx-modal-backdrop" id="board-reader-backdrop">
      <div class="bg-[var(--bg-surface)] border border-[var(--dourado)] rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        ${card.imageUrl ? `
          <div class="nyx-board-reader-media-wrap">
            <img src="${card.imageUrl}" alt="${escapeHtml(card.title || 'Pista')}" class="nyx-board-reader-media">
          </div>
        ` : ''}

        <div class="p-6 md:p-8">
          <div class="flex items-center justify-between gap-2 mb-3">
            <span class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#120407] border border-[var(--borda-fina)] text-xs font-semibold text-[var(--dourado-claro)]">
              <span class="w-2.5 h-2.5 rounded-full" style="background-color: ${pin.color};"></span>
              ${escapeHtml(pin.label)}
            </span>
            <div class="flex items-center gap-3">
              <button type="button" id="btn-reader-edit-card" class="text-xs text-[var(--dourado-claro)] hover:underline">Editar Pista</button>
              <button type="button" id="close-board-reader" class="text-sm text-[var(--texto-mutado)] hover:text-[var(--dourado)]">✕ Fechar</button>
            </div>
          </div>

          <h2 class="text-2xl md:text-3xl font-bold text-[var(--dourado)] mb-1">${escapeHtml(card.title || 'Anotação de Pista')}</h2>
          <p class="text-xs font-mono-code text-[var(--texto-mutado)] mb-5">✒️ Registrado por ${escapeHtml(card.createdBy || 'Investigador')}</p>

          <div class="text-base text-[var(--texto-principal)] wiki-full-text">${renderCardLinkedText(card.content || '')}</div>
        </div>
      </div>
    </div>
  `;

  modalRoot.querySelectorAll('[data-board-wikilink]').forEach(btn => {
    btn.addEventListener('click', () => openReaderModal(btn.dataset.boardWikilink));
  });

  modalRoot.querySelectorAll('[data-board-create-wiki]').forEach(btn => {
    btn.addEventListener('click', () => openEditorModal(null, btn.dataset.boardCreateWiki));
  });

  document.getElementById('btn-reader-edit-card').addEventListener('click', () => {
    openBoardCardModal(card);
  });

  const close = () => modalRoot.innerHTML = '';
  document.getElementById('close-board-reader').addEventListener('click', close);
  document.getElementById('board-reader-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'board-reader-backdrop') close();
  });
}

async function createConnectionBetweenCards(sourceId, sourceSide, targetId, targetSide) {
  if (!sourceId || !targetId || sourceId === targetId) return;
  const sourceCard = boardCards.find(c => c.id === sourceId);
  if (!sourceCard) return;

  const existing = Array.isArray(sourceCard.connections) ? [...sourceCard.connections] : [];
  if (existing.some(c => c.to === targetId && c.fromSide === sourceSide && c.toSide === targetSide)) {
    return;
  }

  existing.push({
    to: targetId,
    fromSide: sourceSide,
    toSide: targetSide,
    color: '#C62828',
    direction: 'none',
    lineStyle: 'solid',
    label: ''
  });

  await updateDoc(doc(db, 'wikis', sourceId), {
    connections: existing,
    updatedAt: serverTimestamp()
  });
}

/* Janela de Adaptação do Fio ('Adaptar Fio') */
function openEdgeEditorModal(sourceId, edgeIndex) {
  const sourceCard = boardCards.find(c => c.id === sourceId);
  if (!sourceCard || !Array.isArray(sourceCard.connections) || !sourceCard.connections[edgeIndex]) return;

  const edge = sourceCard.connections[edgeIndex];
  let selectedColor = resolveEdgeColor(edge);
  let selectedDirection = resolveEdgeDirection(edge);
  let selectedLineStyle = resolveEdgeLineStyle(edge);

  const modalRoot = document.getElementById('modal-root');

  modalRoot.innerHTML = `
    <div class="nyx-modal-backdrop" id="edge-backdrop">
      <div class="bg-[var(--bg-surface)] border border-[var(--dourado)] rounded-xl max-w-md w-full p-6 shadow-2xl">
        <div class="flex items-center justify-between border-b border-[var(--borda-fina)] pb-3 mb-4">
          <h3 class="text-lg font-bold text-[var(--dourado)]">Adaptar Fio</h3>
          <button id="close-edge-modal" class="text-sm text-[var(--texto-mutado)] hover:text-white">✕</button>
        </div>

        <form id="edge-form" class="space-y-4">
          <div>
            <label class="block text-xs text-[var(--dourado-claro)] mb-2">Cor do Fio</label>
            <div class="flex flex-wrap items-center gap-2">
              ${PALETTE_SWATCHES.map(hex => `
                <button type="button" data-edge-swatch="${hex}"
                  style="background-color: ${hex};"
                  class="w-7 h-7 rounded-full border-2 transition ${selectedColor.toLowerCase() === hex.toLowerCase() ? 'border-white scale-110 shadow-[0_0_10px_rgba(255,255,255,0.5)]' : 'border-black/60 opacity-85 hover:opacity-100'}">
                </button>
              `).join('')}
              <label class="ml-1 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--bg-card)] border border-[var(--borda-fina)] text-[11px] text-[var(--dourado-claro)] cursor-pointer">
                <span>🎨 Paleta</span>
                <input type="color" id="edge-color-picker" value="${selectedColor}" class="w-5 h-5 bg-transparent border-0 cursor-pointer">
              </label>
            </div>
          </div>

          <div>
            <label class="block text-xs text-[var(--dourado-claro)] mb-1.5">Direção da Ligação</label>
            <div class="grid grid-cols-3 gap-2">
              <button type="button" data-edge-dir="none"
                class="py-2 px-2 rounded-lg border text-xs font-semibold transition ${selectedDirection === 'none' ? 'bg-[var(--vinho-escuro)] border-[var(--dourado)] text-[var(--dourado)]' : 'bg-[var(--bg-card)] border-[var(--borda-fina)] text-[var(--texto-mutado)]'}">
                ───<br><span class="text-[10px]">Não direcional</span>
              </button>
              <button type="button" data-edge-dir="uni"
                class="py-2 px-2 rounded-lg border text-xs font-semibold transition ${selectedDirection === 'uni' ? 'bg-[var(--vinho-escuro)] border-[var(--dourado)] text-[var(--dourado)]' : 'bg-[var(--bg-card)] border-[var(--borda-fina)] text-[var(--texto-mutado)]'}">
                ──▶<br><span class="text-[10px]">Unidirecional</span>
              </button>
              <button type="button" data-edge-dir="bi"
                class="py-2 px-2 rounded-lg border text-xs font-semibold transition ${selectedDirection === 'bi' ? 'bg-[var(--vinho-escuro)] border-[var(--dourado)] text-[var(--dourado)]' : 'bg-[var(--bg-card)] border-[var(--borda-fina)] text-[var(--texto-mutado)]'}">
                ◀─▶<br><span class="text-[10px]">Bidirecional</span>
              </button>
            </div>
          </div>

          <div>
            <label class="block text-xs text-[var(--dourado-claro)] mb-1.5">Estilo do Traço</label>
            <div class="grid grid-cols-2 gap-2">
              <button type="button" data-edge-line="solid"
                class="py-2 px-3 rounded-lg border text-xs font-semibold transition ${selectedLineStyle === 'solid' ? 'bg-[var(--vinho-escuro)] border-[var(--dourado)] text-[var(--dourado)]' : 'bg-[var(--bg-card)] border-[var(--borda-fina)] text-[var(--texto-mutado)]'}">
                ━━━━━━ Normal
              </button>
              <button type="button" data-edge-line="dashed"
                class="py-2 px-3 rounded-lg border text-xs font-semibold transition ${selectedLineStyle === 'dashed' ? 'bg-[var(--vinho-escuro)] border-[var(--dourado)] text-[var(--dourado)]' : 'bg-[var(--bg-card)] border-[var(--borda-fina)] text-[var(--texto-mutado)]'}">
                ╌ ╌ ╌ Tracejado
              </button>
            </div>
          </div>

          <div>
            <label class="block text-xs text-[var(--dourado-claro)] mb-1">Etiqueta Curta (Opcional)</label>
            <input type="text" id="edge-label-input" maxlength="16" value="${escapeHtml(edge.label || '')}" placeholder="Ex: Cúmplice, Local..."
              class="w-full bg-[var(--bg-card)] text-[var(--texto-principal)] border border-[var(--borda-fina)] rounded-lg px-3 py-2 text-xs focus:border-[var(--dourado)] focus:outline-none">
          </div>

          <div class="flex items-center justify-between pt-2 border-t border-[var(--borda-fina)]">
            <button type="button" id="btn-delete-edge" class="text-xs text-red-400 hover:underline">Cortar Fio</button>
            <button type="submit" class="px-5 py-2 rounded-lg bg-[var(--vinho-escuro)] hover:bg-[var(--vinho)] border border-[var(--dourado)] text-[var(--dourado-claro)] text-xs font-bold">
              Aplicar
            </button>
          </div>
        </form>
      </div>
    </div>
  `;

  const colorPicker = document.getElementById('edge-color-picker');
  const syncSwatchUI = () => {
    modalRoot.querySelectorAll('[data-edge-swatch]').forEach(btn => {
      const active = btn.dataset.edgeSwatch.toLowerCase() === selectedColor.toLowerCase();
      btn.classList.toggle('border-white', active);
      btn.classList.toggle('scale-110', active);
      btn.classList.toggle('border-black/60', !active);
    });
  };

  modalRoot.querySelectorAll('[data-edge-swatch]').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedColor = btn.dataset.edgeSwatch;
      colorPicker.value = selectedColor;
      syncSwatchUI();
    });
  });

  colorPicker.addEventListener('input', (e) => {
    selectedColor = e.target.value;
    syncSwatchUI();
  });

  modalRoot.querySelectorAll('[data-edge-dir]').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedDirection = btn.dataset.edgeDir;
      modalRoot.querySelectorAll('[data-edge-dir]').forEach(b => {
        const active = b.dataset.edgeDir === selectedDirection;
        b.classList.toggle('bg-[var(--vinho-escuro)]', active);
        b.classList.toggle('border-[var(--dourado)]', active);
        b.classList.toggle('text-[var(--dourado)]', active);
        b.classList.toggle('bg-[var(--bg-card)]', !active);
        b.classList.toggle('border-[var(--borda-fina)]', !active);
        b.classList.toggle('text-[var(--texto-mutado)]', !active);
      });
    });
  });

  modalRoot.querySelectorAll('[data-edge-line]').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedLineStyle = btn.dataset.edgeLine;
      modalRoot.querySelectorAll('[data-edge-line]').forEach(b => {
        const active = b.dataset.edgeLine === selectedLineStyle;
        b.classList.toggle('bg-[var(--vinho-escuro)]', active);
        b.classList.toggle('border-[var(--dourado)]', active);
        b.classList.toggle('text-[var(--dourado)]', active);
        b.classList.toggle('bg-[var(--bg-card)]', !active);
        b.classList.toggle('border-[var(--borda-fina)]', !active);
        b.classList.toggle('text-[var(--texto-mutado)]', !active);
      });
    });
  });

  const close = () => modalRoot.innerHTML = '';
  document.getElementById('close-edge-modal').addEventListener('click', close);
  document.getElementById('edge-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'edge-backdrop') close();
  });

  document.getElementById('btn-delete-edge').addEventListener('click', async () => {
    const updated = sourceCard.connections.filter((_, i) => i !== edgeIndex);
    await updateDoc(doc(db, 'wikis', sourceId), { connections: updated, updatedAt: serverTimestamp() });
    close();
  });

  document.getElementById('edge-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const updated = [...sourceCard.connections];
    updated[edgeIndex] = {
      ...edge,
      to: edge.to,
      color: selectedColor,
      direction: selectedDirection,
      lineStyle: selectedLineStyle,
      label: document.getElementById('edge-label-input').value.trim()
    };
    await updateDoc(doc(db, 'wikis', sourceId), { connections: updated, updatedAt: serverTimestamp() });
    close();
  });
}

/* Janela 'Nova Anotação' / 'Editar Anotação' */
function openBoardCardModal(existing = null, spawnCoords = null) {
  const modalRoot = document.getElementById('modal-root');
  let currentImage = existing?.imageUrl || '';
  let selectedPin = existing?.pinColor || 'gold';
  const initialCustomHex = resolvePinVisual(selectedPin).color;

  modalRoot.innerHTML = `
    <div class="nyx-modal-backdrop" id="board-card-backdrop">
      <div class="bg-[var(--bg-surface)] border border-[var(--dourado)] rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl">
        <div class="flex items-center justify-between border-b border-[var(--borda-fina)] pb-3 mb-4">
          <h3 class="text-lg font-bold text-[var(--dourado)]">${existing ? 'Editar Anotação' : 'Nova Anotação'}</h3>
          <button id="close-board-modal" class="text-sm text-[var(--texto-mutado)] hover:text-white">✕</button>
        </div>

        <form id="board-card-form" class="space-y-4">
          <div>
            <label class="block text-xs text-[var(--dourado-claro)] mb-1">Título</label>
            <input type="text" id="board-card-title" required value="${escapeHtml(existing?.title || '')}" placeholder="Ex: Carta Ensanguentada"
              class="w-full bg-[var(--bg-card)] text-[var(--texto-principal)] border border-[var(--borda-fina)] rounded-lg px-3 py-2 text-sm focus:border-[var(--dourado)] focus:outline-none">
          </div>

          <div>
            <label class="block text-xs text-[var(--dourado-claro)] mb-1.5">Tipo & Cor do Alfinete</label>
            <div class="flex flex-wrap items-center gap-2">
              ${Object.entries(PIN_PRESETS).map(([key, info]) => `
                <button type="button" data-pin-preset="${key}"
                  class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold transition ${
                    selectedPin === key
                      ? 'bg-[var(--vinho-escuro)] border-[var(--dourado)] text-[var(--dourado-claro)]'
                      : 'bg-[var(--bg-card)] border-[var(--borda-fina)] text-[var(--texto-mutado)] hover:text-white'
                  }">
                  <span class="w-3 h-3 rounded-full border border-black/60" style="background-color: ${info.color};"></span>
                  <span>${info.label}</span>
                </button>
              `).join('')}

              <label id="pin-custom-label"
                class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer transition ${
                  !PIN_PRESETS[selectedPin]
                    ? 'bg-[var(--vinho-escuro)] border-[var(--dourado)] text-[var(--dourado-claro)]'
                    : 'bg-[var(--bg-card)] border-[var(--borda-fina)] text-[var(--texto-mutado)] hover:text-white'
                }">
                <span>🎨 Paleta</span>
                <input type="color" id="board-pin-color-picker" value="${initialCustomHex}" class="w-5 h-5 bg-transparent border-0 cursor-pointer">
              </label>
            </div>
          </div>

          <div>
            <label class="block text-xs text-[var(--dourado-claro)] mb-1">Imagem / Evidência (Opcional)</label>
            <div class="flex flex-col sm:flex-row gap-2">
              <input type="file" id="board-card-file" accept="image/*" class="text-xs text-[var(--texto-mutado)] file:mr-2 file:py-1.5 file:px-3 file:rounded file:border file:border-[var(--borda-fina)] file:bg-[var(--bg-card)] file:text-[var(--dourado-claro)]">
              <input type="url" id="board-card-url" value="${currentImage.startsWith('http') ? escapeHtml(currentImage) : ''}" placeholder="Ou cole URL https://..."
                class="flex-1 bg-[var(--bg-card)] text-[var(--texto-principal)] border border-[var(--borda-fina)] rounded-lg px-3 py-1.5 text-xs focus:border-[var(--dourado)] focus:outline-none">
            </div>
            <img id="board-card-preview" src="${currentImage}" class="${currentImage ? '' : 'hidden'} mt-2 max-h-32 rounded border border-[var(--borda-fina)] object-contain bg-[#090204]">
          </div>

          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="text-xs text-[var(--dourado-claro)]">Anotação da Investigação</label>
              <span class="text-[10px] font-mono-code text-[var(--texto-mutado)]">Use <strong class="text-[var(--dourado)]">[[</strong> para vincular Wikis</span>
            </div>
            <textarea id="board-card-content" rows="4" required placeholder="Descreva a pista encontrada ou cite [[Personagens]] e [[Locais]]..."
              class="w-full bg-[var(--bg-card)] text-[var(--texto-principal)] border border-[var(--borda-fina)] rounded-lg p-3 text-sm focus:border-[var(--dourado)] focus:outline-none">${escapeHtml(existing?.content || '')}</textarea>
          </div>

          <div class="flex justify-end gap-3 pt-1">
            <button type="button" id="cancel-board-modal" class="px-4 py-2 rounded-lg text-xs text-[var(--texto-mutado)] hover:text-white">Cancelar</button>
            <button type="submit" id="save-board-card-btn" class="px-5 py-2 rounded-lg bg-[var(--vinho-escuro)] hover:bg-[var(--vinho)] border border-[var(--dourado)] text-[var(--dourado-claro)] font-bold text-sm">
              Fixar no Quadro
            </button>
          </div>
        </form>
      </div>
    </div>
  `;

  attachWikiLinkAutocomplete(document.getElementById('board-card-content'));

  const customLabel = document.getElementById('pin-custom-label');
  const pinColorPicker = document.getElementById('board-pin-color-picker');

  const syncPinButtons = () => {
    const isPreset = Boolean(PIN_PRESETS[selectedPin]);
    modalRoot.querySelectorAll('[data-pin-preset]').forEach(btn => {
      const active = btn.dataset.pinPreset === selectedPin;
      btn.classList.toggle('bg-[var(--vinho-escuro)]', active);
      btn.classList.toggle('border-[var(--dourado)]', active);
      btn.classList.toggle('text-[var(--dourado-claro)]', active);
      btn.classList.toggle('bg-[var(--bg-card)]', !active);
      btn.classList.toggle('border-[var(--borda-fina)]', !active);
      btn.classList.toggle('text-[var(--texto-mutado)]', !active);
    });

    customLabel.classList.toggle('bg-[var(--vinho-escuro)]', !isPreset);
    customLabel.classList.toggle('border-[var(--dourado)]', !isPreset);
    customLabel.classList.toggle('text-[var(--dourado-claro)]', !isPreset);
    customLabel.classList.toggle('bg-[var(--bg-card)]', isPreset);
    customLabel.classList.toggle('border-[var(--borda-fina)]', isPreset);
    customLabel.classList.toggle('text-[var(--texto-mutado)]', isPreset);
  };

  modalRoot.querySelectorAll('[data-pin-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedPin = btn.dataset.pinPreset;
      pinColorPicker.value = PIN_PRESETS[selectedPin].color;
      syncPinButtons();
    });
  });

  pinColorPicker.addEventListener('input', (e) => {
    selectedPin = e.target.value;
    syncPinButtons();
  });

  const previewEl = document.getElementById('board-card-preview');
  const urlInput = document.getElementById('board-card-url');
  const fileInput = document.getElementById('board-card-file');

  urlInput.addEventListener('input', () => {
    currentImage = urlInput.value.trim();
    previewEl.src = currentImage;
    previewEl.classList.toggle('hidden', !currentImage);
  });

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    currentImage = await compressBoardImage(file);
    urlInput.value = '';
    previewEl.src = currentImage;
    previewEl.classList.remove('hidden');
  });

  const close = () => modalRoot.innerHTML = '';
  document.getElementById('close-board-modal').addEventListener('click', close);
  document.getElementById('cancel-board-modal').addEventListener('click', close);

  document.getElementById('board-card-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const saveBtn = document.getElementById('save-board-card-btn');
    saveBtn.disabled = true;
    saveBtn.innerText = 'Salvando...';

    const title = document.getElementById('board-card-title').value.trim();
    const content = document.getElementById('board-card-content').value.trim();

    if (existing) {
      await updateDoc(doc(db, 'wikis', existing.id), {
        title,
        pinColor: selectedPin,
        imageUrl: currentImage,
        content,
        updatedAt: serverTimestamp()
      });
    } else {
      const stage = document.getElementById('nyx-canvas-stage');
      const rect = stage ? stage.getBoundingClientRect() : { width: 800, height: 500 };
      const rawSpawnX = spawnCoords
        ? spawnCoords.x
        : Math.round((rect.width / 2 - camera.x) / camera.zoom - 130);
      const rawSpawnY = spawnCoords
        ? spawnCoords.y
        : Math.round((rect.height / 2 - camera.y) / camera.zoom - 80);

      const safePos = findNonOverlappingSpawn(rawSpawnX, rawSpawnY);

      await addDoc(collection(db, 'wikis'), {
        nyxType: 'canvas_card',
        title,
        pinColor: selectedPin,
        imageUrl: currentImage,
        content,
        x: safePos.x,
        y: safePos.y,
        connections: [],
        createdBy: getCurrentAuthorName(),
        createdByUid: auth.currentUser?.uid || '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }
    close();
  });
}

function setExpandedMode(active) {
  isExpanded = active;
  document.body.classList.toggle('nyx-canvas-fullscreen', isExpanded);

  const wrapper = document.getElementById('nyx-canvas-wrapper');
  const expandBtn = document.getElementById('btn-canvas-expand');

  if (wrapper) wrapper.classList.toggle('expanded', isExpanded);
  if (expandBtn) expandBtn.textContent = isExpanded ? '✕ Voltar ao Normal' : '⛶ Expandir Visão';
}

export function unmountCanvasBoard() {
  setExpandedMode(false);
  pendingEdgeInteraction = null;
  wiringDrag = null;
  updateHoveredTargetVisuals(null);
  draggingCardId = null;
  activeAlignGuides = [];
  isPanning = false;
  if (escapeKeyHandler) {
    document.removeEventListener('keydown', escapeKeyHandler);
    escapeKeyHandler = null;
  }
}

export function mountCanvasBoard(container) {
  unmountCanvasBoard();

  container.innerHTML = `
    <div id="nyx-canvas-wrapper" class="nyx-canvas-wrapper">
      <!-- Barra de Ferramentas do Quadro -->
      <div class="px-4 py-3 border-b border-[var(--borda-fina)] bg-[#120407] flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" id="btn-new-board-card" class="px-4 py-1.5 rounded-lg bg-[var(--vinho-escuro)] hover:bg-[var(--vinho)] border border-[var(--dourado)] text-[var(--dourado-claro)] text-xs font-bold shadow">
            + Nova Anotação
          </button>
          <span class="hidden lg:inline text-[11px] font-mono-code text-[var(--texto-mutado)] ml-1">
            Arraste pontos para ligar • Clique no fio para adaptar ou arraste-o para trocar de etiqueta
          </span>
        </div>

        <div class="flex items-center gap-2">
          <span id="canvas-zoom-label" class="text-[11px] font-mono-code text-[var(--texto-mutado)] px-1">100%</span>
          <button type="button" id="btn-canvas-zoom-in" title="Aproximar" class="px-2.5 py-1 rounded bg-[var(--bg-card)] border border-[var(--borda-fina)] text-xs text-[var(--dourado-claro)]">+</button>
          <button type="button" id="btn-canvas-zoom-out" title="Afastar" class="px-2.5 py-1 rounded bg-[var(--bg-card)] border border-[var(--borda-fina)] text-xs text-[var(--dourado-claro)]">−</button>
          <button type="button" id="btn-canvas-reset" class="px-2.5 py-1 rounded bg-[var(--bg-card)] border border-[var(--borda-fina)] text-xs text-[var(--texto-mutado)] hover:text-white">
            Centralizar
          </button>
          <button type="button" id="btn-canvas-expand" class="px-3 py-1 rounded bg-[#1d070c] border border-[var(--dourado)] text-xs text-[var(--dourado)] font-semibold">
            ⛶ Expandir Visão
          </button>
        </div>
      </div>

      <!-- Palco Infinito -->
      <div id="nyx-canvas-stage" class="nyx-canvas-stage">
        <div id="nyx-canvas-world" class="nyx-canvas-world">
          <svg id="nyx-canvas-svg" class="nyx-canvas-svg"></svg>
          <div id="nyx-canvas-cards"></div>
        </div>
      </div>
    </div>
  `;

  const stage = document.getElementById('nyx-canvas-stage');

  applyCameraTransform();

  document.getElementById('btn-new-board-card').addEventListener('click', () => openBoardCardModal());

  document.getElementById('btn-canvas-zoom-in').addEventListener('click', () => {
    camera.zoom = Math.min(2.2, camera.zoom * 1.15);
    applyCameraTransform();
  });

  document.getElementById('btn-canvas-zoom-out').addEventListener('click', () => {
    camera.zoom = Math.max(0.35, camera.zoom / 1.15);
    applyCameraTransform();
  });

  document.getElementById('btn-canvas-reset').addEventListener('click', () => {
    camera = { x: 120, y: 80, zoom: 1 };
    applyCameraTransform();
  });

  document.getElementById('btn-canvas-expand').addEventListener('click', () => {
    setExpandedMode(!isExpanded);
  });

  escapeKeyHandler = (e) => {
    if (e.key === 'Escape' && isExpanded) {
      const modalRoot = document.getElementById('modal-root');
      if (!modalRoot || modalRoot.innerHTML.trim() === '') {
        setExpandedMode(false);
      }
    }
  };
  document.addEventListener('keydown', escapeKeyHandler);

  // Panning (arrastar o quadro)
  stage.addEventListener('pointerdown', (e) => {
    if (e.target !== stage && e.target.id !== 'nyx-canvas-world') return;
    isPanning = true;
    stage.classList.add('panning');
    panStart = { x: e.clientX - camera.x, y: e.clientY - camera.y };
  });

  stage.addEventListener('pointermove', (e) => {
    const rect = stage.getBoundingClientRect();
    pointerWorldPos = {
      x: (e.clientX - rect.left - camera.x) / camera.zoom,
      y: (e.clientY - rect.top - camera.y) / camera.zoom
    };

    if (pendingEdgeInteraction && !wiringDrag) {
      const moveDist = Math.hypot(
        e.clientX - pendingEdgeInteraction.startClientX,
        e.clientY - pendingEdgeInteraction.startClientY
      );
      if (moveDist >= 6) {
        const srcCard = boardCards.find(c => c.id === pendingEdgeInteraction.sourceId);
        const origEdge = srcCard?.connections?.[pendingEdgeInteraction.edgeIndex];
        const tgtCard = origEdge ? boardCards.find(c => c.id === origEdge.to) : null;

        if (srcCard && tgtCard && origEdge) {
          const { p1, p2 } = getEdgeEndpoints(srcCard, tgtCard, origEdge);
          const d1 = Math.hypot(pendingEdgeInteraction.startWorldX - p1.x, pendingEdgeInteraction.startWorldY - p1.y);
          const d2 = Math.hypot(pendingEdgeInteraction.startWorldX - p2.x, pendingEdgeInteraction.startWorldY - p2.y);

          const dragSourceEnd = pendingEdgeInteraction.forceEnd === 'source' ||
            (!pendingEdgeInteraction.forceEnd && d1 < d2);

          if (dragSourceEnd) {
            wiringDrag = {
              mode: 'rewire-source',
              originalSourceId: srcCard.id,
              edgeIndex: pendingEdgeInteraction.edgeIndex,
              targetId: tgtCard.id,
              targetSide: p2.side,
              originalEdge: { ...origEdge, fromSide: p1.side, toSide: p2.side }
            };
          } else {
            wiringDrag = {
              mode: 'rewire-target',
              sourceId: srcCard.id,
              edgeIndex: pendingEdgeInteraction.edgeIndex,
              sourceSide: p1.side,
              originalEdge: { ...origEdge, fromSide: p1.side, toSide: p2.side }
            };
          }

          stage.classList.add('connecting-wire');
        }
        pendingEdgeInteraction = null;
      }
    }

    if (wiringDrag) {
      const fixedCardId = wiringDrag.mode === 'rewire-source'
        ? wiringDrag.targetId
        : wiringDrag.sourceId;

      let foundTarget = null;

      const hitEl = document.elementFromPoint(e.clientX, e.clientY);
      const portEl = hitEl?.closest('.nyx-port');
      if (portEl && portEl.dataset.portCard !== fixedCardId) {
        foundTarget = {
          cardId: portEl.dataset.portCard,
          side: portEl.dataset.portSide
        };
      }

      if (!foundTarget) {
        for (const card of boardCards) {
          if (card.id === fixedCardId) continue;
          const b = getCardBounds(card);
          if (
            pointerWorldPos.x >= b.x - 14 && pointerWorldPos.x <= b.x + b.w + 14 &&
            pointerWorldPos.y >= b.y - 14 && pointerWorldPos.y <= b.y + b.h + 14
          ) {
            const closest = findClosestPortOnCard(card, pointerWorldPos.x, pointerWorldPos.y);
            foundTarget = { cardId: card.id, side: closest.side };
            break;
          }
        }
      }

      updateHoveredTargetVisuals(foundTarget);
      renderEdges();
      return;
    }

    if (isPanning) {
      camera.x = e.clientX - panStart.x;
      camera.y = e.clientY - panStart.y;
      applyCameraTransform();
    }
  });

  stage.addEventListener('pointerup', async () => {
    if (pendingEdgeInteraction) {
      const { sourceId, edgeIndex } = pendingEdgeInteraction;
      pendingEdgeInteraction = null;
      openEdgeEditorModal(sourceId, edgeIndex);
      return;
    }

    if (wiringDrag) {
      const currentDrag = wiringDrag;
      const dropTarget = hoveredTarget;

      wiringDrag = null;
      updateHoveredTargetVisuals(null);
      stage.classList.remove('connecting-wire');

      if (dropTarget) {
        if (currentDrag.mode === 'create' && dropTarget.cardId !== currentDrag.sourceId) {
          await createConnectionBetweenCards(
            currentDrag.sourceId,
            currentDrag.sourceSide,
            dropTarget.cardId,
            dropTarget.side
          );
        } else if (currentDrag.mode === 'rewire-target' && dropTarget.cardId !== currentDrag.sourceId) {
          const srcCard = boardCards.find(c => c.id === currentDrag.sourceId);
          if (srcCard && Array.isArray(srcCard.connections) && srcCard.connections[currentDrag.edgeIndex]) {
            const updated = [...srcCard.connections];
            updated[currentDrag.edgeIndex] = {
              ...currentDrag.originalEdge,
              to: dropTarget.cardId,
              fromSide: currentDrag.sourceSide,
              toSide: dropTarget.side
            };
            await updateDoc(doc(db, 'wikis', currentDrag.sourceId), {
              connections: updated,
              updatedAt: serverTimestamp()
            });
          }
        } else if (currentDrag.mode === 'rewire-source' && dropTarget.cardId !== currentDrag.targetId) {
          const origSrcCard = boardCards.find(c => c.id === currentDrag.originalSourceId);
          if (origSrcCard && Array.isArray(origSrcCard.connections)) {
            if (dropTarget.cardId === currentDrag.originalSourceId) {
              const updated = [...origSrcCard.connections];
              updated[currentDrag.edgeIndex] = {
                ...currentDrag.originalEdge,
                fromSide: dropTarget.side,
                toSide: currentDrag.targetSide
              };
              await updateDoc(doc(db, 'wikis', currentDrag.originalSourceId), {
                connections: updated,
                updatedAt: serverTimestamp()
              });
            } else {
              const newSrcCard = boardCards.find(c => c.id === dropTarget.cardId);
              if (newSrcCard) {
                const prunedOrig = origSrcCard.connections.filter((_, i) => i !== currentDrag.edgeIndex);
                const nextNewConns = Array.isArray(newSrcCard.connections) ? [...newSrcCard.connections] : [];
                nextNewConns.push({
                  ...currentDrag.originalEdge,
                  to: currentDrag.targetId,
                  fromSide: dropTarget.side,
                  toSide: currentDrag.targetSide
                });

                await updateDoc(doc(db, 'wikis', currentDrag.originalSourceId), {
                  connections: prunedOrig,
                  updatedAt: serverTimestamp()
                });
                await updateDoc(doc(db, 'wikis', dropTarget.cardId), {
                  connections: nextNewConns,
                  updatedAt: serverTimestamp()
                });
              }
            }
          }
        }
      }

      renderEdges();
      return;
    }

    isPanning = false;
    stage.classList.remove('panning');
  });

  // Duplo clique no fundo cria uma nota na posição clicada
  stage.addEventListener('dblclick', (e) => {
    if (e.target !== stage && e.target.id !== 'nyx-canvas-world') return;
    const rect = stage.getBoundingClientRect();
    const wx = Math.round((e.clientX - rect.left - camera.x) / camera.zoom - 130);
    const wy = Math.round((e.clientY - rect.top - camera.y) / camera.zoom - 40);
    openBoardCardModal(null, { x: wx, y: wy });
  });

  // Zoom com a roda do mouse
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.91;
    const nextZoom = Math.min(2.2, Math.max(0.35, camera.zoom * factor));

    const rect = stage.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    camera.x = mx - ((mx - camera.x) / camera.zoom) * nextZoom;
    camera.y = my - ((my - camera.y) / camera.zoom) * nextZoom;
    camera.zoom = nextZoom;
    applyCameraTransform();
  }, { passive: false });

  // Sincronização em tempo real com Firestore
  if (!unsubscribeBoard) {
    unsubscribeBoard = onSnapshot(collection(db, 'wikis'), (snapshot) => {
      boardCards = snapshot.docs
        .filter(d => d.data().nyxType === 'canvas_card')
        .map(d => ({ id: d.id, ...d.data() }));
      if (document.getElementById('nyx-canvas-cards')) {
        renderBoardCards();
      }
    });
  } else {
    renderBoardCards();
  }
}