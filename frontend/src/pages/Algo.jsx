import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { io } from 'socket.io-client'
import {
  getAlgoStrategies, getAlgoPositions, getAlgoTrades,
  toggleStrategy, saveAlgoStrategy, stopAllAlgo,
  getAlgoPnlToday, exitAlgoPosition, getAlgoTradesHistory,
} from '../api/index.js'

// ── tiny helpers ──────────────────────────────────────────────────────────────
function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-[#152031] rounded ${className}`} />
}

function Badge({ type }) {
  const map = {
    WIN:    'bg-[#46f1c5]/20 text-[#46f1c5]',
    LOSS:   'bg-[#ffb4ab]/20 text-[#ffb4ab]',
    PAPER:  'bg-[#ffa858]/20 text-[#ffa858]',
    OPEN:   'bg-[#00d4aa]/10 text-[#00d4aa]',
    CLOSED: 'bg-[#2a3548] text-[#bacac2]',
  }
  return (
    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider ${map[type] || map.CLOSED}`}>
      {type}
    </span>
  )
}

function Toast({ msg, onClose }) {
  useEffect(() => { if (msg) { const t = setTimeout(onClose, 3500); return () => clearTimeout(t) } }, [msg, onClose])
  if (!msg) return null
  return (
    <div className="fixed bottom-6 right-6 bg-[#1f2a3c] border border-[#46f1c5]/30 px-5 py-3 rounded-lg text-sm text-[#d8e3fb] z-50 shadow-xl flex items-center gap-2 animate-fade-in">
      <span className="material-symbols-outlined text-[#46f1c5] text-[16px]">check_circle</span>
      {msg}
    </div>
  )
}

// ── component ─────────────────────────────────────────────────────────────────
export default function Algo() {
  const navigate = useNavigate()

  const [strategies,    setStrategies]    = useState([])
  const [positions,     setPositions]     = useState([])
  const [trades,        setTrades]        = useState([])
  const [history,       setHistory]       = useState([])
  const [pnlToday,      setPnlToday]      = useState(null)
  const [selected,      setSelected]      = useState(null)
  const [loading,       setLoading]       = useState(true)
  const [stopBanner,    setStopBanner]    = useState(false)
  const [lossLimitBanner, setLossLimitBanner] = useState(null) // { strategy_name, pnl }
  const [toast,         setToast]         = useState('')
  const [activeTab,     setActiveTab]     = useState('positions') // positions | history
  const [newTradeIds,   setNewTradeIds]   = useState(new Set())
  const [exiting,       setExiting]       = useState(null)
  const [confirmExit,   setConfirmExit]   = useState(null) // position to confirm
  const [tradesCount,   setTradesCount]   = useState(0)

  // Strategy form
  const [mode,        setMode]        = useState('PAPER')
  const [stratName,   setStratName]   = useState('')
  const [universe,    setUniverse]    = useState('Nifty 50')
  const [timeframe,   setTimeframe]   = useState('5 Minutes')
  const [targetPct,   setTargetPct]   = useState('2.0')
  const [slPct,       setSlPct]       = useState('1.0')
  const [trailPct,    setTrailPct]    = useState('0.5')
  const [maxHold,     setMaxHold]     = useState('Intraday (3:15 PM)')
  const [maxAlloc,    setMaxAlloc]    = useState('500000')
  const [maxTrades,   setMaxTrades]   = useState(5)
  const [dailyLimit,  setDailyLimit]  = useState('5000')

  const socketRef = useRef(null)

  // ── data loading ─────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    try {
      const [sRes, pRes, tRes, pnlRes, hRes] = await Promise.allSettled([
        getAlgoStrategies(),
        getAlgoPositions(),
        getAlgoTrades(),
        getAlgoPnlToday(),
        getAlgoTradesHistory(),
      ])

      const strats  = sRes.status  === 'fulfilled' ? (sRes.value.data  ?? []) : []
      const pos     = pRes.status  === 'fulfilled' ? (pRes.value.data  ?? []) : []
      const trds    = tRes.status  === 'fulfilled' ? (tRes.value.data  ?? []) : []
      const pnl     = pnlRes.status=== 'fulfilled' ? (pnlRes.value.data ?? null) : null
      const hist    = hRes.status  === 'fulfilled' ? (hRes.value.data  ?? []) : []

      setStrategies(strats)
      setPositions(pos)
      setTrades(trds)
      setPnlToday(pnl)
      setHistory(hist)

      if (!selected && strats.length > 0) {
        setSelected(strats[0])
        prefillForm(strats[0])
      }
    } catch (e) {
      console.error('Algo load error', e)
    } finally {
      setLoading(false)
    }
  }, [selected])

  const prefillForm = s => {
    setStratName(s.name ?? '')
    setMode(s.mode ?? 'PAPER')
    setMaxAlloc(String(s.capital ?? 500000))
    setMaxTrades(s.max_trades ?? 5)
  }

  // ── socket.io ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    loadAll()

    const socket = io('http://localhost:5000', { transports: ['websocket'] })
    socketRef.current = socket

    // All strategies paused (emergency stop)
    socket.on('algo_stopped', () => {
      setStopBanner(true)
      setStrategies(prev => prev.map(s => ({ ...s, status: 'PAUSED' })))
    })

    // New trade entered — add to positions with green flash
    socket.on('new_algo_trade', (trade) => {
      setPositions(prev => {
        const exists = prev.find(p => p.id === trade.id)
        if (exists) return prev
        return [trade, ...prev]
      })
      setNewTradeIds(prev => new Set([...prev, trade.id]))
      setTimeout(() => setNewTradeIds(p => { const n = new Set(p); n.delete(trade.id); return n }), 2500)
      setTradesCount(c => c + 1)
      getAlgoPnlToday().then(r => setPnlToday(r.data)).catch(() => {})
      showToast(`New trade: ${trade.symbol} LONG ${trade.qty} @ ₹${trade.entry_price?.toFixed(2)}`)
    })

    // Trade closed — remove from positions, add to history
    socket.on('algo_trade_closed', (trade) => {
      setPositions(prev => prev.filter(p => p.id !== trade.id))
      setHistory(prev => [{ ...trade, badge: trade.pnl >= 0 ? 'WIN' : 'LOSS' }, ...prev])
      getAlgoPnlToday().then(r => setPnlToday(r.data)).catch(() => {})
      const badge = trade.pnl >= 0 ? '🟢 WIN' : '🔴 LOSS'
      showToast(`${badge} ${trade.symbol} closed @ ₹${trade.exit_price?.toFixed(2)} | P&L ₹${trade.pnl?.toFixed(0)}`)
    })

    // Daily loss limit breached
    socket.on('daily_loss_limit_reached', (data) => {
      setLossLimitBanner(data)
      setStrategies(prev => prev.map(s =>
        s.id === data.strategy_id ? { ...s, status: 'PAUSED' } : s
      ))
    })

    return () => socket.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── actions ───────────────────────────────────────────────────────────────────
  const handleToggle = async (id) => {
    try {
      const { data } = await toggleStrategy(id)
      setStrategies(prev => prev.map(s =>
        s.id === id ? { ...s, status: data.status ?? (s.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE') } : s
      ))
      showToast('Strategy updated')
    } catch {
      showToast('Failed to toggle strategy')
    }
  }

  const handleSave = async () => {
    try {
      await saveAlgoStrategy({
        name: stratName, mode, universe, timeframe,
        target_pct: +targetPct, sl_pct: +slPct, trail_pct: +trailPct,
        max_hold: maxHold, capital: +maxAlloc, max_trades: +maxTrades,
        daily_loss_limit: +dailyLimit,
      })
      showToast('Strategy saved!')
      loadAll()
    } catch {
      showToast('Failed to save strategy')
    }
  }

  const handleStopAll = async () => {
    if (!window.confirm('Stop ALL running strategies? This will pause all active algo trading.')) return
    try {
      await stopAllAlgo()
      setStopBanner(true)
      setStrategies(prev => prev.map(s => ({ ...s, status: 'PAUSED' })))
      showToast('All strategies stopped')
    } catch {
      showToast('Failed to stop all')
    }
  }

  const requestExit = (pos) => setConfirmExit(pos)

  const confirmExitAction = async () => {
    if (!confirmExit) return
    const pos = confirmExit
    setConfirmExit(null)
    setExiting(pos.id)
    try {
      await exitAlgoPosition(pos.id)
      setPositions(prev => prev.filter(p => p.id !== pos.id))
      showToast(`Exited ${pos.symbol} position`)
      getAlgoPnlToday().then(r => setPnlToday(r.data)).catch(() => {})
      getAlgoTradesHistory().then(r => setHistory(r.data ?? [])).catch(() => {})
    } catch {
      showToast('Failed to exit position')
    } finally {
      setExiting(null)
    }
  }

  const showToast = msg => setToast(msg)

  const totalPnl    = pnlToday?.total_pnl ?? positions.reduce((s, p) => s + (p.pnl ?? 0), 0)
  const activeStrat = strategies.find(s => s.status === 'ACTIVE')
  const execCount   = pnlToday?.trades_today ?? tradesCount

  // ── render ────────────────────────────────────────────────────────────────────
  return (
    <main className="h-[calc(100vh-9rem)] w-full flex gap-4 p-4 box-border overflow-hidden">

      {/* ── Paper trading warning banner ── */}
      <div className="fixed top-14 left-0 w-full h-8 bg-[#ffa858] text-[#733e00] flex items-center justify-center text-[11px] font-bold uppercase tracking-wide z-20 shadow-md">
        <span className="material-symbols-outlined text-[16px] mr-2">warning</span>
        ⚠ PAPER TRADING ACTIVE — No real orders being placed
      </div>

      {/* ── Emergency stop banner ── */}
      {stopBanner && (
        <div className="fixed top-22 left-0 w-full h-8 bg-[#ffb4ab]/90 text-[#690005] flex items-center justify-center text-[11px] font-bold uppercase z-20 gap-2">
          <span className="material-symbols-outlined text-[16px]">stop_circle</span>
          ALL STRATEGIES PAUSED — Emergency stop activated
          <button onClick={() => setStopBanner(false)} className="ml-4 underline text-[10px]">Dismiss</button>
        </div>
      )}

      {/* ── Daily loss limit breached banner ── */}
      {lossLimitBanner && (
        <div className="fixed top-22 left-0 w-full bg-[#3f0003]/95 border-b-2 border-[#ff4444] text-[#ffdad6] flex items-center justify-center text-[11px] font-bold uppercase z-30 gap-2 py-2">
          <span className="material-symbols-outlined text-[16px] text-[#ff4444]">block</span>
          Daily loss limit reached for&nbsp;<span className="text-white">{lossLimitBanner.strategy_name}</span>.
          All strategies paused automatically. (₹{Math.abs(lossLimitBanner.pnl ?? 0).toLocaleString('en-IN')})
          <button onClick={() => setLossLimitBanner(null)} className="ml-4 underline text-[10px]">Dismiss</button>
        </div>
      )}

      {/* ── Confirm exit modal ── */}
      {confirmExit && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-[#111c2d] border border-[#ffb4ab]/40 rounded-xl p-6 w-[320px] shadow-2xl">
            <h3 className="text-[#d8e3fb] font-bold mb-2">Confirm Exit</h3>
            <p className="text-[#bacac2] text-sm mb-5">
              Exit <span className="text-white font-bold">{confirmExit.symbol}</span> paper position
              at <span className="text-[#46f1c5] font-mono">₹{confirmExit.current_price?.toLocaleString('en-IN') ?? '—'}</span>?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmExit(null)}
                className="px-4 py-2 rounded text-sm border border-[#2a3548] text-[#bacac2] hover:text-[#d8e3fb] transition-colors"
              >Cancel</button>
              <button
                onClick={confirmExitAction}
                className="px-4 py-2 rounded text-sm font-bold bg-[#ffb4ab]/20 text-[#ffb4ab] border border-[#ffb4ab]/50 hover:bg-[#ffb4ab]/30 transition-colors"
              >Exit Position</button>
            </div>
          </div>
        </div>
      )}

      <Toast msg={toast} onClose={() => setToast('')} />

      <div className="mt-8 w-full flex gap-4 h-full">

        {/* ── LEFT: Strategy list ── */}
        <section className="w-3/12 bg-[#111c2d] border border-[#2a3548] rounded-lg flex flex-col overflow-hidden">
          <div className="p-4 border-b border-[#2a3548] flex justify-between items-center bg-[#152031]/50">
            <h2 className="text-[11px] font-bold uppercase text-[#bacac2]">Strategy Builder</h2>
            <button
              onClick={() => { setSelected(null); setStratName('New Strategy'); setMode('PAPER') }}
              className="flex items-center gap-1 text-[#00d4aa] hover:text-[#28dfb5] transition-colors text-xs font-semibold"
            >
              <span className="material-symbols-outlined text-[14px]">add</span> New
            </button>
          </div>
          <div className="p-4 overflow-y-auto flex-grow flex flex-col gap-2">
            {loading ? (
              [...Array(2)].map((_, i) => <Skeleton key={i} className="h-24" />)
            ) : (
              strategies.map(s => {
                const isActive = s.status === 'ACTIVE'
                return (
                  <div
                    key={s.id}
                    className={`bg-[#152031] border rounded p-3 hover:bg-[#1f2a3c] transition-colors cursor-pointer relative overflow-hidden
                      ${selected?.id === s.id ? 'border-[#00d4aa]/40' : isActive ? 'border-[#46f1c5]/30' : 'border-[#2a3548]'}`}
                    onClick={() => { setSelected(s); prefillForm(s) }}
                  >
                    {isActive && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-[#46f1c5]" />}
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <h3 className={`text-[15px] font-semibold ${isActive ? 'text-[#d8e3fb]' : 'text-[#d8e3fb] opacity-70'}`}>{s.name}</h3>
                        <div className="flex gap-2 mt-1">
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider ${isActive ? 'bg-[#46f1c5]/20 text-[#46f1c5]' : 'bg-[#2a3548] text-[#bacac2]'}`}>
                            {s.status}
                          </span>
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#ffa858]/10 text-[#ffa858]">{s.mode}</span>
                        </div>
                      </div>
                      <button
                        className={`relative w-7 h-4 rounded-full border cursor-pointer transition-colors ${isActive ? 'bg-[#46f1c5]/20 border-[#46f1c5]' : 'bg-[#2a3548] border-[#3b4a44]'}`}
                        onClick={e => { e.stopPropagation(); handleToggle(s.id) }}
                      >
                        <div className={`absolute top-0.5 h-3 w-3 rounded-full transition-all ${isActive ? 'left-[calc(100%-14px)] bg-[#46f1c5]' : 'left-0.5 bg-[#bacac2]'}`} />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 font-mono text-[11px] text-[#bacac2]">
                      <div>
                        <span className="text-[9px] uppercase opacity-70 block">Today P&L</span>
                        <span className={s.today_pnl >= 0 ? 'text-[#46f1c5]' : 'text-[#ffb4ab]'}>
                          {s.today_pnl >= 0 ? '+' : ''}₹{(s.today_pnl ?? 0).toLocaleString('en-IN')}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[9px] uppercase opacity-70 block">Trades</span>
                        <span>{s.trades_today ?? 0}/{s.max_trades ?? 0}</span>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </section>

        {/* ── CENTER: Config ── */}
        <section className="w-5/12 bg-[#152031] border border-[#2a3548] rounded-lg flex flex-col overflow-hidden shadow-2xl">
          <div className="p-4 border-b border-[#2a3548] flex justify-between items-center bg-[#111c2d]">
            <h2 className="text-[11px] font-bold uppercase text-[#00d4aa]">Strategy Configuration</h2>
            <div className="flex bg-[#2a3548] rounded p-0.5">
              {['PAPER', 'LIVE'].map(m => (
                <button key={m} onClick={() => setMode(m)}
                  className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${mode === m ? 'bg-[#ffa858] text-[#733e00] shadow-sm' : 'text-[#bacac2] hover:text-[#d8e3fb]'}`}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div className="p-6 overflow-y-auto flex-grow flex flex-col gap-6">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide text-[#bacac2] mb-1.5">STRATEGY NAME</label>
              <input
                className="w-full bg-[#081425] border border-[#2a3548] rounded px-3 py-2 text-[#d8e3fb] text-sm focus:border-[#46f1c5] outline-none transition-all"
                value={stratName} onChange={e => setStratName(e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              {[
                { label: 'UNIVERSE', value: universe, setter: setUniverse, opts: ['Nifty 50', 'BankNifty', 'FnO Universe', 'Custom List'] },
                { label: 'TIMEFRAME', value: timeframe, setter: setTimeframe, opts: ['5 Minutes', '15 Minutes', '1 Hour', 'Daily'] },
              ].map(f => (
                <div key={f.label}>
                  <label className="block text-[11px] font-bold uppercase tracking-wide text-[#bacac2] mb-1.5">{f.label}</label>
                  <select
                    className="w-full bg-[#081425] border border-[#2a3548] rounded px-3 py-2 text-[#d8e3fb] text-sm focus:border-[#46f1c5] outline-none appearance-none"
                    value={f.value} onChange={e => f.setter(e.target.value)}>
                    {f.opts.map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
              ))}
            </div>

            <div className="bg-[#111c2d] border border-[#2a3548] rounded p-4">
              <h3 className="text-[11px] font-bold uppercase text-[#d8e3fb] mb-3">EXIT RULES</h3>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: 'Target Profit (%)', value: targetPct, setter: setTargetPct },
                  { label: 'Stop Loss (%)',      value: slPct,     setter: setSlPct },
                  { label: 'Trailing SL (%)',    value: trailPct,  setter: setTrailPct },
                ].map(f => (
                  <div key={f.label}>
                    <label className="block text-[10px] uppercase tracking-wider text-[#bacac2] mb-1">{f.label}</label>
                    <input
                      className="w-full bg-[#081425] border border-[#2a3548] rounded px-3 py-1.5 text-[#d8e3fb] font-mono text-sm focus:border-[#46f1c5] outline-none"
                      value={f.value} onChange={e => f.setter(e.target.value)} />
                  </div>
                ))}
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-[#bacac2] mb-1">Max Hold Time</label>
                  <select
                    className="w-full bg-[#081425] border border-[#2a3548] rounded px-3 py-1.5 text-[#d8e3fb] text-sm focus:border-[#46f1c5] outline-none appearance-none"
                    value={maxHold} onChange={e => setMaxHold(e.target.value)}>
                    <option>Intraday (3:15 PM)</option>
                    <option>None</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="bg-[#111c2d] border border-[#2a3548] rounded p-4">
              <h3 className="text-[11px] font-bold uppercase text-[#d8e3fb] mb-3">CAPITAL &amp; RISK</h3>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-[#bacac2] mb-1">Max Allocation</label>
                  <div className="relative">
                    <span className="absolute left-2 top-1.5 text-[#bacac2] text-sm font-mono">₹</span>
                    <input
                      className="w-full bg-[#081425] border border-[#2a3548] rounded pl-6 pr-2 py-1.5 text-[#d8e3fb] font-mono text-sm focus:border-[#46f1c5] outline-none"
                      value={maxAlloc} onChange={e => setMaxAlloc(e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-[#bacac2] mb-1">Max Trades/Day</label>
                  <input type="number"
                    className="w-full bg-[#081425] border border-[#2a3548] rounded px-3 py-1.5 text-[#d8e3fb] font-mono text-sm focus:border-[#46f1c5] outline-none"
                    value={maxTrades} onChange={e => setMaxTrades(+e.target.value)} />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-[#ffb4ab] mb-1">Daily Loss Limit</label>
                  <div className="relative">
                    <span className="absolute left-2 top-1.5 text-[#ffb4ab] text-sm font-mono">₹</span>
                    <input
                      className="w-full bg-[#ffb4ab]/10 border border-[#ffb4ab]/50 rounded pl-6 pr-2 py-1.5 text-[#ffb4ab] font-mono text-sm focus:border-[#ffb4ab] outline-none"
                      value={dailyLimit} onChange={e => setDailyLimit(e.target.value)} />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="p-4 border-t border-[#2a3548] bg-[#111c2d] flex justify-end gap-3">
            <button onClick={() => navigate('/backtest')}
              className="px-6 py-2 rounded text-sm font-semibold border border-[#2a3548] text-[#bacac2] hover:text-[#d8e3fb] hover:bg-[#152031] transition-colors">
              BACKTEST
            </button>
            <button onClick={handleSave}
              className="px-6 py-2 rounded text-sm font-semibold bg-[#46f1c5] text-[#00382b] hover:bg-[#28dfb5] transition-colors shadow-[0_0_15px_rgba(70,241,197,0.2)]">
              SAVE STRATEGY
            </button>
          </div>
        </section>

        {/* ── RIGHT: Monitor ── */}
        <section className="w-4/12 flex flex-col gap-2 overflow-hidden">

          {/* Metrics */}
          <div className="bg-[#111c2d] border border-[#2a3548] rounded-lg p-4 flex flex-col gap-4 shrink-0">
            <div className="flex justify-between items-center border-b border-[#2a3548] pb-3">
              <h2 className="text-[11px] font-bold uppercase text-[#d8e3fb]">LIVE EXECUTION MONITOR</h2>
              <span className="flex items-center gap-1 text-[10px] font-bold text-[#ffa858] bg-[#ffa858]/10 px-2 py-0.5 rounded border border-[#ffa858]/20">
                <span className="w-1.5 h-1.5 rounded-full bg-[#ffa858] animate-pulse" /> PAPER RUNNING
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {/* Today's P&L (real) */}
              <div className="bg-[#081425] border border-[#2a3548] rounded p-3 flex flex-col justify-center items-center">
                <span className="text-[10px] text-[#bacac2] uppercase tracking-wider mb-1">Today's P&L (Paper)</span>
                <span className={`font-mono text-xl font-bold ${totalPnl >= 0 ? 'text-[#46f1c5]' : 'text-[#ffb4ab]'}`}>
                  {totalPnl >= 0 ? '+' : ''}₹{Math.abs(totalPnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </span>
                {pnlToday && (
                  <div className="flex gap-2 mt-1 text-[9px]">
                    <span className="text-[#46f1c5]">R ₹{pnlToday.realized_pnl?.toFixed(0)}</span>
                    <span className="text-[#bacac2]">|</span>
                    <span className={pnlToday.unrealized_pnl >= 0 ? 'text-[#00d4aa]' : 'text-[#ffa858]'}>
                      U ₹{pnlToday.unrealized_pnl?.toFixed(0)}
                    </span>
                  </div>
                )}
              </div>
              {/* Trades executed counter */}
              <div className="bg-[#081425] border border-[#2a3548] rounded p-3 flex flex-col justify-center items-center">
                <span className="text-[10px] text-[#bacac2] uppercase tracking-wider mb-1">Trades Executed</span>
                <span className="font-mono text-xl text-[#d8e3fb] font-bold">
                  {activeStrat ? `${activeStrat.trades_today ?? execCount} / ${activeStrat.max_trades ?? 0}` : `${execCount} / —`}
                </span>
                <span className="text-[9px] text-[#bacac2] mt-1">{positions.length} open</span>
              </div>
            </div>
            <button onClick={handleStopAll}
              className="w-full bg-[#3f0003] hover:bg-[#690005] border border-[#ffb4ab] text-[#ffb4ab] py-2.5 rounded text-[11px] font-bold uppercase tracking-[0.2em] transition-colors flex items-center justify-center gap-2">
              <span className="material-symbols-outlined text-[16px]">stop_circle</span> EMERGENCY STOP ALL
            </button>
          </div>

          {/* Tabs: Positions | History */}
          <div className="bg-[#111c2d] border border-[#2a3548] rounded-lg flex-grow flex flex-col overflow-hidden">
            <div className="flex border-b border-[#2a3548] bg-[#152031]">
              {[
                { key: 'positions', label: `OPEN (${positions.length})` },
                { key: 'history',   label: `HISTORY (${history.length})` },
              ].map(tab => (
                <button key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider transition-colors border-b-2 ${
                    activeTab === tab.key
                      ? 'border-[#46f1c5] text-[#46f1c5]'
                      : 'border-transparent text-[#bacac2] hover:text-[#d8e3fb]'
                  }`}>
                  {tab.label}
                </button>
              ))}
            </div>

            {activeTab === 'positions' ? (
              <div className="overflow-y-auto flex-grow">
                {positions.length === 0 ? (
                  <div className="p-6 text-center text-xs text-[#bacac2] flex flex-col items-center gap-2">
                    <span className="material-symbols-outlined text-[24px] text-[#2a3548]">analytics</span>
                    No open positions — engine scanning for signals
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#2a3548] bg-[#081425] text-[10px] uppercase tracking-wider text-[#bacac2]">
                        {['Symbol', 'Entry', 'LTP', 'Unreal.', 'Act'].map(h => (
                          <th key={h} className={`py-2 px-2 font-medium ${['Entry','LTP','Unreal.'].includes(h) ? 'text-right' : h === 'Act' ? 'text-center' : ''}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="font-mono text-xs divide-y divide-[#2a3548]">
                      {positions.map(pos => {
                        const isNew  = newTradeIds.has(pos.id)
                        const upnl   = pos.unrealized_pnl ?? pos.pnl ?? 0
                        return (
                          <tr key={pos.id}
                            className={`transition-all duration-500 ${isNew ? 'bg-[#46f1c5]/10 animate-pulse' : 'hover:bg-[#152031]'}`}>
                            <td className="py-2 px-2">
                              <div className="flex flex-col">
                                <span className="text-[#d8e3fb] font-semibold">{pos.symbol}</span>
                                <span className={`text-[9px] ${pos.side === 'LONG' ? 'text-[#46f1c5]' : 'text-[#ffb4ab]'}`}>
                                  {pos.side} (Paper)
                                </span>
                              </div>
                            </td>
                            <td className="py-2 px-2 text-right text-[#bacac2]">₹{pos.entry_price?.toLocaleString('en-IN')}</td>
                            <td className="py-2 px-2 text-right text-[#d8e3fb]">₹{pos.current_price?.toLocaleString('en-IN')}</td>
                            <td className={`py-2 px-2 text-right font-semibold ${upnl >= 0 ? 'text-[#46f1c5]' : 'text-[#ffb4ab]'}`}>
                              {upnl >= 0 ? '+' : ''}₹{Math.abs(upnl).toFixed(0)}
                            </td>
                            <td className="py-2 px-2 text-center">
                              <button
                                disabled={exiting === pos.id}
                                onClick={() => requestExit(pos)}
                                className="text-[#ffb4ab] hover:text-[#ffdad6] bg-[#ffb4ab]/10 hover:bg-[#ffb4ab]/20 px-2 py-1 rounded text-[10px] uppercase font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                                {exiting === pos.id ? '...' : 'EXIT'}
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            ) : (
              /* History tab */
              <div className="overflow-y-auto flex-grow">
                {history.length === 0 ? (
                  <div className="p-6 text-center text-xs text-[#bacac2] flex flex-col items-center gap-2">
                    <span className="material-symbols-outlined text-[24px] text-[#2a3548]">history</span>
                    No closed trades yet
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#2a3548] bg-[#081425] text-[10px] uppercase tracking-wider text-[#bacac2]">
                        <th className="py-2 px-2 font-medium">Symbol</th>
                        <th className="py-2 px-2 font-medium text-right">Entry</th>
                        <th className="py-2 px-2 font-medium text-right">Exit</th>
                        <th className="py-2 px-2 font-medium text-right">P&L</th>
                        <th className="py-2 px-2 font-medium text-center">Result</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono text-xs divide-y divide-[#2a3548]">
                      {history.slice(0, 30).map((t, i) => {
                        const pnl = t.pnl ?? 0
                        const badge = pnl >= 0 ? 'WIN' : 'LOSS'
                        return (
                          <tr key={t.id || i} className="hover:bg-[#152031] transition-colors">
                            <td className="py-2 px-2">
                              <div className="flex flex-col">
                                <span className="text-[#d8e3fb] font-semibold">{t.symbol}</span>
                                <span className="text-[9px] text-[#bacac2]">{t.exit_reason?.replace(/_/g, ' ')}</span>
                              </div>
                            </td>
                            <td className="py-2 px-2 text-right text-[#bacac2]">₹{t.entry_price?.toLocaleString('en-IN')}</td>
                            <td className="py-2 px-2 text-right text-[#d8e3fb]">₹{t.exit_price?.toLocaleString('en-IN')}</td>
                            <td className={`py-2 px-2 text-right font-semibold ${pnl >= 0 ? 'text-[#46f1c5]' : 'text-[#ffb4ab]'}`}>
                              {pnl >= 0 ? '+' : ''}₹{Math.abs(pnl).toFixed(0)}
                            </td>
                            <td className="py-2 px-2 text-center">
                              <Badge type={badge} />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}
