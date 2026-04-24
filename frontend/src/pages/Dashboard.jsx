import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getDashboardData, getWatchlistQuotes } from '../api/index.js'

function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-[#1f2a3c] rounded ${className}`} />
}

function SignalCard({ s }) {
  const navigate = useNavigate()
  const isPos = s.signal_type === 'BUY' || s.signal_type === 'STRONG BUY'
  const barColor = isPos ? '#00d4aa' : s.signal_type === 'SELL' ? '#ffb4ab' : '#ffa858'
  const signalCls = isPos
    ? 'text-[#00d4aa] bg-[#00d4aa]/10 border-[#00d4aa]/30'
    : s.signal_type === 'SELL'
    ? 'text-[#ffb4ab] bg-[#ffb4ab]/10 border-[#ffb4ab]/30'
    : 'text-[#ffa858] bg-[#ffa858]/10 border-[#ffa858]/30'

  const bd = s.signal_breakdown || {}
  const vectors = [
    { label: 'Tech', pct: bd.technical || 20, color: '#46f1c5' },
    { label: 'Vol',  pct: bd.volume    || 20, color: '#00d4aa' },
    { label: 'ML',   pct: bd.ml        || 20, color: '#28dfb5' },
    { label: 'Opt',  pct: bd.options   || 20, color: '#c0c6db' },
    { label: 'Sent', pct: bd.sentiment || 20, color: '#ffa858' },
  ]

  return (
    <article
      className="bg-[#111c2d] border border-[#3b4a44] rounded-lg p-4 flex flex-col gap-3 relative overflow-hidden cursor-pointer hover:border-[#00d4aa]/40 transition-colors"
      onClick={() => navigate(`/intelligence/${s.symbol}`)}
    >
      <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: barColor }} />
      <div className="flex justify-between items-start pl-2">
        <div>
          <h3 className="text-lg font-semibold text-[#d8e3fb] flex items-center gap-2">
            {s.symbol}
            <span className={`border px-2 py-0.5 rounded text-[11px] font-bold tracking-wide ${signalCls}`}>{s.signal_type}</span>
            <span className="bg-[#2a3548] text-[#aeb5c9] border border-[#3b4a44] px-1 py-0.5 rounded text-[9px] font-bold tracking-widest">ALGO</span>
          </h3>
          <p className="text-sm text-[#bacac2] mt-0.5">Confidence: {s.confidence}%</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-mono font-medium text-[#d8e3fb]">₹{s.entry_price?.toLocaleString('en-IN')}</div>
          <div className="flex items-center justify-end gap-1 text-sm text-[#00d4aa]">
            <span className="material-symbols-outlined text-[16px]">trending_up</span> LTP
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 bg-[#2a3548] rounded p-3 pl-4">
        <div>
          <div className="text-[11px] font-bold tracking-wide uppercase text-[#bacac2]">ENTRY</div>
          <div className="font-mono text-sm text-[#d8e3fb] mt-1">₹{s.entry_price?.toLocaleString('en-IN')}</div>
        </div>
        <div>
          <div className="text-[11px] font-bold tracking-wide uppercase text-[#bacac2]">TARGET</div>
          <div className="font-mono text-sm text-[#00d4aa] mt-1">₹{s.target?.toLocaleString('en-IN')}</div>
        </div>
        <div>
          <div className="text-[11px] font-bold tracking-wide uppercase text-[#bacac2]">STOP LOSS</div>
          <div className="font-mono text-sm text-[#ffb4ab] mt-1">₹{s.stop_loss?.toLocaleString('en-IN')}</div>
        </div>
      </div>

      <div className="flex flex-col gap-1 pl-2">
        <span className="text-[11px] font-bold tracking-wide uppercase text-[#bacac2]">SIGNAL VECTORS</span>
        <div className="w-full h-1.5 rounded-full overflow-hidden flex bg-[#2a3548]">
          {vectors.map(v => (
            <div key={v.label} style={{ width: `${v.pct}%`, background: v.color }} className="h-full" />
          ))}
        </div>
        <div className="flex justify-between font-mono text-[10px] text-[#bacac2] mt-0.5">
          {vectors.map(v => <span key={v.label}>{v.label}</span>)}
        </div>
      </div>

      <div className="border-t border-[#3b4a44]/50 pt-2 pl-2">
        <span className="font-mono text-[11px] text-[#bacac2]">{s.trigger_reason}</span>
      </div>
    </article>
  )
}

export default function Dashboard() {
  const [watchlistOpen, setWatchlistOpen] = useState(true)
  const [dash, setDash]             = useState(null)
  const [watchQuotes, setWatchQuotes] = useState([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)
  const navigate = useNavigate()

  const load = useCallback(async () => {
    try {
      const [dashRes, wqRes] = await Promise.all([
        getDashboardData(),
        getWatchlistQuotes().catch(() => ({ data: [] })),
      ])
      setDash(dashRes.data)
      setWatchQuotes(wqRes.data || [])
      setError(null)
    } catch (e) {
      console.error('Dashboard fetch error', e)
      setError('Failed to load dashboard data.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 60000)
    return () => clearInterval(id)
  }, [load])

  const advances    = dash?.advances ?? 0
  const declines    = dash?.declines ?? 0
  const adRatio     = dash?.ad_ratio ?? 0
  const totalAd     = advances + declines || 1
  const advPct      = Math.round(advances / totalAd * 100)
  const marketOpen  = dash?.market_open ?? false

  return (
    <main className="min-h-screen">
      <div className="px-6 py-4 flex justify-between items-center border-b border-[#1f2a3c] bg-[#081425]">
        <h1 className="text-2xl font-semibold text-[#d8e3fb]">Dashboard</h1>
        <div className="flex items-center gap-2">
          {error && (
            <button
              onClick={load}
              className="text-xs text-[#ffb4ab] border border-[#ffb4ab]/30 px-3 py-1.5 rounded hover:bg-[#ffb4ab]/10 transition-colors"
            >
              Retry
            </button>
          )}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${marketOpen ? 'bg-[#46f1c5]/10 border-[#46f1c5]/20' : 'bg-[#1f2a3c] border-[#2a3548]'}`}>
            <div className={`w-2 h-2 rounded-full ${marketOpen ? 'bg-[#46f1c5] animate-pulse-slow' : 'bg-slate-500'}`} />
            <span className={`text-[11px] font-bold uppercase tracking-widest ${marketOpen ? 'text-[#46f1c5]' : 'text-slate-500'}`}>
              {marketOpen ? 'MARKET OPEN' : 'MARKET CLOSED'}
            </span>
          </div>
        </div>
      </div>

      <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Left: Watchlist */}
        <aside className="lg:col-span-3 bg-[#1f2a3c] border border-[#3b4a44] rounded-lg flex flex-col overflow-hidden">
          <div
            className="p-4 border-b border-[#3b4a44] flex justify-between items-center bg-[#2a3548] cursor-pointer hover:bg-[#2f3a4c] transition-colors"
            onClick={() => setWatchlistOpen(o => !o)}
          >
            <h3 className="text-[11px] font-bold tracking-wide uppercase text-[#bacac2] flex items-center gap-2">
              <span className="material-symbols-outlined text-sm">visibility</span>
              Watchlist
            </h3>
            <span className={`material-symbols-outlined text-[#bacac2] text-sm transition-transform ${watchlistOpen ? '' : '-rotate-90'}`}>
              keyboard_arrow_down
            </span>
          </div>
          {watchlistOpen && (
            <div className="flex flex-col">
              {loading ? (
                [...Array(4)].map((_, i) => <Skeleton key={i} className="m-2 h-10" />)
              ) : watchQuotes.length === 0 ? (
                <div className="p-4 text-xs text-[#bacac2] text-center">No watchlist items</div>
              ) : (
                watchQuotes.map((item, i) => (
                  <div
                    key={item.symbol}
                    className={`flex items-center justify-between p-2 hover:bg-[#2a3548]/50 transition-colors cursor-pointer ${i < watchQuotes.length - 1 ? 'border-b border-[#3b4a44]/50' : ''}`}
                    onClick={() => navigate(`/intelligence/${item.symbol}`)}
                  >
                    <div className="flex flex-col">
                      <span className="font-mono text-sm font-bold text-[#d8e3fb]">{item.symbol}</span>
                      <span className="text-[11px] text-[#bacac2]">NSE:EQ</span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="font-mono text-sm text-[#d8e3fb]">₹{item.ltp?.toLocaleString('en-IN')}</span>
                      <span className={`font-mono text-[11px] ${item.change_pct >= 0 ? 'text-[#46f1c5]' : 'text-[#ffb4ab]'}`}>
                        {item.change_pct >= 0 ? '+' : ''}{item.change_pct?.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </aside>

        {/* Center: Signals */}
        <section className="lg:col-span-6 flex flex-col gap-4">
          <h2 className="text-[11px] font-bold tracking-widest uppercase text-[#bacac2] border-b border-[#3b4a44] pb-2">
            Active Algorithmic Signals
          </h2>
          {loading ? (
            [...Array(2)].map((_, i) => <Skeleton key={i} className="h-48" />)
          ) : error ? (
            <div className="bg-[#111c2d] border border-[#ffb4ab]/30 rounded-lg p-6 text-center">
              <p className="text-[#ffb4ab] text-sm">{error}</p>
              <button onClick={load} className="mt-3 text-xs text-[#00d4aa] border border-[#00d4aa]/30 px-4 py-1.5 rounded hover:bg-[#00d4aa]/10 transition-colors">
                Retry
              </button>
            </div>
          ) : (dash?.active_calls?.length || 0) === 0 ? (
            <div className="bg-[#111c2d] border border-[#3b4a44] rounded-lg p-6 text-center">
              <p className="text-[#bacac2] text-sm">No active signals right now.</p>
              <p className="text-[#bacac2] text-xs mt-1">All tracked symbols are in NEUTRAL territory.</p>
            </div>
          ) : (
            dash.active_calls.map(s => <SignalCard key={s.symbol} s={s} />)
          )}
        </section>

        {/* Right: Market Breadth */}
        <aside className="lg:col-span-3 flex flex-col gap-4">
          <div className="bg-[#1f2a3c] border border-[#3b4a44] rounded-lg p-4 flex flex-col gap-2">
            <h3 className="text-[11px] font-bold tracking-widest uppercase text-[#bacac2] border-b border-[#3b4a44] pb-2 mb-2">Algo Status</h3>
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-[#46f1c5] animate-pulse" />
                <span className="text-lg font-semibold text-[#46f1c5]">ACTIVE</span>
              </div>
              <span className="font-mono text-[11px] text-[#bacac2]">V 2.0.0</span>
            </div>
          </div>

          <div className="bg-[#1f2a3c] border border-[#3b4a44] rounded-lg p-4 flex flex-col gap-2">
            <h3 className="text-[11px] font-bold tracking-widests uppercase text-[#bacac2] border-b border-[#3b4a44] pb-2 mb-2">Market Breadth</h3>
            {loading ? (
              <Skeleton className="h-20" />
            ) : (
              <>
                <div className="flex justify-between items-end mb-1">
                  <span className="font-mono font-bold text-[#46f1c5]">{advances} Advances</span>
                  <span className="font-mono font-bold text-[#ffb4ab]">{declines} Declines</span>
                </div>
                <div className="w-full h-3 rounded-sm overflow-hidden flex bg-[#2a3548]">
                  <div className="bg-[#46f1c5] h-full transition-all duration-500" style={{ width: `${advPct}%` }} />
                  <div className="bg-[#ffb4ab] h-full transition-all duration-500" style={{ width: `${100 - advPct}%` }} />
                </div>
                <div className="mt-4 pt-4 border-t border-[#3b4a44]/50 flex flex-col gap-3">
                  {[
                    { label: 'A/D Ratio', value: adRatio.toFixed(2), color: adRatio >= 1 ? 'text-[#46f1c5]' : 'text-[#ffb4ab]' },
                    { label: 'Active Calls', value: String(dash?.active_calls?.length ?? 0), color: 'text-[#00d4aa]' },
                    { label: 'Market Status', value: marketOpen ? 'Open' : 'Closed', color: marketOpen ? 'text-[#46f1c5]' : 'text-slate-500' },
                  ].map(row => (
                    <div key={row.label} className="flex justify-between items-center">
                      <span className="text-sm text-[#bacac2]">{row.label}</span>
                      <span className={`font-mono text-sm ${row.color}`}>{row.value}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </aside>
      </div>
    </main>
  )
}
