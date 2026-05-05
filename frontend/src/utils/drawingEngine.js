// ─── Drawing Engine ───────────────────────────────────────────────────────────
// Pure utility functions for managing SVG chart drawings.
// No React state lives here — all functions are stateless and testable.

const HIT_PX = 8   // pixels from stroke centre that counts as a hit

// Euclidean distance from point P to line segment AB
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(px - ax, py - ay)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

// ─── Hit testing ─────────────────────────────────────────────────────────────
export function hitTestDrawing(d, x, y) {
  if (d.tool === 'hline') {
    return Math.abs(y - d.y) <= HIT_PX
  }
  if (d.tool === 'trendline' && d.p1 && d.p2) {
    return distToSegment(x, y, d.p1.x, d.p1.y, d.p2.x, d.p2.y) <= HIT_PX
  }
  if (d.tool === 'rectangle' && d.p1 && d.p2) {
    const x1 = Math.min(d.p1.x, d.p2.x), x2 = Math.max(d.p1.x, d.p2.x)
    const y1 = Math.min(d.p1.y, d.p2.y), y2 = Math.max(d.p1.y, d.p2.y)
    const onTop    = Math.abs(y - y1) <= HIT_PX && x >= x1 - HIT_PX && x <= x2 + HIT_PX
    const onBottom = Math.abs(y - y2) <= HIT_PX && x >= x1 - HIT_PX && x <= x2 + HIT_PX
    const onLeft   = Math.abs(x - x1) <= HIT_PX && y >= y1 - HIT_PX && y <= y2 + HIT_PX
    const onRight  = Math.abs(x - x2) <= HIT_PX && y >= y1 - HIT_PX && y <= y2 + HIT_PX
    return onTop || onBottom || onLeft || onRight
  }
  if (d.tool === 'fib' && d.p1 && d.p2) {
    const dy = d.p2.y - d.p1.y
    return [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]
      .some(l => Math.abs(y - (d.p1.y + dy * l)) <= HIT_PX)
  }
  return false
}

// ─── Immutable state operations ───────────────────────────────────────────────
export const addDrawing = (drawings, drawing) => [...drawings, drawing]

export const removeDrawing = (drawings, id) => drawings.filter(d => d.id !== id)

export const updateDrawingColor = (drawings, id, color) =>
  drawings.map(d => d.id === id ? { ...d, color } : d)

// ─── Undo history (max 20 snapshots) ─────────────────────────────────────────
export const pushHistory = (history, snapshot) =>
  [...history, snapshot].slice(-20)

// Returns { prev, newHistory } or null if nothing to undo
export function undoHistory(history) {
  if (history.length === 0) return null
  return {
    prev:       history[history.length - 1],
    newHistory: history.slice(0, -1),
  }
}
