import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip,
  ReferenceLine, ComposedChart, Bar
} from 'recharts'
import { getQuote, getCalls, getSignals, getOHLCV, addToWatchlist } from '../api/index.js'

const INTERVALS = ['5M', '15M', '1D', '1W', '1M']
const INTERVAL_MAP = { '5M': '5m', '15M': '15m', '1D': '1d', '1W': '1wk', '1M': '1mo' }

function computeRSI(closes, period = 14) {
  if (closes.length < period + 1) return []
  let avgGain = 0, avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1]
    if (d > 0) avgGain += d; else avgLoss -= d
  }
  avgGain /= period; avgLoss /= period
  const out = new Array(period).fill(null)
  out.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss))
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    avgGain = (avgGain * (period - 1) + Math.max(0, d)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -d)) / period
    out.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss))
  }
  return out
}

function computeEMA(data, period) {
  const k = 2 / (period + 1)
  let ema = data[0]
  return data.map(v => { ema = v * k + ema * (1 - k); return ema })
}

function computeMACD(closes, fast = 12, slow = 26, signal = 9) {
  const emaFast = computeEMA(closes, fast)
  const emaSlow = computeEMA(closes, slow)
  const macdLine = closes.map((_, i) => emaFast[i] - emaSlow[i])
  const signalOffset = slow - 1
  const sigLine = computeEMA(macdLine.slice(signalOffset), signal)
  const hist = sigLine.map((v, i) => macdLine[i + signalOffset] - v)
  return { macdLine, sigLine, hist, offset: signalOffset }
}

function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-[#1f2a3c] rounded ${className}`} />
}

export default function Intelligence() {
  const { symbol = 'RELIANCE' } = useParams()
  const navigate = useNavigate()
  const [activeInterval, setActiveInterval] = useState('1D')
  const chartRef = useRef(null)

  const [quote, setQuote]       = useState(null)
  const [callData, setCallData] = useState(null)
  const [signals, setSignals]   = useState(null)
  const [ohlcv, setOhlcv]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [watchToast, setWatchToast] = useState('')

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
    } catch (e) {
      console.error('Intelligence fetch error', e)
      setError('Failed to load data for ' + symbol)
    } finally {
      setLoading(false)
    }
  }, [symbol, activeInterval])

  useEffect(() => { load() }, [load])

  // TradingView lightweight-chart
  useEffect(() => {
    const container = chartRef.current
    if (!container || ohlcv.length === 0) return
    let chart, series
    import('lightweight-charts').then(({ createChart }) => {
      container.innerHTML = ''
      chart = createChart(container, {
        width: container.clientWidth,
        height: container.clientHeight,
        layout: { background: { color: '#111c2d' }, textColor: '#bacac2' },
        grid: { vertLines: { color: '#1f2a3c' }, horzLines: { color: '#1f2a3c' } },
        timeScale: { borderColor: '#3b4a44' },
        rightPriceScale: { borderColor: '#3b4a44' },
      })
      series = chart.addCandlestickSeries({
        upColor: '#00d4aa', downColor: '#ffb4ab',
        borderUpColor: '#00d4aa', borderDownColor: '#ffb4ab',
        wickUpColor: '#00d4aa', wickDownColor: '#ffb4ab',
      })
      const isIntraday = activeInterval === '5M' || activeInterval === '15M'
      const candles = ohlcv
        .filter(r => r.open && r.high && r.low && r.close)
        .map(r => ({
          time: isIntraday
            ? Math.floor(new Date(r.timestamp).getTime() / 1000)
            : r.timestamp.split(' ')[0],
          open: r.open, high: r.high, low: r.low, close: r.close,
        }))
      if (candles.length > 0) series.setData(candles)
      const ro = new ResizeObserver(() => chart.applyOptions({ width: container.clientWidth }))
      ro.observe(container)
      return () => { ro.disconnect(); chart.remove() }
    })
    return () => { if (chart) chart.remove() }
  }, [ohlcv, activeInterval])

  // RSI + MACD chart data derived from OHLCV
  const closes = ohlcv.map(r => r.close).filter(Boolean)
  const labels  = ohlcv.map(r => r.timestamp?.split(' ')[0] ?? '').slice(-30)
  const rsiVals = computeRSI(closes)
  const rsiData = rsiVals.slice(-30).map((v, i) => ({ t: labels[i] ?? i, v: v != null ? +v.toFixed(2) : null }))

  const { macdLine, sigLine, hist, offset } = closes.length > 30
    ? computeMACD(closes)
    : { macdLine: [], sigLine: [], hist: [], offset: 0 }
  const macdLabels = ohlcv.slice(offset).map(r => r.timestamp?.split(' ')[0] ?? '').slice(-30)
  const macdData = hist.slice(-30).map((h, i) => ({
    t: macdLabels[i] ?? i,
    macd: +(macdLine[i + macdLine.length - hist.length + (hist.length - Math.min(30, hist.length))] ?? 0).toFixed(3),
    signal: +(sigLine[Math.max(0, sigLine.length - Math.min(30, hist.length)) + i] ?? 0).toFixed(3),
    hist: +h.toFixed(3),
  }))

  const handleAddWatchlist = async () => {
    try {
      await addToWatchlist(symbol)
      setWatchToast('Added to watchlist!')
      setTimeout(() => setWatchToast(''), 2500)
    } catch (e) {
      setWatchToast('Already in watchlist')
      setTimeout(() => setWatchToast(''), 2500)
    }
  }

  const ltp        = quote?.ltp ?? callData?.current_price ?? 0
  const change     = quote?.change ?? 0
  const changePct  = quote?.change_pct ?? 0
  const stockName  = callData?.name ?? quote?.name ?? symbol
  const call       = callData?.call ?? '—'
  const confidence = callData?.confidence ?? 0
  const entry      = callData?.entry ?? ltp
  const sl         = callData?.stop_loss ?? 0
  const target     = callData?.target ?? 0

  const callColor = call === 'BUY' ? '#00d4aa' : call === 'SELL' ? '#ffb4ab' : '#ffa858'

  const scoreItems = [
    { label: 'Technical Score', score: signals?.technical_score ?? 0 },
    { label: 'RSI Zone', score: signals?.rsi != null ? Math.round(100 - Math.abs(signals.rsi - 50) * 2) : 50 },
    { label: 'MACD Momentum', score: signals?.macd_hist != null ? Math.min(100, Math.max(0, 50 + signals.macd_hist * 2)) : 50 },
    { label: 'Volume Strength', score: signals?.volume_ratio != null ? Math.min(100, Math.round(signals.volume_ratio * 40)) : 40 },
    { label: 'BB Position', score: signals?.bb_position != null ? Math.round(100 - Math.abs(signals.bb_position - 50) * 1.5) : 50 },
  ]

  const keyLevels = [
    { label: 'Resistance', value: signals?.resistance ?? 0, dotColor: '#ffb4ab' },
    { label: 'CMP', value: ltp, dotColor: '#00d4aa', bold: true, highlight: true },
    { label: 'VWAP', value: signals?.vwap ?? 0, dotColor: '#ffa858' },
    { label: 'Support', value: signals?.support ?? 0, dotColor: '#46f1c5' },
  ]

  return (
    <main className="w-full">
      {/* Header */}
      <div className="px-4 py-4 md:px-6 bg-[#081425] border-b border-[#1e293b] flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            {loading ? <Skeleton className="w-32 h-7" /> : (
              <>
                <h1 className="text-2xl font-semibold text-[#d8e3fb]">{symbol}</h1>
                <span className="text-sm text-[#c0c6db]">{stockName}</span>
              </>
            )}
          </div>
          {loading ? <Skeleton className="w-48 h-9 mt-1" /> : (
            <div className="flex items-end gap-3">
              <span className="text-[32px] font-bold text-[#d8e3fb] leading-none">
                ₹{ltp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </span>
              <span className={`font-mono text-sm flex items-center mb-1 ${change >= 0 ? 'text-[#00d4aa]' : 'text-[#ffb4ab]'}`}>
                <span className="material-symbols-outlined text-sm">{change >= 0 ? 'arrow_upward' : 'arrow_downward'}</span>
                {Math.abs(change).toFixed(2)} ({changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%)
              </span>
            </div>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          <div className="relative">
            <button
              onClick={handleAddWatchlist}
              className="bg-[#1f2a3c] border border-[#3b4a44] hover:bg-[#2f3a4c] text-[#d8e3fb] px-4 py-2 rounded text-[11px] font-bold uppercase tracking-wide transition-colors"
            >
              ADD TO WATCHLIST
            </button>
            {watchToast && (
              <div className="absolute -bottom-7 left-0 text-[10px] text-[#00d4aa] whitespace-nowrap">{watchToast}</div>
            )}
          </div>
          <button
            onClick={() => navigate('/algo')}
            className="bg-[#1f2a3c] border border-[#3b4a44] hover:bg-[#2f3a4c] text-[#d8e3fb] px-4 py-2 rounded text-[11px] font-bold uppercase tracking-wide transition-colors"
          >
            CREATE ALGO STRATEGY
          </button>
          <button className="bg-[#00d4aa] hover:bg-[#46f1c5] text-[#005643] px-6 py-2 rounded text-[11px] font-bold uppercase tracking-wide transition-colors">
            TRADE
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-4 p-3 bg-[#ffb4ab]/10 border border-[#ffb4ab]/30 rounded text-[#ffb4ab] text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={load} className="text-xs underline">Retry</button>
        </div>
      )}

      <div className="p-4 md:p-6 grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Charts */}
        <div className="xl:col-span-8 flex flex-col gap-2">
          <div className="bg-[#111c2d] border border-[#3b4a44] rounded flex flex-col">
            <div className="flex items-center justify-between p-2 border-b border-[#3b4a44] bg-[#2a3548]">
              <div className="flex gap-1">
                {INTERVALS.map(iv => (
                  <button
                    key={iv}
                    onClick={() => setActiveInterval(iv)}
                    className={`px-3 py-1 rounded font-mono text-sm transition-colors ${activeInterval === iv ? 'bg-[#2f3a4c] text-[#00d4aa] border border-[#3b4a44]' : 'text-[#c0c6db] hover:text-[#d8e3fb] hover:bg-[#2f3a4c]'}`}
                  >
                    {iv}
                  </button>
                ))}
              </div>
            </div>
            {loading ? (
              <Skeleton className="w-full h-[340px]" />
            ) : (
              <div ref={chartRef} className="w-full h-[340px]" />
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {/* RSI subchart */}
            <div className="bg-[#111c2d] border border-[#3b4a44] rounded h-48 p-3 flex flex-col">
              <div className="flex justify-between items-center mb-2">
                <span className="text-[10px] font-bold uppercase text-[#d8e3fb]">RSI (14)</span>
                <span className="text-[#00d4aa] font-mono text-xs">{signals?.rsi?.toFixed(2) ?? '—'}</span>
              </div>
              <div className="flex-grow">
                {loading ? <Skeleton className="h-full" /> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={rsiData}>
                      <XAxis dataKey="t" tick={{ fill: '#bacac2', fontSize: 8 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                      <YAxis domain={[0, 100]} tick={{ fill: '#bacac2', fontSize: 9 }} axisLine={false} tickLine={false} width={25} />
                      <ReferenceLine y={70} stroke="#ffb4ab" strokeDasharray="3 3" />
                      <ReferenceLine y={30} stroke="#00d4aa" strokeDasharray="3 3" />
                      <Tooltip contentStyle={{ background: '#1f2a3c', border: '1px solid #3b4a44', color: '#d8e3fb', fontSize: 11 }} formatter={v => [v?.toFixed(2), 'RSI']} />
                      <Line type="monotone" dataKey="v" stroke="#00d4aa" dot={false} strokeWidth={1.5} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* MACD subchart */}
            <div className="bg-[#111c2d] border border-[#3b4a44] rounded h-48 p-3 flex flex-col">
              <div className="flex justify-between items-center mb-2">
                <span className="text-[10px] font-bold uppercase text-[#d8e3fb]">MACD (12,26,9)</span>
                <span className="text-[#00d4aa] font-mono text-xs">{signals?.macd_hist?.toFixed(3) ?? '—'}</span>
              </div>
              <div className="flex-grow">
                {loading ? <Skeleton className="h-full" /> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={macdData}>
                      <XAxis dataKey="t" tick={{ fill: '#bacac2', fontSize: 8 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                      <YAxis tick={{ fill: '#bacac2', fontSize: 9 }} axisLine={false} tickLine={false} width={30} />
                      <ReferenceLine y={0} stroke="#3b4a44" />
                      <Tooltip contentStyle={{ background: '#1f2a3c', border: '1px solid #3b4a44', color: '#d8e3fb', fontSize: 11 }} />
                      <Bar dataKey="hist" fill="#00d4aa" opacity={0.5} />
                      <Line type="monotone" dataKey="macd" stroke="#00d4aa" dot={false} strokeWidth={1.5} />
                      <Line type="monotone" dataKey="signal" stroke="#c0c6db" dot={false} strokeWidth={1} />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right panels */}
        <div className="xl:col-span-4 flex flex-col gap-2">
          {/* Signal */}
          <div className="bg-[#111c2d] border border-[#3b4a44] rounded p-4 flex flex-col items-center justify-center text-center">
            <span className="text-[#c0c6db] text-[11px] font-bold uppercase tracking-wide mb-2">Algorithmic Signal</span>
            {loading ? <Skeleton className="w-32 h-8 mb-2" /> : (
              <>
                <span className="text-2xl font-bold mb-1" style={{ color: callColor }}>{call}</span>
                <div className="flex items-center gap-1">
                  <span className="font-mono text-xs text-[#d8e3fb]">{confidence}% Confidence</span>
                  {call !== '—' && <span className="material-symbols-outlined text-[14px]" style={{ color: callColor }}>trending_up</span>}
                </div>
                {call !== 'NEUTRAL' && call !== '—' && (
                  <div className="mt-3 grid grid-cols-3 gap-2 w-full text-left">
                    <div className="bg-[#2a3548] p-2 rounded">
                      <div className="text-[9px] uppercase text-[#bacac2]">Entry</div>
                      <div className="font-mono text-xs text-[#d8e3fb]">₹{entry.toLocaleString('en-IN')}</div>
                    </div>
                    <div className="bg-[#2a3548] p-2 rounded">
                      <div className="text-[9px] uppercase text-[#bacac2]">Target</div>
                      <div className="font-mono text-xs text-[#00d4aa]">₹{target.toLocaleString('en-IN')}</div>
                    </div>
                    <div className="bg-[#2a3548] p-2 rounded">
                      <div className="text-[9px] uppercase text-[#bacac2]">SL</div>
                      <div className="font-mono text-xs text-[#ffb4ab]">₹{sl.toLocaleString('en-IN')}</div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Score breakdown */}
          <div className="bg-[#111c2d] border border-[#3b4a44] rounded p-4">
            <h3 className="text-[#d8e3fb] text-[11px] font-bold uppercase border-b border-[#3b4a44] pb-2 mb-3">Signal Score Breakdown</h3>
            <div className="flex flex-col gap-3">
              {loading ? (
                [...Array(5)].map((_, i) => <Skeleton key={i} className="h-6" />)
              ) : (
                scoreItems.map(s => (
                  <div key={s.label} className="flex flex-col gap-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-[#c0c6db]">{s.label}</span>
                      <span className="text-[#00d4aa] font-mono">{Math.round(s.score)}/100</span>
                    </div>
                    <div className="w-full bg-[#2a3548] rounded-full h-1.5">
                      <div
                        className="h-1.5 rounded-full transition-all"
                        style={{ width: `${Math.min(100, Math.max(0, s.score))}%`, background: s.score >= 60 ? '#00d4aa' : s.score >= 40 ? '#ffa858' : '#ffb4ab' }}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Key levels */}
          <div className="bg-[#111c2d] border border-[#3b4a44] rounded p-4">
            <h3 className="text-[#d8e3fb] text-[11px] font-bold uppercase border-b border-[#3b4a44] pb-2 mb-4">Key Levels</h3>
            {loading ? <Skeleton className="h-32" /> : (
              <div className="flex flex-col gap-3 relative">
                <div className="absolute left-2.5 top-2 bottom-2 w-px bg-[#3b4a44]/50 z-0" />
                {keyLevels.filter(l => l.value > 0).map(level => (
                  <div
                    key={level.label}
                    className={`flex items-center gap-4 z-10 relative ${level.highlight ? 'bg-[#2f3a4c]/50 p-2 -mx-2 rounded border border-[#3b4a44]/30' : ''}`}
                  >
                    <div className="w-5 h-5 rounded-full bg-[#1f2a3c] border-2 flex items-center justify-center shrink-0" style={{ borderColor: level.dotColor }}>
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: level.dotColor }} />
                    </div>
                    <div className="flex-grow flex justify-between items-center">
                      <span className={`text-xs ${level.bold ? 'font-bold' : 'text-[#c0c6db]'}`} style={level.bold ? { color: level.dotColor } : {}}>{level.label}</span>
                      <span className="font-mono text-sm text-[#d8e3fb]">₹{level.value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent calls — requires DB; show graceful placeholder */}
          <div className="bg-[#111c2d] border border-[#3b4a44] rounded flex flex-col flex-grow">
            <div className="p-4 border-b border-[#3b4a44]">
              <h3 className="text-[#d8e3fb] text-[11px] font-bold uppercase">Recent Calls History</h3>
            </div>
            <div className="p-4 flex flex-col items-center justify-center gap-2 text-center">
              <span className="material-symbols-outlined text-[32px] text-[#3b4a44]">history</span>
              <p className="text-xs text-[#bacac2]">Call history requires database connection.</p>
              <p className="text-[10px] text-[#85948d]">Connect PostgreSQL to enable persistent call history.</p>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
