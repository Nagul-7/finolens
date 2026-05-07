import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { getWatchlist, getWatchlistQuotes, getScreener, getIndex, getAlgoPnlToday } from '../api/index.js'

function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-[#1f2a3c] rounded ${className}`} />
}

const SIG_STYLE = {
  'STRONG BUY': 'text-[#00d4aa] bg-[#00d4aa]/15 border-[#00d4aa]/40',
  'BUY':        'text-[#46f1c5] bg-[#46f1c5]/10 border-[#46f1c5]/30',
  'NEUTRAL':    'text-[#ffa858] bg-[#ffa858]/10 border-[#ffa858]/30',
  'SELL':       'text-[#ffb4ab] bg-[#ffb4ab]/15 border-[#ffb4ab]/40',
  'STRONG SELL':'text-[#ffb4ab] bg-[#ffb4ab]/20 border-[#ffb4ab]/50',
}

function StockCard({ item, onClick, onChartClick }) {
  const navigate = useNavigate()
  const pos = (item.change_pct ?? 0) >= 0
  const sig = item.signal ?? 'NEUTRAL'
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

// Compact horizontal card for Today's Picks
function PickCard({ item, onClick }) {
  const pos = (item.change_pct ?? 0) >= 0
  const sig = item.signal ?? 'NEUTRAL'
  const sigCls = SIG_STYLE[sig] ?? SIG_STYLE['NEUTRAL']
  const score = item.score ?? 0
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
        <span className="text-[10px] text-[#bacac2] truncate block">{item.sector ?? 'NSE:EQ'}</span>
        {/* Score bar */}
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
const SECTORS = ['All', 'Banking', 'Information Tech', 'Automobiles', 'Pharma', 'Finance', 'FMCG', 'Energy', 'Metals']
const SCORE_PRESETS = [{ label: 'Any', min: 0 }, { label: '>50', min: 50 }, { label: '>65', min: 65 }, { label: '>75', min: 75 }]

export default function Dashboard() {
  const navigate = useNavigate()
  const [allStocks, setAllStocks]       = useState([])
  const [watchSymbols, setWatchSymbols] = useState([])
  const [indexData, setIndexData]       = useState(null)
  const [pnlToday, setPnlToday]         = useState(null)
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState(null)

  // Search
  const [query, setQuery] = useState('')

  // Filters
  const [filtersOpen, setFiltersOpen]   = useState(false)
  const [sigFilters, setSigFilters]     = useState({ BUY: true, NEUTRAL: true, SELL: true })
  const [sector, setSector]             = useState('All')
  const [minScore, setMinScore]         = useState(0)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [wRes, screenerRes, quotesRes, indexRes, pnlRes] = await Promise.allSettled([
        getWatchlist(),
        getScreener({}),
        getWatchlistQuotes(),
        getIndex(),
        getAlgoPnlToday(),
      ])

      const rawSymbols = (wRes.status === 'fulfilled' ? wRes.value.data ?? [] : [])
        .map(item => (typeof item === 'string' ? item : item.symbol))
      setWatchSymbols(rawSymbols)

      const screenerData = screenerRes.status === 'fulfilled' ? (screenerRes.value.data ?? []) : []
      const screenerMap = {}
      for (const s of screenerData) screenerMap[s.symbol] = s

      const quotesData = quotesRes.status === 'fulfilled' ? (quotesRes.value.data ?? []) : []
      const quotesMap = {}
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
    } catch (e) {
      console.error('Dashboard load error', e)
      setError('Failed to load data.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 60000)
    return () => clearInterval(id)
  }, [load])

  // Today's picks: BUY/STRONG BUY, score > 60, top 6
  const topOpportunities = useMemo(() =>
    allStocks
      .filter(s => (s.signal === 'BUY' || s.signal === 'STRONG BUY') && (s.score ?? 0) > 60)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 6),
  [allStocks])

  // Watchlist display with filters
  const displayList = useMemo(() => {
    const q = query.trim().toUpperCase()
    let base = q
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

  // Market overview helpers
  const fmtIdx = (val, pct) => {
    if (val == null) return { price: '—', change: '', pos: true }
    return {
      price: val.toLocaleString('en-IN'),
      change: `${pct >= 0 ? '+' : ''}${pct?.toFixed(2)}%`,
      pos: (pct ?? 0) >= 0,
    }
  }
  const nifty    = fmtIdx(indexData?.nifty?.ltp,     indexData?.nifty?.change_pct)
  const banknifty = fmtIdx(indexData?.banknifty?.ltp, indexData?.banknifty?.change_pct)

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
        </div>
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16" />)}
          </div>
        ) : topOpportunities.length === 0 ? (
          <div className="py-4 text-center text-[#4a5568] text-xs border border-dashed border-[#2a3548] rounded-lg">
            No strong BUY signals in screener — market may be consolidating
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

      {/* ── Section H: Quip Placeholder ─────────────────────────────────────── */}
      <div className="px-4 pb-3">
        <div className="border border-dashed border-[#2a3548] rounded-lg p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-[#4a5568] uppercase tracking-wide">Quip Fundamental Analysis</p>
            <p className="text-[10px] text-[#4a5568] mt-1">AI fundamental analysis integration — coming soon</p>
          </div>
          <span className="material-symbols-outlined text-[#2a3548] text-[32px]">psychology</span>
        </div>
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
                      ? s === 'BUY' ? 'bg-[#46f1c5]/10 border-[#46f1c5]/40 text-[#46f1c5]'
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
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
            ) : (
              <p className="text-[#4a5568] text-xs text-center py-2">No trades today</p>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
