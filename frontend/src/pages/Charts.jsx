import { useEffect, useRef, useState, useCallback } from 'react'
import { getOHLCV, placeManualTrade, getAlgoPositions } from '../api/index.js'
import {
  computeEMA, computeSMA, computeBollingerBands, computeVWAP,
  computeSuperTrend, computePivotPoints, computeFibonacci,
  computeRSI, computeMACD, computeStochastic,
} from '../utils/indicatorEngine.js'
import {
  addDrawing, removeDrawing, updateDrawingColor,
  pushHistory, undoHistory,
} from '../utils/drawingEngine.js'

const TIMEFRAMES = ['1D', '5D', '1M', '3M', '1Y']
const TF_MAP = { '1D': '1d', '5D': '5d', '1M': '1mo', '3M': '3mo', '1Y': '1y' }

const DRAW_TOOLS = [
  { key: 'cursor',    label: 'Cursor',    shortcut: 'Esc', icon: 'arrow_selector_tool' },
  { key: 'hline',     label: 'H-Line',    shortcut: 'H',   icon: 'horizontal_rule' },
  { key: 'trendline', label: 'Trendline', shortcut: 'T',   icon: 'show_chart' },
  { key: 'rectangle', label: 'Rectangle', shortcut: 'R',   icon: 'rectangle' },
  { key: 'fib',       label: 'Fib Draw',  shortcut: 'F',   icon: 'stacked_line_chart' },
]

// Default stroke colour per drawing tool
const DRAW_COLORS = { hline: '#ffa858', trendline: '#46f1c5', rectangle: '#5588cc', fib: '#9b8cff' }

const IND_DEFS = {
  EMA:        { label: 'EMA',        fields: [{ key: 'period', label: 'Period',    default: 21 }],                                              color: '#ffa858' },
  SMA:        { label: 'SMA',        fields: [{ key: 'period', label: 'Period',    default: 20 }],                                              color: '#d4a800' },
  BB:         { label: 'BB',         fields: [{ key: 'period', label: 'Period',    default: 20 }, { key: 'std', label: 'Std Dev', default: 2 }], color: '#5588cc' },
  VWAP:       { label: 'VWAP',       fields: [],                                                                                                 color: '#ff6b9d' },
  SuperTrend: { label: 'SuperTrend', fields: [{ key: 'period', label: 'Period',    default: 10 }, { key: 'mult', label: 'Mult',   default: 3 }], color: '#00d4aa' },
  Pivot:      { label: 'Pivot',      fields: [],                                                                                                 color: '#c0c6db' },
  Fibonacci:  { label: 'Fibonacci',  fields: [{ key: 'bars',   label: 'Lookback', default: 50 }],                                              color: '#9b8cff' },
  Camarilla:  { label: 'Camarilla',  fields: [],                                                                                                 color: '#ffb85a' },
  RSI: {
    label: 'RSI', color: '#f59e0b', isPanelIndicator: true,
    fields: [
      { key: 'period',  label: 'Period',     default: 14 },
      { key: 'obLevel', label: 'Overbought', default: 70 },
      { key: 'osLevel', label: 'Oversold',   default: 30 },
      { key: 'color',   label: 'Color',      default: '#f59e0b', type: 'color' },
    ],
  },
  MACD: {
    label: 'MACD', color: '#00d4aa', isPanelIndicator: true,
    fields: [
      { key: 'fast',          label: 'Fast',        default: 12 },
      { key: 'slow',          label: 'Slow',        default: 26 },
      { key: 'signal',        label: 'Signal',      default: 9  },
      { key: 'macdColor',     label: 'MACD Line',   default: '#00d4aa', type: 'color' },
      { key: 'signalColor',   label: 'Signal Line', default: '#ff6b9d', type: 'color' },
      { key: 'histBullColor', label: 'Hist Bull',   default: '#00d4aa', type: 'color' },
      { key: 'histBearColor', label: 'Hist Bear',   default: '#ffb4ab', type: 'color' },
    ],
  },
  Stochastic: {
    label: 'Stochastic', color: '#a78bfa', isPanelIndicator: true,
    fields: [
      { key: 'kPeriod', label: 'K Period', default: 14 },
      { key: 'dPeriod', label: 'D Period', default: 3  },
      { key: 'kColor',  label: 'K Color',  default: '#a78bfa', type: 'color' },
      { key: 'dColor',  label: 'D Color',  default: '#f59e0b', type: 'color' },
    ],
  },
}

function labelFor(ind) {
  const def = IND_DEFS[ind.type]
  if (!def || def.fields.length === 0) return def?.label ?? ind.type
  const numericFields = def.fields.filter(f => f.type !== 'color')
  if (numericFields.length === 0) return def.label
  return `${def.label}(${numericFields.map(f => ind.params[f.key] ?? f.default).join(',')})`
}

// ─── Indicator Settings Popup ─────────────────────────────────────────────────
function IndicatorSettingsPopup({ type, onConfirm, onCancel }) {
  const def = IND_DEFS[type]
  const [vals, setVals] = useState(Object.fromEntries(def.fields.map(f => [f.key, f.default])))
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCancel}>
      <div className="bg-[#111c2d] border border-[#2a3548] rounded-lg p-5 w-64 shadow-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="text-sm font-bold text-[#d8e3fb] mb-3 shrink-0">{def.label} Settings</div>
        <div className="overflow-y-auto flex-1 pr-1">
          {def.fields.map(f => (
            <div key={f.key} className="flex items-center justify-between mb-2">
              <label className="text-xs text-[#bacac2]">{f.label}</label>
              {f.type === 'color' ? (
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={vals[f.key] || f.default}
                    onChange={e => setVals(p => ({ ...p, [f.key]: e.target.value }))}
                    className="w-8 h-6 rounded cursor-pointer border border-[#2a3548] bg-transparent"
                  />
                  <span className="text-[10px] font-mono text-[#bacac2]">{vals[f.key] || f.default}</span>
                </div>
              ) : (
                <input
                  type="number" value={vals[f.key]}
                  onChange={e => setVals(p => ({ ...p, [f.key]: parseFloat(e.target.value) || f.default }))}
                  className="w-16 bg-[#0d1829] border border-[#2a3548] rounded px-2 py-0.5 text-xs text-[#d8e3fb] text-right outline-none"
                />
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-4 shrink-0">
          <button onClick={() => onConfirm(vals)}
            className="flex-1 py-2 rounded bg-[#00d4aa]/20 text-[#00d4aa] text-xs font-bold hover:bg-[#00d4aa]/30 transition-colors">
            Add
          </button>
          <button onClick={onCancel}
            className="flex-1 py-2 rounded bg-[#1a2540] text-[#bacac2] text-xs hover:bg-[#2a3548] transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Tools Dropdown ───────────────────────────────────────────────────────────
function ToolsMenu({ onSelectTool, onAddIndicator, onSettingsRequired, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])

  const handleInd = type => {
    if (IND_DEFS[type].fields.length === 0) { onAddIndicator(type, {}); onClose() }
    else { onClose(); onSettingsRequired(type) }
  }

  return (
    <div ref={ref} className="absolute top-full left-0 mt-1 z-40 bg-[#111c2d] border border-[#2a3548] rounded-lg shadow-xl w-44 py-1">
      <div className="px-3 py-1 text-[9px] uppercase tracking-widest text-[#4a5568] font-bold">Drawing Tools</div>
      {DRAW_TOOLS.map(t => (
        <button key={t.key} onClick={() => { onSelectTool(t.key); onClose() }}
          className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-[#1a2540] text-xs text-[#bacac2] hover:text-[#d8e3fb]">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[14px]">{t.icon}</span>
            {t.label}
          </div>
          <span className="text-[10px] text-[#4a5568] font-mono">{t.shortcut}</span>
        </button>
      ))}
      <div className="border-t border-[#1e293b] mt-1 pt-1">
        <div className="px-3 py-1 text-[9px] uppercase tracking-widest text-[#4a5568] font-bold">Indicators</div>
        {['EMA','SMA','BB','VWAP','SuperTrend','RSI','MACD','Stochastic'].map(type => (
          <button key={type} onClick={() => handleInd(type)}
            className="w-full flex items-center px-3 py-1.5 hover:bg-[#1a2540] text-xs text-[#bacac2] hover:text-[#d8e3fb]">
            <span className="w-2 h-2 rounded-full mr-2 flex-shrink-0" style={{ background: IND_DEFS[type].color }} />
            {IND_DEFS[type].label}
          </button>
        ))}
      </div>
      <div className="border-t border-[#1e293b] mt-1 pt-1">
        <div className="px-3 py-1 text-[9px] uppercase tracking-widest text-[#4a5568] font-bold">Levels</div>
        {['Pivot','Fibonacci','Camarilla'].map(type => (
          <button key={type} onClick={() => handleInd(type)}
            className="w-full flex items-center px-3 py-1.5 hover:bg-[#1a2540] text-xs text-[#bacac2] hover:text-[#d8e3fb]">
            <span className="w-2 h-2 rounded-full mr-2 flex-shrink-0" style={{ background: IND_DEFS[type].color }} />
            {IND_DEFS[type].label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Chart + SVG Drawing Overlay ─────────────────────────────────────────────
// drawings, selectedId, onAddDrawing, onSelect, onContextMenu all live in
// the parent Charts component (via drawingEngine.js helpers).
function ManualChart({ ohlcv, indicators, activeTool, drawings, selectedId, onAddDrawing, onSelect, onContextMenu }) {
  const containerRef = useRef(null)
  const svgRef       = useRef(null)
  const chartRef     = useRef(null)
  const seriesRef    = useRef(null)
  const [draft,   setDraft]   = useState(null)
  const [svgSize, setSvgSize] = useState({ w: 800, h: 400 })

  // Chart creation — never re-runs on drawing/selection changes
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const candles = (ohlcv ?? [])
      .filter(r => r.open && r.close)
      .map(r => ({
        time: typeof r.timestamp === 'number' ? r.timestamp : r.timestamp.split(' ')[0],
        open: r.open, high: r.high, low: r.low, close: r.close,
        volume: r.volume ?? 0,
      }))
    if (candles.length === 0) return

    const times  = candles.map(c => c.time)
    const closes = candles.map(c => c.close)
    let chart = null, ro = null, active = true

    import('lightweight-charts').then(({ createChart }) => {
      if (!active || !containerRef.current) return
      container.innerHTML = ''

      chart = createChart(container, {
        width:  container.clientWidth  || 800,
        height: container.clientHeight || 400,
        layout:          { background: { color: '#0d1829' }, textColor: '#bacac2' },
        grid:            { vertLines: { color: '#1a2540' }, horzLines: { color: '#1a2540' } },
        timeScale:       { borderColor: '#2a3548', timeVisible: true },
        rightPriceScale: { borderColor: '#2a3548' },
        crosshair:       { mode: 1 },
      })

      const series = chart.addCandlestickSeries({
        upColor: '#00d4aa', downColor: '#ffb4ab',
        borderUpColor: '#00d4aa', borderDownColor: '#ffb4ab',
        wickUpColor: '#00d4aa', wickDownColor: '#ffb4ab',
      })
      series.setData(candles)
      chartRef.current  = chart
      seriesRef.current = series

      const addLine = (values, color, dashed = false) => {
        const s = chart.addLineSeries({ color, lineWidth: 1.5, lineStyle: dashed ? 2 : 0, priceLineVisible: false, lastValueVisible: false })
        s.setData(values.map((v, i) => v != null ? { time: times[i], value: v } : null).filter(Boolean))
      }
      const addPL = (price, color, title = '') =>
        series.createPriceLine({ price, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title })

      for (const ind of indicators) {
        const p = ind.params
        if      (ind.type === 'EMA')  addLine(computeEMA(closes, p.period || 21), IND_DEFS.EMA.color)
        else if (ind.type === 'SMA')  addLine(computeSMA(closes, p.period || 20), IND_DEFS.SMA.color)
        else if (ind.type === 'BB') {
          const { upper, middle, lower } = computeBollingerBands(closes, p.period || 20, p.std || 2)
          addLine(upper, IND_DEFS.BB.color, true); addLine(middle, IND_DEFS.BB.color); addLine(lower, IND_DEFS.BB.color, true)
        }
        else if (ind.type === 'VWAP') addLine(computeVWAP(candles), IND_DEFS.VWAP.color)
        else if (ind.type === 'SuperTrend') {
          const { values: stv, trend } = computeSuperTrend(candles, p.period || 10, p.mult || 3)
          addLine(stv.map((v, i) => trend[i] ===  1 ? v : null), '#00d4aa')
          addLine(stv.map((v, i) => trend[i] === -1 ? v : null), '#ffb4ab')
        }
        else if (ind.type === 'Pivot' && candles.length >= 2) {
          const c2 = candles[candles.length - 2]
          const pp = computePivotPoints(c2.high, c2.low, c2.close)
          addPL(pp.p,  '#c0c6db', 'P');   addPL(pp.r1, '#00d4aa', 'R1'); addPL(pp.r2, '#46f1c5', 'R2'); addPL(pp.r3, '#a0ffd8', 'R3')
          addPL(pp.s1, '#ffb4ab', 'S1'); addPL(pp.s2, '#ff8888', 'S2'); addPL(pp.s3, '#ff4444', 'S3')
        }
        else if (ind.type === 'Fibonacci') {
          const lb = Math.min(p.bars || 50, candles.length)
          const sl = candles.slice(-lb)
          const hi = Math.max(...sl.map(c => c.high)), lo = Math.min(...sl.map(c => c.low))
          const fib = computeFibonacci(hi, lo)
          addPL(fib.high, '#9b8cff', 'H');     addPL(fib.f236, '#9b8cff', '23.6%')
          addPL(fib.f382, '#9b8cff', '38.2%'); addPL(fib.f500, '#9b8cff', '50%')
          addPL(fib.f618, '#9b8cff', '61.8%'); addPL(fib.f786, '#9b8cff', '78.6%')
          addPL(fib.low,  '#9b8cff', 'L')
        }
        else if (ind.type === 'Camarilla' && candles.length >= 2) {
          const c2 = candles[candles.length - 2]
          const rng = c2.high - c2.low, c = c2.close
          addPL(c + rng*1.1/4,  '#ffb85a', 'CR3'); addPL(c + rng*1.1/6,  '#ffb85a', 'CR2'); addPL(c + rng*1.1/12, '#ffb85a', 'CR1')
          addPL(c - rng*1.1/12, '#ffb85a', 'CS1'); addPL(c - rng*1.1/6,  '#ffb85a', 'CS2'); addPL(c - rng*1.1/4,  '#ffb85a', 'CS3')
        }
      }

      chart.timeScale().fitContent()
      chart.timeScale().subscribeVisibleLogicalRangeChange(() => setSvgSize(s => ({ ...s })))

      ro = new ResizeObserver(() => {
        if (!chart || !containerRef.current) return
        const w = containerRef.current.clientWidth || 800
        const h = containerRef.current.clientHeight || 400
        chart.applyOptions({ width: w, height: h })
        setSvgSize({ w, h })
      })
      ro.observe(container)
      setSvgSize({ w: container.clientWidth || 800, h: container.clientHeight || 400 })
    })

    return () => {
      active = false
      chartRef.current  = null
      seriesRef.current = null
      if (ro) ro.disconnect()
      if (chart) chart.remove()
    }
  }, [ohlcv, indicators])

  // ── SVG coordinate helper ─────────────────────────────────────────────────
  const getPos = e => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  // Convert SVG pixel position → chart time+price (returns null if chart not ready)
  const pixelToChartCoords = (x, y) => {
    const chart  = chartRef.current
    const series = seriesRef.current
    if (!chart || !series) return null
    const time  = chart.timeScale().coordinateToTime(x)
    const price = series.coordinateToPrice(y)
    if (time == null || price == null) return null
    return { time, price }
  }

  // ── Drawing-mode mouse handlers (attached to SVG root when not in cursor mode)
  const onSvgMouseDown = e => {
    if (e.button !== 0) return
    const pos = getPos(e)
    if (activeTool === 'hline') {
      const coords = pixelToChartCoords(pos.x, pos.y)
      onAddDrawing({ id: Date.now(), tool: 'hline', y: pos.y, price: coords?.price, color: DRAW_COLORS.hline })
      return
    }
    if (activeTool === 'trendline') {
      const coords = pixelToChartCoords(pos.x, pos.y)
      const p = { x: pos.x, y: pos.y, ...(coords || {}) }
      setDraft({ tool: 'trendline', p1: p, p2: p })
      return
    }
    setDraft({ tool: activeTool, p1: pos, p2: pos })
  }
  const onSvgMouseMove = e => { if (!draft) return; setDraft(d => ({ ...d, p2: getPos(e) })) }
  const onSvgMouseUp   = e => {
    if (!draft) return
    const pos = getPos(e)
    if (draft.tool === 'trendline') {
      const coords = pixelToChartCoords(pos.x, pos.y)
      onAddDrawing({ id: Date.now(), ...draft, p2: { x: pos.x, y: pos.y, ...(coords || {}) }, color: DRAW_COLORS.trendline })
      setDraft(null)
      return
    }
    onAddDrawing({ id: Date.now(), ...draft, p2: pos, color: DRAW_COLORS[draft.tool] || '#ffffff' })
    setDraft(null)
  }

  // ── Per-drawing cursor-mode handlers ──────────────────────────────────────
  const onDrawingClick = (e, id) => { e.stopPropagation(); onSelect(id) }
  const onDrawingRightClick = (e, id) => {
    e.preventDefault(); e.stopPropagation()
    onSelect(id)
    onContextMenu(e.clientX, e.clientY, id)
  }

  // ── Shape renderer ────────────────────────────────────────────────────────
  // In cursor mode: SVG root has pointer-events:none so the chart handles pan/zoom.
  // Each drawing <g> overrides this with pointer-events:all so only drawing
  // elements are clickable, leaving empty chart area fully interactive.
  const isCursorMode = activeTool === 'cursor'

  const renderShape = (d, key) => {
    const isSel   = d.id === selectedId
    const color   = d.color || DRAW_COLORS[d.tool] || '#ffffff'
    const stroke  = isSel ? '#3b9eff' : color
    const sw      = isSel ? 2.5 : 1.5

    // In cursor mode each drawing captures its own click/right-click.
    // pointer-events:all overrides the inherited 'none' from the SVG root.
    const gProps = isCursorMode ? {
      style:          { pointerEvents: 'all', cursor: 'pointer' },
      onClick:        e => onDrawingClick(e, d.id),
      onContextMenu:  e => onDrawingRightClick(e, d.id),
    } : {}

    if (d.tool === 'hline') {
      const currentY = (seriesRef.current && d.price != null)
        ? (seriesRef.current.priceToCoordinate(d.price) ?? d.y)
        : d.y
      return (
        <g key={key} {...gProps}>
          <line x1={0} y1={currentY} x2={svgSize.w} y2={currentY} stroke="transparent" strokeWidth={16} />
          {isSel && <line x1={0} y1={currentY} x2={svgSize.w} y2={currentY} stroke="#3b9eff" strokeWidth={6} strokeOpacity={0.25} />}
          <line x1={0} y1={currentY} x2={svgSize.w} y2={currentY} stroke={stroke} strokeWidth={sw} strokeDasharray="5 4" />
        </g>
      )
    }

    if (d.tool === 'trendline' && d.p1 && d.p2) {
      let x1 = d.p1.x, y1 = d.p1.y, x2 = d.p2.x, y2 = d.p2.y
      const chart  = chartRef.current
      const series = seriesRef.current
      if (chart && series && d.p1.time != null && d.p2.time != null) {
        x1 = chart.timeScale().timeToCoordinate(d.p1.time) ?? d.p1.x
        y1 = series.priceToCoordinate(d.p1.price)         ?? d.p1.y
        x2 = chart.timeScale().timeToCoordinate(d.p2.time) ?? d.p2.x
        y2 = series.priceToCoordinate(d.p2.price)         ?? d.p2.y
      }
      return (
        <g key={key} {...gProps}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={16} />
          {isSel && <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#3b9eff" strokeWidth={6} strokeOpacity={0.25} />}
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={sw} />
          {isSel && <>
            <circle cx={x1} cy={y1} r={4} fill="#3b9eff" />
            <circle cx={x2} cy={y2} r={4} fill="#3b9eff" />
          </>}
        </g>
      )
    }

    if (d.tool === 'rectangle' && d.p1 && d.p2) {
      const rx = Math.min(d.p1.x, d.p2.x), ry = Math.min(d.p1.y, d.p2.y)
      const rw = Math.abs(d.p2.x - d.p1.x),  rh = Math.abs(d.p2.y - d.p1.y)
      return (
        <g key={key} {...gProps}>
          <rect x={rx} y={ry} width={rw} height={rh} fill="transparent" stroke="transparent" strokeWidth={16} />
          {isSel && <rect x={rx} y={ry} width={rw} height={rh} fill="none" stroke="#3b9eff" strokeWidth={6} strokeOpacity={0.25} />}
          <rect x={rx} y={ry} width={rw} height={rh} fill={color + '12'} stroke={stroke} strokeWidth={sw} />
        </g>
      )
    }

    if (d.tool === 'fib' && d.p1 && d.p2) {
      const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]
      const dy = d.p2.y - d.p1.y
      return (
        <g key={key} {...gProps}>
          {levels.map(l => {
            const ly = d.p1.y + dy * l
            return (
              <g key={l}>
                <line x1={0} y1={ly} x2={svgSize.w} y2={ly} stroke="transparent" strokeWidth={16} />
                {isSel && <line x1={0} y1={ly} x2={svgSize.w} y2={ly} stroke="#3b9eff" strokeWidth={5} strokeOpacity={0.2} />}
                <line x1={0} y1={ly} x2={svgSize.w} y2={ly} stroke={stroke} strokeWidth={0.9} strokeDasharray="3 3" />
                <text x={6} y={ly - 3} fill={stroke} fontSize="9" fontFamily="monospace" opacity={0.85}>{(l * 100).toFixed(1)}%</text>
              </g>
            )
          })}
        </g>
      )
    }

    return null
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* LW chart — fills the container */}
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      {/* SVG drawing layer
          cursor mode  → pointer-events:none on root, each drawing <g> overrides
          drawing mode → pointer-events:all on root captures the whole canvas   */}
      <svg
        ref={svgRef}
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 5,
          pointerEvents: isCursorMode ? 'none' : 'all',
          cursor:        isCursorMode ? 'default' : 'crosshair',
        }}
        onMouseDown={isCursorMode ? undefined : onSvgMouseDown}
        onMouseMove={isCursorMode ? undefined : onSvgMouseMove}
        onMouseUp={isCursorMode   ? undefined : onSvgMouseUp}
      >
        {drawings.map((d, i) => renderShape(d, d.id ?? i))}
        {draft && renderShape(
          { ...draft, id: '__draft__', color: DRAW_COLORS[draft.tool] || '#ffffff' },
          '__draft__'
        )}
      </svg>
    </div>
  )
}

// ─── Trade Panel ──────────────────────────────────────────────────────────────
function TradePanel({ symbol, positions, onTrade, sessionPnl, brokerStatus }) {
  const [side,      setSide]      = useState('BUY')
  const [qty,       setQty]       = useState(1)
  const [orderType, setOrderType] = useState('MARKET')
  const [price,     setPrice]     = useState('')
  const [placing,   setPlacing]   = useState(false)
  const [toast,     setToast]     = useState(null)
  const [mode,      setMode]      = useState(
    () => localStorage.getItem('tradeMode') || 'paper'
  )

  const setTradeMode = m => { setMode(m); localStorage.setItem('tradeMode', m) }

  const submit = async () => {
    setPlacing(true)
    try {
      const payload = {
        symbol,
        side,
        qty: parseInt(qty),
        order_type: orderType,
        price: orderType === 'LIMIT' ? parseFloat(price) : undefined,
        mode,
      }
      await onTrade(payload)
      setToast({ ok: true, msg: `${mode === 'live' ? 'LIVE' : 'PAPER'} ${side} ${qty} ${symbol} placed` })
    } catch (e) {
      setToast({ ok: false, msg: e?.response?.data?.error || 'Trade failed' })
    } finally {
      setPlacing(false)
      setTimeout(() => setToast(null), 4000)
    }
  }

  const liveAvailable = brokerStatus?.live_trading_available ?? false

  return (
    <div className="border-t border-[#1e293b] bg-[#0a0e1a] shrink-0">
      {/* Mode toggle row */}
      <div className="flex items-center gap-2 px-3 pt-2 pb-1 border-b border-[#1e293b] flex-wrap">
        <span className="text-[9px] font-bold uppercase tracking-widest text-[#bacac2]">Mode:</span>
        <div className="flex rounded overflow-hidden border border-[#2a3548]">
          <button
            onClick={() => setTradeMode('paper')}
            className={`px-3 py-1 text-xs font-bold transition-colors ${mode === 'paper' ? 'bg-[#ffa858]/20 text-[#ffa858]' : 'text-[#4a5568] hover:text-[#bacac2]'}`}>
            PAPER
          </button>
          <button
            onClick={() => setTradeMode('live')}
            className={`px-3 py-1 text-xs font-bold transition-colors ${mode === 'live' ? 'bg-[#00d4aa]/20 text-[#00d4aa]' : 'text-[#4a5568] hover:text-[#bacac2]'}`}>
            LIVE
          </button>
        </div>
        {mode === 'paper' && <span className="text-[9px] text-[#ffa858] font-bold">● Simulation Only</span>}
        {mode === 'live'  && <span className="text-[9px] text-[#00d4aa] font-bold">● Live Trading Active</span>}
        <span className={`ml-auto text-xs font-mono font-bold ${sessionPnl >= 0 ? 'text-[#00d4aa]' : 'text-[#ffb4ab]'}`}>
          P&L: {sessionPnl >= 0 ? '+' : ''}₹{sessionPnl.toFixed(0)}
        </span>
        {toast && (
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${toast.ok ? 'bg-[#00d4aa]/10 text-[#00d4aa]' : 'bg-[#ffb4ab]/10 text-[#ffb4ab]'}`}>{toast.msg}</span>
        )}
      </div>
      {/* Live unavailable warning */}
      {mode === 'live' && !liveAvailable && (
        <div className="mx-3 mt-1.5 mb-1 p-2 rounded bg-[#ffb4ab]/10 border border-[#ffb4ab]/30 text-[#ffb4ab] text-[10px]">
          ⚠ Live trading requires Zerodha or Angel One API. Add credentials to .env and set BROKER=zerodha to enable.
        </div>
      )}
      <div className="px-3 pb-2 flex items-center gap-2 flex-wrap">
        <div className="flex rounded overflow-hidden border border-[#2a3548]">
          {['BUY','SELL'].map(s => (
            <button key={s} onClick={() => setSide(s)}
              className={`px-3 py-1 text-xs font-bold transition-colors ${side===s ? (s==='BUY' ? 'bg-[#00d4aa]/20 text-[#00d4aa]' : 'bg-[#ffb4ab]/20 text-[#ffb4ab]') : 'text-[#4a5568] hover:text-[#bacac2]'}`}>
              {s}
            </button>
          ))}
        </div>
        <input type="number" value={qty} onChange={e => setQty(Math.max(1, parseInt(e.target.value)||1))} min="1"
          className="w-16 bg-[#0d1829] border border-[#2a3548] rounded px-2 py-1 text-xs text-[#d8e3fb] outline-none text-center" placeholder="Qty" />
        <div className="flex rounded overflow-hidden border border-[#2a3548]">
          {['MARKET','LIMIT'].map(t => (
            <button key={t} onClick={() => setOrderType(t)}
              className={`px-2 py-1 text-xs transition-colors ${orderType===t ? 'bg-[#2a3548] text-[#d8e3fb]' : 'text-[#4a5568] hover:text-[#bacac2]'}`}>
              {t === 'MARKET' ? 'MKT' : 'LMT'}
            </button>
          ))}
        </div>
        {orderType === 'LIMIT' && (
          <input type="number" value={price} onChange={e => setPrice(e.target.value)}
            className="w-24 bg-[#0d1829] border border-[#2a3548] rounded px-2 py-1 text-xs text-[#d8e3fb] outline-none" placeholder="₹ Price" />
        )}
        <button onClick={submit} disabled={placing}
          className={`px-4 py-1 rounded text-xs font-bold border transition-colors disabled:opacity-40 ${side==='BUY' ? 'bg-[#00d4aa]/15 text-[#00d4aa] border-[#00d4aa]/30 hover:bg-[#00d4aa]/25' : 'bg-[#ffb4ab]/15 text-[#ffb4ab] border-[#ffb4ab]/30 hover:bg-[#ffb4ab]/25'}`}>
          {placing ? '...' : side}
        </button>
      </div>
      {positions.length > 0 && (
        <div className="mx-3 mb-2 border border-[#1e293b] rounded overflow-hidden max-h-24 overflow-y-auto">
          <table className="w-full text-[10px] font-mono">
            <thead>
              <tr className="bg-[#0d1117] text-[#bacac2]">
                <th className="px-2 py-1 text-left">Symbol</th>
                <th className="px-2 py-1 text-left">Side</th>
                <th className="px-2 py-1 text-right">Qty</th>
                <th className="px-2 py-1 text-right">Entry</th>
                <th className="px-2 py-1 text-right">P&L</th>
              </tr>
            </thead>
            <tbody>
              {positions.map(p => (
                <tr key={p.id} className="border-t border-[#1e293b] hover:bg-[#111c2d]">
                  <td className="px-2 py-1 text-[#d8e3fb]">{p.symbol}</td>
                  <td className="px-2 py-1" style={{ color: p.side==='LONG'||p.side==='BUY' ? '#00d4aa' : '#ffb4ab' }}>{p.side}</td>
                  <td className="px-2 py-1 text-right text-[#d8e3fb]">{p.qty}</td>
                  <td className="px-2 py-1 text-right text-[#d8e3fb]">{p.entry_price?.toFixed(2)}</td>
                  <td className={`px-2 py-1 text-right font-bold ${(p.pnl||0)>=0 ? 'text-[#00d4aa]' : 'text-[#ffb4ab]'}`}>
                    {(p.pnl||0)>=0?'+':''}{(p.pnl||0).toFixed(0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Right-click Context Menu ─────────────────────────────────────────────────
function DrawingContextMenu({ x, y, onDelete, onChangeColor, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-[#111c2d] border border-[#2a3548] rounded-lg shadow-xl py-1 w-38 min-w-[140px]"
      style={{ top: y, left: x }}
    >
      <button onClick={onDelete}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[#ffb4ab] hover:bg-[#1a2540] text-left">
        <span className="material-symbols-outlined text-[13px]">delete</span>Delete
      </button>
      <button onClick={onChangeColor}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[#bacac2] hover:bg-[#1a2540] text-left">
        <span className="material-symbols-outlined text-[13px]">palette</span>Change Color
      </button>
    </div>
  )
}

// ─── Oscillator Sub-Panel ────────────────────────────────────────────────────
// Renders RSI, MACD, or Stochastic in a 120 px lightweight-charts panel.
function SubPanel({ ind, ohlcv, onRemove }) {
  const containerRef = useRef(null)
  const def = IND_DEFS[ind.type]
  const p   = ind.params

  useEffect(() => {
    const container = containerRef.current
    if (!container || !ohlcv?.length) return

    const candles = (ohlcv ?? []).filter(r => r.close)
    const closes  = candles.map(r => r.close)
    const times   = candles.map(r =>
      typeof r.timestamp === 'number' ? r.timestamp : r.timestamp.split(' ')[0]
    )

    let chart = null, ro = null, active = true

    import('lightweight-charts').then(({ createChart }) => {
      if (!active || !containerRef.current) return
      container.innerHTML = ''

      chart = createChart(container, {
        width:  container.clientWidth || 800,
        height: 120,
        layout:          { background: { color: '#080f1e' }, textColor: '#bacac2', fontSize: 10 },
        grid:            { vertLines: { color: '#1a2540' }, horzLines: { color: '#1a2540' } },
        timeScale:       { borderColor: '#2a3548', timeVisible: true },
        rightPriceScale: { borderColor: '#2a3548' },
        crosshair:       { mode: 1 },
        handleScroll:    true,
        handleScale:     true,
      })

      const addLine = (values, color, lineWidth = 1.5) => {
        const s = chart.addLineSeries({ color, lineWidth, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: true })
        s.setData(values.map((v, i) => v != null ? { time: times[i], value: +v.toFixed(3) } : null).filter(Boolean))
        return s
      }
      const addHLevel = (value, color) => {
        const s = chart.addLineSeries({ color, lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false })
        s.setData(times.map(t => ({ time: t, value })))
      }

      if (ind.type === 'RSI') {
        const rsi = computeRSI(closes, p.period || 14)
        addLine(rsi, p.color || '#f59e0b', 1.5)
        addHLevel(p.obLevel || 70, 'rgba(255,180,171,0.5)')
        addHLevel(p.osLevel || 30, 'rgba(0,212,170,0.5)')
      }

      else if (ind.type === 'MACD') {
        const { macdLine, signalLine: sigShort, hist, offset } = computeMACD(
          closes, p.fast || 12, p.slow || 26, p.signal || 9
        )
        // Pad signalLine and hist to align with full closes/times array
        const pad          = new Array(offset).fill(null)
        const signalPadded = pad.concat(sigShort)
        const histPadded   = pad.concat(hist)

        const histSeries = chart.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false })
        histSeries.setData(
          histPadded
            .map((v, i) => v != null ? {
              time:  times[i],
              value: v,
              color: v >= 0 ? (p.histBullColor || '#00d4aa') : (p.histBearColor || '#ffb4ab'),
            } : null)
            .filter(Boolean)
        )
        addLine(macdLine,     p.macdColor   || '#00d4aa', 1.5)
        addLine(signalPadded, p.signalColor || '#ff6b9d', 1)
      }

      else if (ind.type === 'Stochastic') {
        const { kLine, dLine } = computeStochastic(candles, p.kPeriod || 14, p.dPeriod || 3)
        addLine(kLine, p.kColor || '#a78bfa', 1.5)
        addLine(dLine, p.dColor || '#f59e0b', 1)
        addHLevel(80, 'rgba(255,180,171,0.4)')
        addHLevel(20, 'rgba(0,212,170,0.4)')
      }

      chart.timeScale().fitContent()

      ro = new ResizeObserver(() => {
        if (chart && containerRef.current) {
          chart.applyOptions({ width: containerRef.current.clientWidth || 800 })
        }
      })
      ro.observe(container)
    })

    return () => {
      active = false
      if (ro)    ro.disconnect()
      if (chart) chart.remove()
    }
  }, [ohlcv, ind])

  const label = ind.type === 'RSI'
    ? `RSI(${p.period || 14})`
    : ind.type === 'MACD'
    ? `MACD(${p.fast || 12},${p.slow || 26},${p.signal || 9})`
    : `Stoch(${p.kPeriod || 14},${p.dPeriod || 3})`

  return (
    <div className="shrink-0 border-t border-[#1e293b] bg-[#080f1e]">
      <div className="flex items-center justify-between px-3 py-1 border-b border-[#1e293b]">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: def?.color || '#bacac2' }} />
          <span className="text-[10px] font-bold text-[#bacac2] uppercase tracking-wide">{label}</span>
        </div>
        <button onClick={onRemove} className="text-[#4a5568] hover:text-[#ffb4ab] text-xs leading-none transition-colors">×</button>
      </div>
      <div ref={containerRef} style={{ height: '120px' }} />
    </div>
  )
}

// ─── Main Charts Page ─────────────────────────────────────────────────────────
export default function Charts() {
  const [symbol,    setSymbol]    = useState(() => localStorage.getItem('charts_symbol') || '')
  const [inputVal,  setInputVal]  = useState(() => localStorage.getItem('charts_symbol') || '')
  const [timeframe, setTimeframe] = useState(() => localStorage.getItem('charts_tf')     || '3M')
  const [ohlcv,     setOhlcv]     = useState([])
  const [loading,   setLoading]   = useState(true)

  const [showToolsMenu,  setShowToolsMenu]  = useState(false)
  const [activeTool,     setActiveTool]     = useState('cursor')
  const [pendingIndType, setPendingIndType] = useState(null)
  const [indicators, setIndicators] = useState(() => {
    try {
      const saved = localStorage.getItem('charts_indicators')
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })

  // ── Drawing state (managed via drawingEngine.js) ────────────────────────
  const [drawings,   setDrawings]   = useState([])
  const [history,    setHistory]    = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [contextMenu, setContextMenu] = useState(null)   // { x, y, drawingId }
  const [pendingColorId, setPendingColorId] = useState(null)
  const [saveToast, setSaveToast] = useState('')
  const colorInputRef = useRef(null)

  // Stable refs so keyboard handler callbacks stay stable across renders
  const drawingsRef   = useRef([])
  const selectedIdRef = useRef(null)
  useEffect(() => { drawingsRef.current   = drawings   }, [drawings])
  useEffect(() => { selectedIdRef.current = selectedId }, [selectedId])

  // Persist indicators to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem('charts_indicators', JSON.stringify(indicators))
    } catch {}
  }, [indicators])

  // ── Drawings persistence ──────────────────────────────────────────────────
  const saveDrawingsForSymbol = useCallback((sym, list) => {
    if (!sym) return
    try { localStorage.setItem(`finolens_drawings_${sym}`, JSON.stringify(list)) } catch {}
  }, [])

  // Load saved drawings and restore saved indicators whenever the active symbol changes
  useEffect(() => {
    if (!symbol) { setDrawings([]); return }
    try {
      const savedDrawings = localStorage.getItem(`finolens_drawings_${symbol}`)
      setDrawings(savedDrawings ? JSON.parse(savedDrawings) : [])

      // Restore saved indicators for this symbol
      const analyses = JSON.parse(localStorage.getItem('finolens_saved_analyses') || '{}')
      if (analyses[symbol]?.indicators?.length > 0 &&
          Array.isArray(analyses[symbol].indicators) &&
          typeof analyses[symbol].indicators[0] === 'object') {
        setIndicators(analyses[symbol].indicators)
        setSaveToast(`Restored saved analysis for ${symbol}`)
        setTimeout(() => setSaveToast(''), 3000)
      }
    } catch { setDrawings([]) }
    setHistory([])
    setSelectedId(null)
  }, [symbol])

  // ── Drawing mutations ─────────────────────────────────────────────────────
  const handleAddDrawing = useCallback(drawing => {
    setHistory(h => pushHistory(h, drawingsRef.current))
    setDrawings(d => {
      const updated = addDrawing(d, drawing)
      saveDrawingsForSymbol(symbol, updated)
      return updated
    })
    setSelectedId(null)
  }, [symbol, saveDrawingsForSymbol])

  const handleUndo = useCallback(() => {
    setHistory(h => {
      const result = undoHistory(h)
      if (!result) return h
      setDrawings(result.prev)
      setSelectedId(null)
      return result.newHistory
    })
  }, [])

  const handleDeleteDrawing = useCallback(id => {
    setHistory(h => pushHistory(h, drawingsRef.current))
    setDrawings(d => {
      const updated = removeDrawing(d, id)
      saveDrawingsForSymbol(symbol, updated)
      return updated
    })
    setSelectedId(null)
  }, [symbol, saveDrawingsForSymbol])

  const handleClearAll = useCallback(() => {
    if (drawingsRef.current.length === 0) return
    setHistory(h => pushHistory(h, drawingsRef.current))
    setDrawings([])
    saveDrawingsForSymbol(symbol, [])
    setSelectedId(null)
  }, [symbol, saveDrawingsForSymbol])

  // ── Keyboard shortcuts (stable handler via refs) ──────────────────────────
  useEffect(() => {
    const handler = e => {
      if (e.target.tagName === 'INPUT') return

      // Undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        handleUndo()
        return
      }

      // Delete selected drawing
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIdRef.current) {
        e.preventDefault()
        handleDeleteDrawing(selectedIdRef.current)
        return
      }

      // Escape → deselect + back to cursor
      if (e.key === 'Escape') {
        setSelectedId(null)
        setActiveTool('cursor')
        setContextMenu(null)
        return
      }

      // Drawing tool shortcuts
      const toolMap = { h:'hline', H:'hline', t:'trendline', T:'trendline', r:'rectangle', R:'rectangle', f:'fib', F:'fib' }
      if (toolMap[e.key]) { setActiveTool(toolMap[e.key]); setSelectedId(null) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleUndo, handleDeleteDrawing])

  // ── Positions & trading ───────────────────────────────────────────────────
  const [positions,    setPositions]    = useState([])
  const [sessionPnl,   setSessionPnl]   = useState(0)
  const [brokerStatus, setBrokerStatus] = useState({ broker: 'yfinance', live_trading_available: false })

  const load = useCallback(async () => {
    if (!symbol) { setLoading(false); setOhlcv([]); return }
    setLoading(true)
    try {
      const res = await getOHLCV(symbol, TF_MAP[timeframe])
      setOhlcv(res.data ?? [])
    } catch { setOhlcv([]) }
    finally { setLoading(false) }
  }, [symbol, timeframe])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    getAlgoPositions()
      .then(r => setPositions((r.data ?? []).filter(p => p.strategy_id === 'manual')))
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('http://localhost:5000/api/broker/status')
      .then(r => r.json())
      .then(setBrokerStatus)
      .catch(() => {})
  }, [])

  const applySymbol = () => {
    const s = inputVal.trim().toUpperCase()
    if (s && s !== symbol) {
      localStorage.setItem('charts_symbol', s)
      setSymbol(s)
    }
  }

  const saveAnalysis = () => {
    if (!symbol) return
    saveDrawingsForSymbol(symbol, drawings)
    try {
      const saved = JSON.parse(localStorage.getItem('finolens_saved_analyses') || '{}')
      saved[symbol] = {
        savedAt: new Date().toISOString(),
        drawingCount: drawings.length,
        indicators: indicators,  // full objects so they can be restored exactly
        indicatorSummary: indicators.map(i =>
          i.type === 'EMA'
            ? `EMA(${i.params.period})`
            : i.type === 'BB'
            ? `BB(${i.params.period},${i.params.std})`
            : i.type
        ),
        timeframe,
      }
      localStorage.setItem('finolens_saved_analyses', JSON.stringify(saved))
    } catch {}
    setSaveToast(`Analysis saved for ${symbol}`)
    setTimeout(() => setSaveToast(''), 3000)
  }

  const handleTfChange = (tf) => {
    localStorage.setItem('charts_tf', tf)
    setTimeframe(tf)
  }

  const addIndicator    = (type, params) => setIndicators(prev => [...prev, { id: Date.now(), type, params }])
  const removeIndicator = id             => setIndicators(prev => prev.filter(ind => ind.id !== id))

  const handleTrade = async data => {
    const res = await placeManualTrade(data)
    const pos = res.data
    setPositions(prev => [...prev, pos])
    return pos
  }

  const activeToolDef = DRAW_TOOLS.find(t => t.key === activeTool)

  return (
    <main className="h-[calc(100vh-7rem)] flex flex-col overflow-hidden bg-[#081425]">
      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#1e293b] bg-[#0a0e1a] flex-wrap shrink-0">
        {/* Symbol input */}
        <div className="flex items-center gap-1 bg-[#111c2d] border border-[#2a3548] rounded px-2 py-1 focus-within:border-[#00d4aa] transition-colors">
          <input
            value={inputVal}
            onChange={e => setInputVal(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && applySymbol()}
            className="bg-transparent outline-none font-mono text-sm text-[#d8e3fb] w-24 uppercase"
          />
          <button onClick={applySymbol} className="text-[#bacac2] hover:text-[#00d4aa]">
            <span className="material-symbols-outlined text-[14px]">search</span>
          </button>
        </div>

        {/* Timeframes */}
        <div className="flex gap-1">
          {TIMEFRAMES.map(tf => (
            <button key={tf} onClick={() => handleTfChange(tf)}
              className={`px-2.5 py-1 rounded font-mono text-xs transition-colors ${timeframe===tf ? 'bg-[#2a3548] text-[#00d4aa] border border-[#3b4a44]' : 'text-[#bacac2] hover:text-[#d8e3fb] hover:bg-[#1a2540]'}`}>
              {tf}
            </button>
          ))}
        </div>

        {/* Tools dropdown */}
        <div className="relative">
          <button onClick={() => setShowToolsMenu(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-bold border transition-colors ${showToolsMenu ? 'bg-[#2a3548] text-[#d8e3fb] border-[#3b4a44]' : 'text-[#bacac2] border-[#2a3548] hover:text-[#d8e3fb] hover:bg-[#1a2540]'}`}>
            <span className="material-symbols-outlined text-[14px]">construction</span>
            Tools
          </button>
          {showToolsMenu && (
            <ToolsMenu
              onSelectTool={t => setActiveTool(t)}
              onAddIndicator={addIndicator}
              onSettingsRequired={type => setPendingIndType(type)}
              onClose={() => setShowToolsMenu(false)}
            />
          )}
        </div>

        {/* Undo button — shown when there's history */}
        {history.length > 0 && (
          <button onClick={handleUndo} title="Undo (Ctrl+Z)"
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-[#bacac2] border border-[#2a3548] hover:text-[#d8e3fb] hover:bg-[#1a2540] transition-colors">
            <span className="material-symbols-outlined text-[13px]">undo</span>
          </button>
        )}

        {/* Clear drawings */}
        {drawings.length > 0 && (
          <button onClick={handleClearAll}
            className="px-2 py-1 rounded text-[10px] text-[#4a5568] border border-[#2a3548] hover:text-[#bacac2] hover:bg-[#1a2540] transition-colors">
            Clear
          </button>
        )}

        {/* Save Analysis */}
        {symbol && (
          <button
            onClick={saveAnalysis}
            className="flex items-center gap-1.5 px-3 py-1 rounded text-xs font-bold border border-[#00d4aa]/40 text-[#00d4aa] bg-[#00d4aa]/10 hover:bg-[#00d4aa]/20 transition-colors"
          >
            <span className="material-symbols-outlined text-[13px]">bookmark</span>
            Save Analysis
          </button>
        )}

        {/* Saved drawings count indicator */}
        {symbol && drawings.length > 0 && (
          <span className="flex items-center gap-1 text-[9px] text-[#00d4aa]/70">
            <span className="material-symbols-outlined text-[10px]">draw</span>
            {drawings.length} drawing{drawings.length !== 1 ? 's' : ''}
          </span>
        )}

        {/* Active drawing tool badge */}
        {activeTool !== 'cursor' && (
          <div className="flex items-center gap-1 px-2 py-0.5 rounded border border-[#00d4aa]/40 bg-[#00d4aa]/10 text-[10px] text-[#00d4aa] font-bold">
            <span className="material-symbols-outlined text-[12px]">draw</span>
            {activeToolDef?.label}
            <button onClick={() => setActiveTool('cursor')} className="ml-1 text-[#4a5568] hover:text-[#bacac2] leading-none">✕</button>
          </div>
        )}

        {/* Selected drawing badge */}
        {selectedId && activeTool === 'cursor' && (
          <div className="flex items-center gap-1 px-2 py-0.5 rounded border border-[#3b9eff]/40 bg-[#3b9eff]/10 text-[10px] text-[#3b9eff] font-bold">
            <span className="material-symbols-outlined text-[12px]">select_all</span>
            Selected · Del to remove
            <button onClick={() => setSelectedId(null)} className="ml-1 text-[#4a5568] hover:text-[#bacac2] leading-none">✕</button>
          </div>
        )}

        {/* Indicator chips */}
        <div className="flex items-center gap-1 flex-wrap">
          {indicators.map(ind => {
            const chipColor = ind.params?.color || ind.params?.macdColor || ind.params?.kColor || IND_DEFS[ind.type]?.color || '#bacac2'
            return (
              <span key={ind.id} className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border"
                style={{ color: chipColor, borderColor: chipColor + '44', background: chipColor + '12' }}>
                {labelFor(ind)}
                <button onClick={() => removeIndicator(ind.id)} className="opacity-60 hover:opacity-100 leading-none text-[11px]">×</button>
              </span>
            )
          })}
        </div>
      </div>

      {/* ── Chart ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 relative min-h-0">
        {!symbol ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#081425]">
            <span className="material-symbols-outlined text-[56px] text-[#2a3548]">candlestick_chart</span>
            <p className="text-[#bacac2] text-sm">Enter a symbol above or select from Home</p>
          </div>
        ) : loading ? (
          <div className="absolute inset-0 m-2 animate-pulse bg-[#1f2a3c] rounded" />
        ) : (
          <ManualChart
            ohlcv={ohlcv}
            indicators={indicators}
            activeTool={activeTool}
            drawings={drawings}
            selectedId={selectedId}
            onAddDrawing={handleAddDrawing}
            onSelect={setSelectedId}
            onContextMenu={(x, y, id) => setContextMenu({ x, y, drawingId: id })}
          />
        )}
      </div>

      {/* ── Sub-panels: RSI / MACD / Stochastic ─────────────────────────────── */}
      {indicators.some(i => IND_DEFS[i.type]?.isPanelIndicator) && (
        <div className="shrink-0 overflow-y-auto" style={{ maxHeight: '360px' }}>
          {indicators.filter(i => IND_DEFS[i.type]?.isPanelIndicator).map(ind => (
            <SubPanel key={ind.id} ind={ind} ohlcv={ohlcv} onRemove={() => removeIndicator(ind.id)} />
          ))}
        </div>
      )}

      {/* ── Trade Panel ──────────────────────────────────────────────────────── */}
      <TradePanel symbol={symbol} positions={positions} onTrade={handleTrade} sessionPnl={sessionPnl} brokerStatus={brokerStatus} />

      {/* ── Right-click context menu ─────────────────────────────────────────── */}
      {contextMenu && (
        <DrawingContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onDelete={() => { handleDeleteDrawing(contextMenu.drawingId); setContextMenu(null) }}
          onChangeColor={() => {
            setPendingColorId(contextMenu.drawingId)
            setContextMenu(null)
            // Tiny delay so the menu is gone before browser opens color picker
            setTimeout(() => colorInputRef.current?.click(), 50)
          }}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* ── Hidden color input ───────────────────────────────────────────────── */}
      <input
        ref={colorInputRef}
        type="color"
        defaultValue="#ffa858"
        style={{ position: 'fixed', opacity: 0, pointerEvents: 'none', width: 0, height: 0, top: 0, left: 0 }}
        onChange={e => {
          if (!pendingColorId) return
          setDrawings(d => updateDrawingColor(d, pendingColorId, e.target.value))
          setPendingColorId(null)
        }}
      />

      {/* ── Save analysis toast ─────────────────────────────────────────────── */}
      {saveToast && (
        <div className="fixed top-20 right-4 z-50 bg-[#00d4aa] text-[#005643] px-4 py-2 rounded-lg text-sm font-bold shadow-xl flex items-center gap-2">
          <span className="material-symbols-outlined text-[16px]">check_circle</span>
          {saveToast} — Go to Watchlist to see it.
        </div>
      )}

      {/* ── Indicator Settings Modal ─────────────────────────────────────────── */}
      {pendingIndType && (
        <IndicatorSettingsPopup
          type={pendingIndType}
          onConfirm={vals => { addIndicator(pendingIndType, vals); setPendingIndType(null) }}
          onCancel={() => setPendingIndType(null)}
        />
      )}
    </main>
  )
}
