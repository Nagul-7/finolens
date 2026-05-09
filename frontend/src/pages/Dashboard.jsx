import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getWatchlist, getWatchlistQuotes, getScreener, getIndex,
  getAlgoPnlToday, getAlgoAlignments, getMarketScan,
} from '../api/index.js'

function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-[#1f2a3c] rounded ${className}`} />
}

const SIG_STYLE = {
  'STRONG BUY':   'text-[#00d4aa] bg-[#00d4aa]/15 border-[#00d4aa]/40',
  'BUY':          'text-[#46f1c5] bg-[#46f1c5]/10 border-[#46f1c5]/30',
  'NEUTRAL':      'text-[#ffa858] bg-[#ffa858]/10 border-[#ffa858]/30',
  'SELL':         'text-[#ffb4ab] bg-[#ffb4ab]/15 border-[#ffb4ab]/40',
  'STRONG SELL':  'text-[#ffb4ab] bg-[#ffb4ab]/20 border-[#ffb4ab]/50',
  'ALGO SIGNAL':  'text-[#00d4aa] bg-[#00d4aa]/15 border-[#00d4aa]/40',
}

const SCOREBOARD_SECTORS = [
  'ALL','IT','Banking','Energy','FMCG','Pharma',
  'Auto','Finance','Metals','Infrastructure',
  'Cement','Telecom','Consumer','Insurance',
  'Healthcare','Chemicals','Paints','Conglomerate','Other',
]

function StockCard({ item, onClick, onChartClick }) {
  const pos    = (item.change_pct ?? 0) >= 0
  const sig    = item.signal ?? 'NEUTRAL'
  const sigCls = SIG_STYLE[sig] ?? SIG_STYLE['NEUTRAL']

  return (
    <div
      onClick={onClick}
      className="bg-[#111c2d] border border-[#2a3548] rounded-lg p-3 flex items-center justify-between gap-3 cursor-pointer hover:border-[#00d4aa]/40 hover:bg-[#152031] transition-all active:scale-[0.98]"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-mono font-bold text-[#d8e3fb] text-sm truncate">{item.symbol}</span>
          <span className={`border px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wide shrink-0 ${sigCls}`}>{sig}</span>
        </div>
        <span className="text-[10px] text-[#bacac2] truncate block">{item.sector ?? 'NSE:EQ'}</span>
      </div>
      <div className="text-right shrink-0 flex flex-col items-end gap-0.5">
        <div className="font-mono text-sm font-semibold text-[#d8e3fb]">
          ₹{item.ltp?.toLocaleString('en-IN', { minimumFractionDigits: 2 }) ?? '—'}
        </div>
        <div className={`font-mono text-[11px] flex items-center justify-end gap-0.5 ${pos ? 'text-[#46f1c5]' : 'text-[#ffb4ab]'}`}>
          <span className="material-symbols-outlined text-[11px]">{pos ? 'arrow_upward' : 'arrow_downward'}</span>
          {pos ? '+' : ''}{item.change_pct?.toFixed(2) ?? '0.00'}%
        </div>
        {item.score != null && (
          <div className="text-[9px] text-[#bacac2]">{item.score?.toFixed(0)}/100</div>
        )}
        {onChartClick && (
          <button
            onClick={e => { e.stopPropagation(); onChartClick() }}
            className="p-0.5 text-[#4a5568] hover:text-[#00d4aa] transition-colors"
            title="Open in Charts"
          >
            <span className="material-symbols-outlined text-[14px]">candlestick_chart</span>
          </button>
        )}
      </div>
    </div>
  )
}

function PickCard({ item, onClick }) {
  const pos      = (item.change_pct ?? 0) >= 0
  const sig      = item.signal ?? 'NEUTRAL'
  const sigCls   = SIG_STYLE[sig] ?? SIG_STYLE['NEUTRAL']
  const score    = item.score ?? 0
  const scoreColor = score >= 70 ? '#00d4aa' : score >= 50 ? '#ffa858' : '#ffb4ab'

  return (
    <div
      onClick={onClick}
      className="bg-[#111c2d] border border-[#2a3548] rounded-lg p-3 flex items-center gap-3 cursor-pointer hover:border-[#00d4aa]/40 hover:bg-[#152031] transition-all active:scale-[0.98]"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-mono font-bold text-[#d8e3fb] text-sm">{item.symbol}</span>
          <span className={`border px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wide shrink-0 ${sigCls}`}>{sig}</span>
        </div>
        {item.strategy_name ? (
          <span className="text-[10px] text-[#00d4aa] truncate block">{item.strategy_name}</span>
        ) : (
          <span className="text-[10px] text-[#bacac2] truncate block">{item.sector ?? 'NSE:EQ'}</span>
        )}
        <div className="mt-1.5 flex items-center gap-2">
          <div className="flex-1 bg-[#2a3548] rounded-full h-1">
            <div className="h-1 rounded-full" style={{ width: `${Math.min(100, score)}%`, background: scoreColor }} />
          </div>
          <span className="text-[9px] font-mono shrink-0" style={{ color: scoreColor }}>{score.toFixed(0)}</span>
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="font-mono text-sm font-semibold text-[#d8e3fb]">
          ₹{item.ltp?.toLocaleString('en-IN', { minimumFractionDigits: 2 }) ?? '—'}
        </div>
        <div className={`font-mono text-[11px] flex items-center justify-end gap-0.5 ${pos ? 'text-[#46f1c5]' : 'text-[#ffb4ab]'}`}>
          <span className="material-symbols-outlined text-[11px]">{pos ? 'arrow_upward' : 'arrow_downward'}</span>
          {pos ? '+' : ''}{item.change_pct?.toFixed(2) ?? '0.00'}%
        </div>
        <span className="material-symbols-outlined text-[14px] text-[#4a5568] mt-0.5">arrow_forward</span>
      </div>
    </div>
  )
}

const FILTER_SIGNALS = ['BUY', 'NEUTRAL', 'SELL']
const SECTORS        = ['All', 'Banking', 'Information Tech', 'Automobiles', 'Pharma', 'Finance', 'FMCG', 'Energy', 'Metals']
const SCORE_PRESETS  = [{ label: 'Any', min: 0 }, { label: '>50', min: 50 }, { label: '>65', min: 65 }, { label: '>75', min: 75 }]

export default function Dashboard() {
  const navigate = useNavigate()
  const [allStocks,    setAllStocks]    = useState([])
  const [watchSymbols, setWatchSymbols] = useState([])
  const [indexData,    setIndexData]    = useState(null)
  const [pnlToday,     setPnlToday]     = useState(null)
  const [alignments,   setAlignments]   = useState([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState(null)

  // Market Scoreboard
  const [marketScan,   setMarketScan]   = useState(null)
  const [scanLoading,  setScanLoading]  = useState(true)
  const [scoreFilter,  setScoreFilter]  = useState('ALL')
  const [sectorFilter, setSectorFilter] = useState('ALL')
  const [indexFilter,  setIndexFilter]  = useState('ALL')

  // Watchlist filters
  const [query,       setQuery]       = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [sigFilters,  setSigFilters]  = useState({ BUY: true, NEUTRAL: true, SELL: true })
  const [sector,      setSector]      = useState('All')
  const [minScore,    setMinScore]    = useState(0)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [wRes, screenerRes, quotesRes, indexRes, pnlRes, alignRes] = await Promise.allSettled([
        getWatchlist(),
        getScreener({}),
        getWatchlistQuotes(),
        getIndex(),
        getAlgoPnlToday(),
        getAlgoAlignments(),
      ])

      const rawSymbols = (wRes.status === 'fulfilled' ? wRes.value.data ?? [] : [])
        .map(item => (typeof item === 'string' ? item : item.symbol))
      setWatchSymbols(rawSymbols)

      const screenerData = screenerRes.status === 'fulfilled' ? (screenerRes.value.data ?? []) : []
      const screenerMap  = {}
      for (const s of screenerData) screenerMap[s.symbol] = s

      const quotesData = quotesRes.status === 'fulfilled' ? (quotesRes.value.data ?? []) : []
      const quotesMap  = {}
      for (const q of quotesData) quotesMap[q.symbol] = q

      const merged = screenerData.map(s => ({
        ...s,
        ltp:        quotesMap[s.symbol]?.ltp        ?? s.ltp,
        change_pct: quotesMap[s.symbol]?.change_pct ?? s.change_pct,
      }))
      for (const sym of rawSymbols) {
        if (!screenerMap[sym] && quotesMap[sym]) {
          merged.push({ symbol: sym, ...quotesMap[sym], signal: 'NEUTRAL', score: null })
        }
      }
      setAllStocks(merged)

      if (indexRes.status === 'fulfilled') setIndexData(indexRes.value.data ?? null)
      if (pnlRes.status === 'fulfilled')   setPnlToday(pnlRes.value.data ?? null)

      if (alignRes.status === 'fulfilled') {
        const rawAlign = alignRes.value.data?.alignments ?? []
        const enriched = rawAlign.map(a => ({
          ...a,
          ltp:        quotesMap[a.symbol]?.ltp        ?? a.current_price ?? null,
          change_pct: quotesMap[a.symbol]?.change_pct ?? 0,
        }))
        setAlignments(enriched)
      }
    } catch (e) {
      console.error('Dashboard load error', e)
      setError('Failed to load data.')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadMarketScan = useCallback(() => {
    setScanLoading(true)
    getMarketScan()
      .then(r => setMarketScan(r.data))
      .catch(() => {})
      .finally(() => setScanLoading(false))
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 60000)
    return () => clearInterval(id)
  }, [load])

  useEffect(() => {
    loadMarketScan()
  }, [loadMarketScan])

  const topOpportunities = useMemo(() => {
    const buySet = new Set()
    const picks  = []

    for (const s of allStocks) {
      if ((s.signal === 'BUY' || s.signal === 'STRONG BUY') && (s.score ?? 0) > 60) {
        buySet.add(s.symbol)
        picks.push(s)
      }
    }

    for (const a of alignments) {
      if ((a.score ?? 0) < 65) continue
      if (buySet.has(a.symbol)) {
        const existing = picks.find(p => p.symbol === a.symbol)
        if (existing && !existing.strategy_name) existing.strategy_name = a.strategy_name
        continue
      }
      buySet.add(a.symbol)
      picks.push({
        symbol:        a.symbol,
        signal:        'ALGO SIGNAL',
        score:         a.score,
        strategy_name: a.strategy_name,
        ltp:           a.ltp ?? null,
        change_pct:    a.change_pct ?? 0,
        sector:        null,
      })
    }

    return picks
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 6)
  }, [allStocks, alignments])

  const displayList = useMemo(() => {
    const q    = query.trim().toUpperCase()
    let base   = q
      ? allStocks.filter(s => s.symbol.includes(q) || (s.sector ?? '').toUpperCase().includes(q))
      : allStocks.filter(s => watchSymbols.includes(s.symbol))

    const activeSigs = FILTER_SIGNALS.filter(k => sigFilters[k])
    if (activeSigs.length < 3) {
      base = base.filter(s => {
        const sig = s.signal ?? 'NEUTRAL'
        return activeSigs.some(a =>
          a === 'BUY' ? sig.includes('BUY') : a === 'SELL' ? sig.includes('SELL') : sig === 'NEUTRAL'
        )
      })
    }
    if (sector !== 'All') base = base.filter(s => s.sector === sector)
    if (minScore > 0)     base = base.filter(s => (s.score ?? 0) >= minScore)
    return base
  }, [allStocks, watchSymbols, query, sigFilters, sector, minScore])

  // Filtered scoreboard rows (memoised so 50+ stock filter doesn't run on every keystroke)
  const scoreboardRows = useMemo(() => {
    const stocks = marketScan?.all_stocks ?? []
    return stocks.filter(s =>
      (indexFilter  === 'ALL' || s.index  === indexFilter) &&
      (scoreFilter  === 'ALL' || s.signal === scoreFilter ||
        (scoreFilter === 'BUY' && s.technical_score >= 58)) &&
      (sectorFilter === 'ALL' || s.sector === sectorFilter)
    )
  }, [marketScan, indexFilter, scoreFilter, sectorFilter])

  const activeFiltersCount = [
    !sigFilters.BUY || !sigFilters.NEUTRAL || !sigFilters.SELL,
    sector !== 'All',
    minScore > 0,
  ].filter(Boolean).length

  const resetFilters = () => {
    setSigFilters({ BUY: true, NEUTRAL: true, SELL: true })
    setSector('All')
    setMinScore(0)
  }

  const fmtIdx = (val, pct) => {
    if (val == null) return { price: '—', change: '', pos: true }
    return {
      price:  val.toLocaleString('en-IN'),
      change: `${pct >= 0 ? '+' : ''}${pct?.toFixed(2)}%`,
      pos:    (pct ?? 0) >= 0,
    }
  }
  const nifty     = fmtIdx(indexData?.nifty?.ltp,     indexData?.nifty?.change_pct)
  const banknifty = fmtIdx(indexData?.banknifty?.ltp, indexData?.banknifty?.change_pct)

  const winRate   = pnlToday?.win_rate_today ?? null
  const bestStrat = pnlToday?.best_strategy  ?? null

  return (
    <main className="min-h-screen">

      {/* ── Section A: Market Overview Strip ───────────────────────────────── */}
      <div className="px-4 py-2 bg-[#0d1829] border-b border-[#1e293b] flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2 bg-[#081425] border border-[#2a3548] rounded px-3 py-1.5">
          <span className="text-[10px] font-bold text-[#4a5568] uppercase tracking-wide">NIFTY 50</span>
          <span className="font-mono text-sm font-bold text-[#d8e3fb]">{nifty.price}</span>
          {indexData?.nifty && (
            <span className={`font-mono text-[11px] font-bold ${nifty.pos ? 'text-[#46f1c5]' : 'text-[#ffb4ab]'}`}>{nifty.change}</span>
          )}
        </div>
        <div className="flex items-center gap-2 bg-[#081425] border border-[#2a3548] rounded px-3 py-1.5">
          <span className="text-[10px] font-bold text-[#4a5568] uppercase tracking-wide">BANK NIFTY</span>
          <span className="font-mono text-sm font-bold text-[#d8e3fb]">{banknifty.price}</span>
          {indexData?.banknifty && (
            <span className={`font-mono text-[11px] font-bold ${banknifty.pos ? 'text-[#46f1c5]' : 'text-[#ffb4ab]'}`}>{banknifty.change}</span>
          )}
        </div>
        <span className="ml-auto text-[9px] text-[#4a5568] font-mono">
          Updated {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      {/* ── Section B: Today's Picks ────────────────────────────────────────── */}
      <div className="px-4 pt-4 pb-3">
        <div className="text-[10px] font-bold uppercase tracking-widest text-[#bacac2] mb-2 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#00d4aa] animate-pulse" />
          TODAY'S PICKS — BULLISH OPPORTUNITIES
          {alignments.length > 0 && (
            <span className="text-[#00d4aa] font-bold">&amp; STRATEGY ALIGNMENTS</span>
          )}
        </div>
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16" />)}
          </div>
        ) : topOpportunities.length === 0 ? (
          <div className="py-4 text-center text-[#4a5568] text-xs border border-dashed border-[#2a3548] rounded-lg">
            No strong BUY signals or strategy alignments — market may be consolidating
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {topOpportunities.map(item => (
              <PickCard
                key={item.symbol}
                item={item}
                onClick={() => navigate(`/intelligence/${item.symbol}`)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Section M: Market Scoreboard ────────────────────────────────────── */}
      <div className="px-4 pb-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-sm font-bold text-[#d8e3fb] uppercase tracking-wide">
              Market Scoreboard
            </h2>
            {marketScan && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] px-2 py-0.5 rounded bg-[#00d4aa]/10 text-[#00d4aa] border border-[#00d4aa]/20">
                  {marketScan.total_bullish} Bullish
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-[#ffb4ab]/10 text-[#ffb4ab] border border-[#ffb4ab]/20">
                  {marketScan.total_bearish} Bearish
                </span>
                <span className="text-[10px] text-[#4a5568]">
                  {marketScan.scan_time
                    ? `Updated ${new Date(marketScan.scan_time).toLocaleTimeString('en-IN')}`
                    : ''}
                </span>
              </div>
            )}
          </div>
          <button
            onClick={loadMarketScan}
            disabled={scanLoading}
            className="text-[10px] text-[#4a5568] hover:text-[#00d4aa] flex items-center gap-1 transition-colors disabled:opacity-50 shrink-0"
          >
            <span className={`material-symbols-outlined text-[12px] ${scanLoading ? 'animate-spin' : ''}`}>refresh</span>
            Refresh
          </button>
        </div>

        {/* Filter row */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {/* Index filter */}
          <div className="flex rounded overflow-hidden border border-[#2a3548]">
            {['ALL', 'NIFTY50', 'BANKNIFTY'].map(f => (
              <button
                key={f}
                onClick={() => setIndexFilter(f)}
                className={`px-3 py-1 text-[10px] font-bold transition-colors ${
                  indexFilter === f
                    ? 'bg-[#00d4aa] text-[#005643]'
                    : 'text-[#bacac2] hover:text-[#d8e3fb] bg-[#0d1829]'
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Signal filter */}
          <div className="flex rounded overflow-hidden border border-[#2a3548]">
            {['ALL', 'BUY', 'NEUTRAL', 'SELL'].map(f => (
              <button
                key={f}
                onClick={() => setScoreFilter(f)}
                className={`px-3 py-1 text-[10px] font-bold transition-colors ${
                  scoreFilter === f
                    ? 'bg-[#1e293b] text-[#d8e3fb]'
                    : 'text-[#bacac2] hover:text-[#d8e3fb] bg-[#0d1829]'
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Sector filter */}
          <select
            value={sectorFilter}
            onChange={e => setSectorFilter(e.target.value)}
            className="bg-[#111c2d] border border-[#2a3548] rounded px-2 py-1 text-[10px] text-[#bacac2] outline-none focus:border-[#00d4aa]"
          >
            {SCOREBOARD_SECTORS.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          {/* Reset filters */}
          {(indexFilter !== 'ALL' || scoreFilter !== 'ALL' || sectorFilter !== 'ALL') && (
            <button
              onClick={() => { setIndexFilter('ALL'); setScoreFilter('ALL'); setSectorFilter('ALL') }}
              className="text-[10px] text-[#bacac2] hover:text-[#ffb4ab] flex items-center gap-0.5 transition-colors"
            >
              <span className="material-symbols-outlined text-[12px]">cancel</span>
              Reset
            </button>
          )}
        </div>

        {/* Scoreboard table */}
        {scanLoading ? (
          <div className="flex flex-col gap-1.5">
            {Array(8).fill(0).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[#1e293b]">
            {/* Table header */}
            <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-[#0d1829] text-[9px] font-bold text-[#4a5568] uppercase tracking-wider">
              <div className="col-span-2">Symbol</div>
              <div className="col-span-1">Idx</div>
              <div className="col-span-2">Sector</div>
              <div className="col-span-1 text-right">Price</div>
              <div className="col-span-1 text-right">Chg%</div>
              <div className="col-span-2">Score</div>
              <div className="col-span-1 text-center">Signal</div>
              <div className="col-span-1 text-center">RSI</div>
              <div className="col-span-1 text-center">Vol</div>
            </div>

            {/* Table rows */}
            <div className="divide-y divide-[#0d1829] max-h-[480px] overflow-y-auto">
              {scoreboardRows.length === 0 ? (
                <div className="py-8 text-center text-[#4a5568] text-sm">
                  {marketScan
                    ? 'No stocks match the selected filters'
                    : 'Market scan data unavailable — click Refresh to load'}
                </div>
              ) : (
                scoreboardRows.map((stock, i) => {
                  const scoreColor = stock.technical_score >= 65
                    ? '#00d4aa'
                    : stock.technical_score >= 50
                    ? '#ffa858'
                    : '#ffb4ab'
                  return (
                    <div
                      key={stock.symbol}
                      onClick={() => navigate(`/intelligence/${stock.symbol}`)}
                      className="grid grid-cols-12 gap-2 px-3 py-2.5 cursor-pointer hover:bg-[#111c2d] transition-colors items-center group"
                    >
                      {/* Rank + Symbol */}
                      <div className="col-span-2 flex items-center gap-1.5">
                        <span className="text-[9px] text-[#4a5568] w-4 text-right font-mono shrink-0">
                          {i + 1}
                        </span>
                        <span className="text-[11px] font-bold font-mono text-[#d8e3fb] group-hover:text-[#00d4aa] transition-colors truncate">
                          {stock.symbol}
                        </span>
                      </div>

                      {/* Index */}
                      <div className="col-span-1">
                        <span className="text-[8px] font-bold text-[#4a5568]">
                          {stock.index === 'BANKNIFTY' ? 'BNF' : 'N50'}
                        </span>
                      </div>

                      {/* Sector */}
                      <div className="col-span-2">
                        <span className="text-[9px] text-[#4a5568] truncate block">{stock.sector}</span>
                      </div>

                      {/* Price */}
                      <div className="col-span-1 text-right">
                        <span className="text-[10px] font-mono text-[#d8e3fb]">
                          ₹{stock.ltp ? stock.ltp.toFixed(0) : '—'}
                        </span>
                      </div>

                      {/* Change % */}
                      <div className="col-span-1 text-right">
                        <span className={`text-[10px] font-mono font-bold ${
                          stock.change_pct >= 0 ? 'text-[#00d4aa]' : 'text-[#ffb4ab]'
                        }`}>
                          {stock.change_pct >= 0 ? '+' : ''}
                          {stock.change_pct ? stock.change_pct.toFixed(2) : '0.00'}%
                        </span>
                      </div>

                      {/* Score bar */}
                      <div className="col-span-2 flex items-center gap-1.5">
                        <div className="flex-1 h-1.5 bg-[#0d1829] rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${stock.technical_score}%`, background: scoreColor }}
                          />
                        </div>
                        <span className="text-[9px] font-mono w-6 shrink-0" style={{ color: scoreColor }}>
                          {stock.technical_score}
                        </span>
                      </div>

                      {/* Signal badge */}
                      <div className="col-span-1 flex justify-center">
                        <span className={`text-[8px] font-bold px-1 py-0.5 rounded ${
                          stock.signal === 'BUY'  ? 'bg-[#00d4aa]/15 text-[#00d4aa]'
                          : stock.signal === 'SELL' ? 'bg-[#ffb4ab]/15 text-[#ffb4ab]'
                          : 'bg-[#1e293b] text-[#4a5568]'
                        }`}>
                          {stock.signal}
                        </span>
                      </div>

                      {/* RSI */}
                      <div className="col-span-1 text-center">
                        <span className={`text-[9px] font-mono ${
                          stock.rsi < 35 ? 'text-[#00d4aa]'
                          : stock.rsi > 65 ? 'text-[#ffb4ab]'
                          : 'text-[#bacac2]'
                        }`}>
                          {stock.rsi ? stock.rsi.toFixed(0) : '—'}
                        </span>
                      </div>

                      {/* Volume ratio */}
                      <div className="col-span-1 text-center">
                        <span className={`text-[9px] font-mono ${
                          stock.volume_ratio >= 1.5 ? 'text-[#ffa858]' : 'text-[#4a5568]'
                        }`}>
                          {stock.volume_ratio ? stock.volume_ratio.toFixed(1) : '—'}x
                        </span>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Section C+D: Search + Filters (sticky) ──────────────────────────── */}
      <div className="px-4 pt-2 pb-2 bg-[#081425] border-b border-[#1f2a3c] sticky top-14 z-20">
        <div className="flex items-center gap-2 bg-[#111c2d] border border-[#2a3548] rounded-lg px-3 py-2 focus-within:border-[#00d4aa] transition-colors">
          <span className="material-symbols-outlined text-[#bacac2] text-[18px] shrink-0">search</span>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value.toUpperCase())}
            placeholder="Search any NSE stock — NIFTY 50 / BANK NIFTY…"
            className="flex-1 bg-transparent outline-none text-[#d8e3fb] text-sm placeholder:text-[#bacac2] font-mono uppercase placeholder:normal-case"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-[#bacac2] hover:text-[#d8e3fb]">
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={() => setFiltersOpen(o => !o)}
            className={`flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-bold uppercase tracking-wide transition-colors border ${
              filtersOpen || activeFiltersCount > 0
                ? 'bg-[#00d4aa]/10 border-[#00d4aa]/40 text-[#00d4aa]'
                : 'bg-[#1f2a3c] border-[#2a3548] text-[#bacac2] hover:text-[#d8e3fb]'
            }`}
          >
            <span className="material-symbols-outlined text-[14px]">tune</span>
            Filters
            {activeFiltersCount > 0 && (
              <span className="bg-[#00d4aa] text-[#005643] rounded-full w-4 h-4 flex items-center justify-center text-[9px]">
                {activeFiltersCount}
              </span>
            )}
          </button>
          {!filtersOpen && activeFiltersCount > 0 && (
            <button onClick={resetFilters} className="text-[10px] text-[#bacac2] hover:text-[#ffb4ab] flex items-center gap-0.5">
              <span className="material-symbols-outlined text-[12px]">cancel</span>Reset
            </button>
          )}
          <span className="ml-auto text-[10px] text-[#bacac2] font-mono">
            {loading ? '…' : `${displayList.length} ${query ? 'results' : 'stocks'}`}
          </span>
        </div>

        {filtersOpen && (
          <div className="mt-2 pb-3 flex flex-col gap-3 border-t border-[#1f2a3c] pt-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold uppercase text-[#bacac2] w-14 shrink-0">Signal</span>
              {FILTER_SIGNALS.map(s => (
                <button
                  key={s}
                  onClick={() => setSigFilters(p => ({ ...p, [s]: !p[s] }))}
                  className={`px-2.5 py-0.5 rounded text-[10px] font-bold border transition-colors ${
                    sigFilters[s]
                      ? s === 'BUY'  ? 'bg-[#46f1c5]/10 border-[#46f1c5]/40 text-[#46f1c5]'
                        : s === 'SELL' ? 'bg-[#ffb4ab]/10 border-[#ffb4ab]/40 text-[#ffb4ab]'
                        : 'bg-[#ffa858]/10 border-[#ffa858]/40 text-[#ffa858]'
                      : 'bg-[#1f2a3c] border-[#2a3548] text-[#4a5568] line-through'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold uppercase text-[#bacac2] w-14 shrink-0">Score</span>
              {SCORE_PRESETS.map(p => (
                <button
                  key={p.label}
                  onClick={() => setMinScore(p.min)}
                  className={`px-2.5 py-0.5 rounded text-[10px] font-bold border transition-colors ${
                    minScore === p.min
                      ? 'bg-[#00d4aa]/10 border-[#00d4aa]/40 text-[#00d4aa]'
                      : 'bg-[#1f2a3c] border-[#2a3548] text-[#bacac2]'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase text-[#bacac2] w-14 shrink-0">Sector</span>
              <select
                value={sector}
                onChange={e => setSector(e.target.value)}
                className="flex-1 bg-[#111c2d] border border-[#2a3548] rounded px-2 py-1 text-xs text-[#d8e3fb] focus:border-[#00d4aa] outline-none"
              >
                {SECTORS.map(s => <option key={s}>{s}</option>)}
              </select>
              {activeFiltersCount > 0 && (
                <button onClick={resetFilters} className="text-[10px] text-[#bacac2] hover:text-[#ffb4ab] shrink-0">
                  Reset all
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Section E: Your Watchlist ────────────────────────────────────────── */}
      <div className="p-4">
        {error && (
          <div className="mb-3 p-3 bg-[#ffb4ab]/10 border border-[#ffb4ab]/30 rounded text-[#ffb4ab] text-sm flex justify-between items-center">
            {error}
            <button onClick={load} className="text-xs underline">Retry</button>
          </div>
        )}

        {loading ? (
          <div className="flex flex-col gap-2">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16" />)}
          </div>
        ) : displayList.length === 0 ? (
          <div className="text-center py-12">
            <span className="material-symbols-outlined text-[48px] text-[#2a3548]">
              {query ? 'search_off' : 'list_alt'}
            </span>
            <p className="text-[#bacac2] mt-3 text-sm">
              {query ? `No results for "${query}"` : 'Your watchlist is empty'}
            </p>
            {!query && (
              <button
                onClick={() => navigate('/watchlist')}
                className="mt-3 px-4 py-2 bg-[#00d4aa] text-[#005643] rounded text-xs font-bold hover:bg-[#46f1c5] transition-colors"
              >
                + ADD STOCKS
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="text-[10px] font-bold uppercase tracking-widest text-[#bacac2] mb-2">
              {query ? `Search results — "${query}"` : 'YOUR WATCHLIST'}
            </div>
            <div className="flex flex-col gap-2">
              {displayList.map(item => (
                <StockCard
                  key={item.symbol}
                  item={item}
                  onClick={() => navigate(`/intelligence/${item.symbol}`)}
                  onChartClick={() => {
                    sessionStorage.setItem('charts_symbol', item.symbol)
                    navigate('/charts')
                  }}
                />
              ))}
            </div>
          </>
        )}

        {/* ── Section F: Algo P&L Summary ───────────────────────────────────── */}
        {!loading && (
          <div className="mt-6 bg-[#111c2d] border border-[#2a3548] rounded-lg p-4">
            <div className="text-[10px] font-bold uppercase tracking-widest text-[#bacac2] mb-3 flex items-center gap-2">
              <span className="material-symbols-outlined text-[14px] text-[#ffa858]">precision_manufacturing</span>
              ALGO PERFORMANCE — TODAY
            </div>

            {pnlToday ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                  <div className="flex flex-col items-center bg-[#081425] rounded p-3">
                    <span className="text-[9px] uppercase text-[#bacac2] mb-1">Today's P&L</span>
                    <span className={`font-mono text-lg font-bold ${(pnlToday.total_pnl ?? 0) >= 0 ? 'text-[#46f1c5]' : 'text-[#ffb4ab]'}`}>
                      {(pnlToday.total_pnl ?? 0) >= 0 ? '+' : ''}₹{Math.abs(pnlToday.total_pnl ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                  <div className="flex flex-col items-center bg-[#081425] rounded p-3">
                    <span className="text-[9px] uppercase text-[#bacac2] mb-1">Trades Today</span>
                    <span className="font-mono text-lg font-bold text-[#d8e3fb]">{pnlToday.trades_today ?? 0}</span>
                  </div>
                  <div className="flex flex-col items-center bg-[#081425] rounded p-3">
                    <span className="text-[9px] uppercase text-[#bacac2] mb-1">Realized</span>
                    <span className={`font-mono text-lg font-bold ${(pnlToday.realized_pnl ?? 0) >= 0 ? 'text-[#46f1c5]' : 'text-[#ffb4ab]'}`}>
                      ₹{(pnlToday.realized_pnl ?? 0).toFixed(0)}
                    </span>
                  </div>
                  <div className="flex flex-col items-center bg-[#081425] rounded p-3">
                    <span className="text-[9px] uppercase text-[#bacac2] mb-1">Unrealized</span>
                    <span className={`font-mono text-lg font-bold ${(pnlToday.unrealized_pnl ?? 0) >= 0 ? 'text-[#00d4aa]' : 'text-[#ffa858]'}`}>
                      ₹{(pnlToday.unrealized_pnl ?? 0).toFixed(0)}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {winRate !== null && (
                    <div className="bg-[#081425] rounded p-3 flex items-center gap-3">
                      <div className="flex-1">
                        <div className="text-[9px] uppercase text-[#bacac2] mb-1">Win Rate Today</div>
                        <div className="flex items-center gap-2">
                          <span className={`font-mono text-base font-bold ${winRate >= 60 ? 'text-[#46f1c5]' : winRate >= 40 ? 'text-[#ffa858]' : 'text-[#ffb4ab]'}`}>
                            {winRate.toFixed(0)}%
                          </span>
                          <span className="text-[10px] text-[#bacac2]">
                            {pnlToday.winning_trades ?? 0}W / {pnlToday.losing_trades ?? 0}L
                          </span>
                        </div>
                      </div>
                      <div
                        className="w-10 h-10 rounded-full border-2 flex items-center justify-center shrink-0"
                        style={{ borderColor: winRate >= 60 ? '#46f1c5' : winRate >= 40 ? '#ffa858' : '#ffb4ab' }}
                      >
                        <span
                          className="text-[10px] font-bold"
                          style={{ color: winRate >= 60 ? '#46f1c5' : winRate >= 40 ? '#ffa858' : '#ffb4ab' }}
                        >
                          {winRate.toFixed(0)}
                        </span>
                      </div>
                    </div>
                  )}
                  {bestStrat && (
                    <div className="bg-[#081425] rounded p-3">
                      <div className="text-[9px] uppercase text-[#bacac2] mb-1">Best Strategy</div>
                      <div className="font-mono text-xs font-bold text-[#00d4aa] truncate">{bestStrat.name}</div>
                      {bestStrat.pnl != null && (
                        <div className={`font-mono text-sm font-bold mt-0.5 ${bestStrat.pnl >= 0 ? 'text-[#46f1c5]' : 'text-[#ffb4ab]'}`}>
                          {bestStrat.pnl >= 0 ? '+' : ''}₹{Math.abs(bestStrat.pnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <p className="text-[#4a5568] text-xs text-center py-2">No trades today</p>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
