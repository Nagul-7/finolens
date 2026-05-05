import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip,
  ReferenceLine, ComposedChart, Bar,
} from 'recharts'
import { getQuote, getCalls, getSignals, getOHLCV, addToWatchlist } from '../api/index.js'
import {
  computeEMA, computeBollingerBands, computeVWAP, computeRSI, computeMACD,
  buildRSIMarkers, buildMACDMarkers, buildBBMarkers,
  buildVolumeSpikeMarkers, buildEMACrossMarkers, buildSuperTrendMarkers,
} from '../utils/indicatorEngine.js'

const INTERVALS = ['5M', '15M', '1D', '1W', '1M']
const INTERVAL_MAP = { '5M': '5m', '15M': '15m', '1D': '1d', '1W': '1wk', '1M': '1mo' }
const OVERLAYS = [
  { key: 'rsi',  label: 'RSI zones' },
  { key: 'macd', label: 'MACD cross' },
  { key: 'bb',   label: 'BB touch' },
  { key: 'vol',  label: 'Vol spike' },
  { key: 'ema',  label: 'EMA cross' },
  { key: 'st',   label: 'SuperTrend' },
]

function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-[#1f2a3c] rounded ${className}`} />
}

function ScoreBar({ label, score }) {
  const color = score >= 60 ? '#00d4aa' : score >= 40 ? '#ffa858' : '#ffb4ab'
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between items-center text-xs">
        <span className="text-[#c0c6db]">{label}</span>
        <span className="font-mono" style={{ color }}>{Math.round(score)}/100</span>
      </div>
      <div className="w-full bg-[#2a3548] rounded-full h-1.5">
        <div className="h-1.5 rounded-full transition-all"
          style={{ width: `${Math.min(100, Math.max(0, score))}%`, background: color }} />
      </div>
    </div>
  )
}

function LevelRow({ label, value, color, bold, dimmed }) {
  if (!value) return null
  return (
    <div className={`flex justify-between items-center py-1 border-b border-[#1e293b]/60 ${dimmed ? 'opacity-50' : ''}`}>
      <span className={`text-[10px] font-bold uppercase ${bold ? '' : 'text-[#bacac2]'}`}
        style={bold ? { color } : {}}>
        {label}
      </span>
      <span className="font-mono text-xs" style={{ color: color || '#d8e3fb' }}>
        ₹{value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
      </span>
    </div>
  )
}

// SuperTrend line split into green/red segments for chart overlay
function computeSuperTrendLines(candles, period = 10, mult = 3) {
  if (candles.length < period + 5) return { greenValues: [], redValues: [] }
  const n = candles.length
  const atr = new Array(n).fill(0)
  for (let i = 1; i < n; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low  - candles[i - 1].close)
    )
    atr[i] = i < period ? tr : (atr[i - 1] * (period - 1) + tr) / period
  }
  const upper = new Array(n).fill(0)
  const lower = new Array(n).fill(0)
  const st    = new Array(n).fill(0)
  for (let i = 1; i < n; i++) {
    const hl2 = (candles[i].high + candles[i].low) / 2
    const bu = hl2 + mult * atr[i]
    const bl = hl2 - mult * atr[i]
    upper[i] = (bu < upper[i - 1] || candles[i - 1].close > upper[i - 1]) ? bu : upper[i - 1]
    lower[i] = (bl > lower[i - 1] || candles[i - 1].close < lower[i - 1]) ? bl : lower[i - 1]
    if (st[i - 1] === upper[i - 1]) {
      st[i] = candles[i].close > upper[i] ? lower[i] : upper[i]
    } else {
      st[i] = candles[i].close < lower[i] ? upper[i] : lower[i]
    }
  }
  return {
    greenValues: st.map((v, i) => (candles[i].close > v ? v : null)),
    redValues:   st.map((v, i) => (candles[i].close <= v ? v : null)),
  }
}

// ─── Main candlestick chart with overlays ────────────────────────────────────
function MainChart({ ohlcv, interval, emaPeriod, showBB, showVWAP, showST, overlays }) {
  const containerRef = useRef(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container || !ohlcv.length) return

    const isIntraday = interval === '5M' || interval === '15M'
    const candles = ohlcv
      .filter(r => r.open && r.close)
      .map(r => ({
        time: isIntraday
          ? Math.floor(new Date(r.timestamp.replace(' ', 'T')).getTime() / 1000)
          : r.timestamp.split(' ')[0],
        open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume ?? 0,
      }))
    if (!candles.length) return

    const times  = candles.map(c => c.time)
    const closes = candles.map(c => c.close)
    const vols   = candles.map(c => c.volume)

    let chart = null, ro = null, active = true

    import('lightweight-charts').then(({ createChart }) => {
      if (!active || !containerRef.current) return
      container.innerHTML = ''

      chart = createChart(container, {
        width:  container.clientWidth  || 700,
        height: container.clientHeight || 480,
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

      const addLine = (values, color, dashed = false, width = 1.5) => {
        const s = chart.addLineSeries({
          color, lineWidth: width, lineStyle: dashed ? 2 : 0,
          priceLineVisible: false, lastValueVisible: false,
        })
        s.setData(values.map((v, i) => v != null ? { time: times[i], value: v } : null).filter(Boolean))
      }

      if (emaPeriod > 0)  addLine(computeEMA(closes, emaPeriod), '#ffa858')
      if (showVWAP)        addLine(computeVWAP(candles), '#ff6b9d')
      if (showBB) {
        const { upper, middle, lower } = computeBollingerBands(closes, 20, 2)
        addLine(upper, '#5588cc', true)
        addLine(middle, '#5588cc', false, 1)
        addLine(lower, '#5588cc', true)
      }
      if (showST) {
        const { greenValues, redValues } = computeSuperTrendLines(candles)
        addLine(greenValues, '#00d4aa', false, 2)
        addLine(redValues,   '#ffb4ab', false, 2)
      }

      // Signal markers — clean arrows, no text labels
      const markers = []
      if (overlays.rsi)  markers.push(...buildRSIMarkers(times, closes, 14, false))
      if (overlays.macd) markers.push(...buildMACDMarkers(times, closes, false))
      if (overlays.bb)   markers.push(...buildBBMarkers(times, closes, 20, false))
      if (overlays.vol)  markers.push(...buildVolumeSpikeMarkers(times, vols, false))
      if (overlays.ema)  markers.push(...buildEMACrossMarkers(times, closes, 9, 21, false))
      if (overlays.st)   markers.push(...buildSuperTrendMarkers(candles, false))
      markers.sort((a, b) => (a.time < b.time ? -1 : 1))
      if (markers.length) series.setMarkers(markers)

      chart.timeScale().fitContent()

      ro = new ResizeObserver(() => {
        if (chart && containerRef.current) {
          chart.applyOptions({
            width:  containerRef.current.clientWidth  || 700,
            height: containerRef.current.clientHeight || 480,
          })
        }
      })
      ro.observe(container)
    })

    return () => {
      active = false
      if (ro)    ro.disconnect()
      if (chart) chart.remove()
    }
  }, [ohlcv, interval, emaPeriod, showBB, showVWAP, showST, overlays])

  return <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function Intelligence() {
  const { symbol = 'RELIANCE' } = useParams()
  const navigate = useNavigate()
  const [activeInterval, setActiveInterval] = useState('1D')

  const [quote,    setQuote]    = useState(null)
  const [callData, setCallData] = useState(null)
  const [signals,  setSignals]  = useState(null)
  const [ohlcv,    setOhlcv]    = useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const [watchToast, setWatchToast] = useState('')

  const [emaPeriod, setEmaPeriod] = useState(21)
  const [showBB,    setShowBB]    = useState(false)
  const [showVWAP,  setShowVWAP]  = useState(true)
  const [showST,    setShowST]    = useState(true)
  const [overlays,  setOverlays]  = useState({ rsi: true, macd: true, bb: false, vol: true, ema: false, st: true })

  const toggleOverlay = key => setOverlays(p => ({ ...p, [key]: !p[key] }))

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [qRes, cRes, sRes, oRes] = await Promise.all([
        getQuote(symbol).catch(() => null),
        getCalls(symbol).catch(() => null),
        getSignals(symbol).catch(() => null),
        getOHLCV(symbol, INTERVAL_MAP[activeInterval]).catch(() => ({ data: [] })),
      ])
      setQuote(qRes?.data ?? null)
      setCallData(cRes?.data ?? null)
      setSignals(sRes?.data ?? null)
      setOhlcv(Array.isArray(oRes?.data) ? oRes.data : [])
    } catch {
      setError('Failed to load data for ' + symbol)
    } finally {
      setLoading(false)
    }
  }, [symbol, activeInterval])

  useEffect(() => { load() }, [load])

  // Derived data for sub-panels
  const closes  = ohlcv.map(r => r.close).filter(Boolean)
  const labels  = ohlcv.map(r => r.timestamp?.split(' ')[0] ?? '').slice(-30)
  const rsiVals = computeRSI(closes)
  const rsiData = rsiVals.slice(-30).map((v, i) => ({ t: labels[i] ?? i, v: v != null ? +v.toFixed(2) : null }))
  const lastRSI = rsiVals.filter(v => v != null).at(-1) ?? null

  const { macdLine, signalLine, hist, offset } = closes.length > 30
    ? computeMACD(closes)
    : { macdLine: [], signalLine: [], hist: [], offset: 0 }
  const macdLabels = ohlcv.slice(offset).map(r => r.timestamp?.split(' ')[0] ?? '').slice(-30)
  const macdData = hist.slice(-30).map((h, i) => ({
    t: macdLabels[i] ?? i,
    macd:   +(macdLine[macdLine.length - hist.length + (hist.length - Math.min(30, hist.length)) + i] ?? 0).toFixed(3),
    signal: +(signalLine[Math.max(0, signalLine.length - Math.min(30, hist.length)) + i] ?? 0).toFixed(3),
    hist:   +h.toFixed(3),
  }))
  const lastMACD = hist.filter(v => v != null).at(-1) ?? null

  const handleAddWatchlist = async () => {
    try {
      await addToWatchlist(symbol)
      setWatchToast('Added!')
      setTimeout(() => setWatchToast(''), 2500)
    } catch {
      setWatchToast('Already in watchlist')
      setTimeout(() => setWatchToast(''), 2500)
    }
  }

  const ltp       = quote?.ltp ?? callData?.current_price ?? 0
  const change    = quote?.change ?? 0
  const changePct = quote?.change_pct ?? 0
  const call      = callData?.call ?? '—'
  const conf      = callData?.confidence ?? 0
  const entry     = callData?.entry ?? ltp
  const sl        = callData?.stop_loss ?? 0
  const target    = callData?.target ?? 0
  const callColor = (call === 'BUY' || call === 'STRONG BUY') ? '#00d4aa'
                  : (call === 'SELL' || call === 'STRONG SELL') ? '#ffb4ab' : '#ffa858'

  const s = signals ?? {}
  const cmp = ltp || s.current_price || 0
  const scoreItems = [
    { label: 'Technical Score', score: s.technical_score ?? 0 },
    { label: 'RSI Zone',        score: s.rsi != null ? Math.round(100 - Math.abs(s.rsi - 50) * 2) : 50 },
    { label: 'MACD Momentum',   score: s.macd_hist != null ? Math.min(100, Math.max(0, 50 + s.macd_hist * 20)) : 50 },
    { label: 'Volume Strength', score: s.volume_ratio != null ? Math.min(100, Math.round(s.volume_ratio * 40)) : 40 },
    { label: 'BB Position',     score: s.bb_position != null ? Math.round(100 - Math.abs(s.bb_position - 50) * 1.5) : 50 },
  ]

  return (
    <main className="w-full">
      {/* Header */}
      <div className="px-4 py-3 md:px-6 bg-[#081425] border-b border-[#1e293b] flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            {loading ? <Skeleton className="w-32 h-7" /> : (
              <>
                <h1 className="text-xl font-semibold text-[#d8e3fb]">{symbol}</h1>
                <span className="text-sm text-[#c0c6db]">{callData?.name ?? quote?.name ?? ''}</span>
              </>
            )}
          </div>
          {loading ? <Skeleton className="w-48 h-9 mt-1" /> : (
            <div className="flex items-end gap-3">
              <span className="text-[28px] font-bold text-[#d8e3fb] leading-none">
                ₹{ltp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </span>
              <span className={`font-mono text-sm flex items-center mb-0.5 ${change >= 0 ? 'text-[#00d4aa]' : 'text-[#ffb4ab]'}`}>
                <span className="material-symbols-outlined text-sm">{change >= 0 ? 'arrow_upward' : 'arrow_downward'}</span>
                {Math.abs(change).toFixed(2)} ({changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%)
              </span>
            </div>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          <div className="relative">
            <button onClick={handleAddWatchlist}
              className="bg-[#1f2a3c] border border-[#3b4a44] hover:bg-[#2f3a4c] text-[#d8e3fb] px-3 py-1.5 rounded text-[11px] font-bold uppercase tracking-wide transition-colors">
              + WATCHLIST
            </button>
            {watchToast && <div className="absolute -bottom-5 left-0 text-[10px] text-[#00d4aa] whitespace-nowrap">{watchToast}</div>}
          </div>
          <button onClick={() => navigate('/algo')}
            className="bg-[#1f2a3c] border border-[#3b4a44] hover:bg-[#2f3a4c] text-[#d8e3fb] px-3 py-1.5 rounded text-[11px] font-bold uppercase tracking-wide transition-colors">
            ALGO STRATEGY
          </button>
          <button onClick={() => navigate('/charts')}
            className="bg-[#00d4aa] hover:bg-[#46f1c5] text-[#005643] px-4 py-1.5 rounded text-[11px] font-bold uppercase tracking-wide transition-colors">
            MANUAL CHART
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-3 p-3 bg-[#ffb4ab]/10 border border-[#ffb4ab]/30 rounded text-[#ffb4ab] text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={load} className="text-xs underline">Retry</button>
        </div>
      )}

      <div className="p-4 md:p-5 grid grid-cols-1 xl:grid-cols-12 gap-4">

        {/* ── LEFT: chart column ── */}
        <div className="xl:col-span-8 flex flex-col gap-3">

          {/* Main chart card */}
          <div className="bg-[#111c2d] border border-[#3b4a44] rounded flex flex-col">
            {/* Timeframe row */}
            <div className="flex items-center justify-between p-2 border-b border-[#3b4a44] bg-[#0d1117] flex-wrap gap-2">
              <div className="flex gap-1">
                {INTERVALS.map(iv => (
                  <button key={iv} onClick={() => setActiveInterval(iv)}
                    className={`px-2.5 py-1 rounded font-mono text-xs transition-colors ${activeInterval === iv
                      ? 'bg-[#2a3548] text-[#00d4aa] border border-[#3b4a44]'
                      : 'text-[#bacac2] hover:text-[#d8e3fb] hover:bg-[#1a2540]'}`}>
                    {iv}
                  </button>
                ))}
              </div>
              {/* Overlay indicator pills */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <button onClick={() => setShowST(v => !v)}
                  className={`px-2 py-0.5 rounded text-[9px] font-bold border transition-colors ${showST
                    ? 'border-[#00d4aa]/60 bg-[#00d4aa]/10 text-[#00d4aa]' : 'border-[#2a3548] text-[#4a5568]'}`}>
                  ST(10,3)
                </button>
                <button onClick={() => setShowVWAP(v => !v)}
                  className={`px-2 py-0.5 rounded text-[9px] font-bold border transition-colors ${showVWAP
                    ? 'border-[#ff6b9d]/60 bg-[#ff6b9d]/10 text-[#ff6b9d]' : 'border-[#2a3548] text-[#4a5568]'}`}>
                  VWAP
                </button>
                <button onClick={() => setShowBB(v => !v)}
                  className={`px-2 py-0.5 rounded text-[9px] font-bold border transition-colors ${showBB
                    ? 'border-[#5588cc]/60 bg-[#5588cc]/10 text-[#5588cc]' : 'border-[#2a3548] text-[#4a5568]'}`}>
                  BB(20)
                </button>
                <div className="flex items-center gap-1 border border-[#ffa858]/40 bg-[#ffa858]/8 rounded px-1.5 py-0.5">
                  <span className="text-[9px] text-[#ffa858] font-bold">EMA</span>
                  <input type="number" min="5" max="200" value={emaPeriod}
                    onChange={e => setEmaPeriod(Math.max(5, Math.min(200, +e.target.value)))}
                    className="w-8 bg-transparent text-[#ffa858] font-mono text-[9px] outline-none text-right" />
                </div>
              </div>
            </div>

            {/* Signal overlay toggles */}
            <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-[#3b4a44] bg-[#080f1e] flex-wrap">
              <span className="text-[9px] text-[#bacac2] uppercase font-bold mr-1">Signals on chart:</span>
              {OVERLAYS.map(ov => (
                <button key={ov.key} onClick={() => toggleOverlay(ov.key)}
                  className={`px-2 py-0.5 rounded text-[9px] font-bold border transition-colors ${
                    overlays[ov.key]
                      ? 'bg-[#00d4aa]/10 border-[#00d4aa]/40 text-[#00d4aa]'
                      : 'border-[#2a3548] text-[#4a5568]'
                  }`}>
                  {ov.label}
                </button>
              ))}
            </div>

            {/* Chart */}
            <div className="relative" style={{ height: '480px' }}>
              {loading
                ? <Skeleton className="absolute inset-0 m-2" />
                : <MainChart ohlcv={ohlcv} interval={activeInterval}
                    emaPeriod={emaPeriod} showBB={showBB} showVWAP={showVWAP}
                    showST={showST} overlays={overlays} />
              }
            </div>
          </div>

          {/* RSI + MACD sub-panels */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-[#111c2d] border border-[#3b4a44] rounded p-3 flex flex-col" style={{ height: 160 }}>
              <div className="flex justify-between items-center mb-2">
                <span className="text-[10px] font-bold uppercase text-[#d8e3fb]">RSI (14)</span>
                <span className={`font-mono text-xs font-bold ${
                  lastRSI != null ? (lastRSI > 70 ? 'text-[#ffb4ab]' : lastRSI < 30 ? 'text-[#00d4aa]' : 'text-[#d8e3fb]') : 'text-[#bacac2]'
                }`}>
                  {lastRSI != null ? lastRSI.toFixed(1) : (s.rsi?.toFixed(1) ?? '—')}
                </span>
              </div>
              <div className="flex-1">
                {loading ? <Skeleton className="h-full" /> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={rsiData}>
                      <XAxis dataKey="t" tick={{ fill: '#bacac2', fontSize: 8 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                      <YAxis domain={[0, 100]} tick={{ fill: '#bacac2', fontSize: 9 }} axisLine={false} tickLine={false} width={22} />
                      <ReferenceLine y={70} stroke="#ffb4ab" strokeDasharray="3 3" strokeOpacity={0.6} />
                      <ReferenceLine y={30} stroke="#00d4aa" strokeDasharray="3 3" strokeOpacity={0.6} />
                      <Tooltip contentStyle={{ background: '#1f2a3c', border: '1px solid #3b4a44', color: '#d8e3fb', fontSize: 11 }}
                        formatter={v => [v?.toFixed(2), 'RSI']} />
                      <Line type="monotone" dataKey="v" stroke="#00d4aa" dot={false} strokeWidth={1.5} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="bg-[#111c2d] border border-[#3b4a44] rounded p-3 flex flex-col" style={{ height: 160 }}>
              <div className="flex justify-between items-center mb-2">
                <span className="text-[10px] font-bold uppercase text-[#d8e3fb]">MACD (12,26,9)</span>
                <span className={`font-mono text-xs font-bold ${
                  lastMACD != null ? (lastMACD > 0 ? 'text-[#00d4aa]' : 'text-[#ffb4ab]') : 'text-[#bacac2]'
                }`}>
                  {lastMACD != null ? lastMACD.toFixed(3) : (s.macd_hist?.toFixed(3) ?? '—')}
                </span>
              </div>
              <div className="flex-1">
                {loading ? <Skeleton className="h-full" /> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={macdData}>
                      <XAxis dataKey="t" tick={{ fill: '#bacac2', fontSize: 8 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                      <YAxis tick={{ fill: '#bacac2', fontSize: 9 }} axisLine={false} tickLine={false} width={30} />
                      <ReferenceLine y={0} stroke="#3b4a44" />
                      <Tooltip contentStyle={{ background: '#1f2a3c', border: '1px solid #3b4a44', color: '#d8e3fb', fontSize: 11 }} />
                      <Bar dataKey="hist" fill="#00d4aa" opacity={0.5} />
                      <Line type="monotone" dataKey="macd"   stroke="#00d4aa" dot={false} strokeWidth={1.5} />
                      <Line type="monotone" dataKey="signal" stroke="#c0c6db" dot={false} strokeWidth={1} />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── RIGHT: signal panel ── */}
        <div className="xl:col-span-4 flex flex-col gap-3">

          {/* Algorithmic Signal */}
          <div className="bg-[#111c2d] border border-[#3b4a44] rounded p-4 flex flex-col items-center text-center">
            <span className="text-[9px] font-bold uppercase tracking-widest text-[#bacac2] mb-2">Algorithmic Signal</span>
            {loading ? <Skeleton className="w-28 h-8 mb-2" /> : (
              <>
                <span className="text-2xl font-bold mb-1" style={{ color: callColor }}>{call}</span>
                <div className="text-xs text-[#d8e3fb] font-mono mb-3">{conf}% Confidence</div>
                {call !== '—' && (
                  <div className="grid grid-cols-3 gap-2 w-full text-left">
                    {[
                      { l: 'Entry',  v: entry,  c: '#d8e3fb' },
                      { l: 'Target', v: target, c: '#00d4aa' },
                      { l: 'SL',     v: sl,     c: '#ffb4ab' },
                    ].map(({ l, v, c }) => (
                      <div key={l} className="bg-[#2a3548] p-2 rounded">
                        <div className="text-[9px] uppercase text-[#bacac2]">{l}</div>
                        <div className="font-mono text-xs" style={{ color: c }}>₹{(v || 0).toLocaleString('en-IN')}</div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Score breakdown */}
          <div className="bg-[#111c2d] border border-[#3b4a44] rounded p-4">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#d8e3fb] border-b border-[#3b4a44] pb-2 mb-3">
              Signal Score Breakdown
            </h3>
            <div className="flex flex-col gap-3">
              {loading
                ? [...Array(5)].map((_, i) => <Skeleton key={i} className="h-5" />)
                : scoreItems.map(item => <ScoreBar key={item.label} label={item.label} score={item.score} />)
              }
            </div>
          </div>

          {/* Key Levels: Pivot */}
          <div className="bg-[#111c2d] border border-[#3b4a44] rounded p-4">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#d8e3fb] border-b border-[#3b4a44] pb-2 mb-2">
              Key Levels
            </h3>
            {loading ? <Skeleton className="h-40" /> : (
              <div className="flex flex-col">
                <LevelRow label="Resistance"  value={s.resistance}  color="#ffb4ab" />
                <LevelRow label="Pivot R3"    value={s.pivot_r3}    color="#ffb4ab" dimmed />
                <LevelRow label="Pivot R2"    value={s.pivot_r2}    color="#ffa858" dimmed />
                <LevelRow label="Pivot R1"    value={s.pivot_r1}    color="#ffa858" />
                <LevelRow label="Pivot"       value={s.pivot}       color="#d4a800" bold />
                {cmp > 0 && (
                  <div className="flex justify-between items-center py-1.5 border-b border-[#1e293b]/60 bg-[#00d4aa]/5 -mx-1 px-1 rounded my-0.5">
                    <span className="text-[10px] font-bold text-[#00d4aa] uppercase">▶ CMP</span>
                    <span className="font-mono text-sm font-bold text-[#00d4aa]">
                      ₹{cmp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
                <LevelRow label="VWAP"        value={s.vwap}        color="#ff6b9d" bold />
                <LevelRow label="Pivot S1"    value={s.pivot_s1}    color="#46f1c5" />
                <LevelRow label="Pivot S2"    value={s.pivot_s2}    color="#46f1c5" dimmed />
                <LevelRow label="Pivot S3"    value={s.pivot_s3}    color="#46f1c5" dimmed />
                <LevelRow label="Support"     value={s.support}     color="#00d4aa" />
              </div>
            )}
          </div>

          {/* Camarilla */}
          {!loading && (s.cam_r1 ?? 0) > 0 && (
            <div className="bg-[#111c2d] border border-[#3b4a44] rounded p-4">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#d8e3fb] border-b border-[#3b4a44] pb-2 mb-2">
                Camarilla
              </h3>
              <div className="flex flex-col">
                <LevelRow label="R3" value={s.cam_r3} color="#ffb4ab" />
                <LevelRow label="R2" value={s.cam_r2} color="#ffa858" dimmed />
                <LevelRow label="R1" value={s.cam_r1} color="#ffa858" dimmed />
                {cmp > 0 && (
                  <div className="flex justify-between items-center py-1 border-b border-[#1e293b]/60">
                    <span className="text-[10px] text-[#00d4aa] font-bold uppercase">CMP</span>
                    <span className="font-mono text-xs text-[#00d4aa]">
                      ₹{cmp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
                <LevelRow label="S1" value={s.cam_s1} color="#46f1c5" dimmed />
                <LevelRow label="S2" value={s.cam_s2} color="#46f1c5" dimmed />
                <LevelRow label="S3" value={s.cam_s3} color="#00d4aa" />
              </div>
            </div>
          )}

          {/* Fibonacci */}
          {!loading && (s.fib_high ?? 0) > 0 && (
            <div className="bg-[#111c2d] border border-[#3b4a44] rounded p-4">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#d8e3fb] border-b border-[#3b4a44] pb-2 mb-2">
                Fibonacci Retracement
              </h3>
              <div className="text-[9px] text-[#bacac2] mb-2">
                High ₹{s.fib_high?.toLocaleString('en-IN')} · Low ₹{s.fib_low?.toLocaleString('en-IN')}
              </div>
              <div className="flex flex-col">
                <LevelRow label="0% (High)" value={s.fib_high} color="#ffb4ab" />
                <LevelRow label="23.6%"     value={s.fib_236}  color="#ffa858" />
                <LevelRow label="38.2%"     value={s.fib_382}  color="#d4a800" />
                <LevelRow label="50.0%"     value={s.fib_500}  color="#c0c6db" bold />
                <LevelRow label="61.8%"     value={s.fib_618}  color="#46f1c5" />
                <LevelRow label="78.6%"     value={s.fib_786}  color="#46f1c5" dimmed />
                <LevelRow label="100% (Low)" value={s.fib_low} color="#00d4aa" />
              </div>
            </div>
          )}

        </div>
      </div>
    </main>
  )
}
