import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { io } from 'socket.io-client'
import {
  getAlgoRegistry, getAlgoAlignments, getAlgoPositions,
  getAlgoTradesHistory, getAlgoPnlToday, triggerAlgoScan,
  activateStrategy, deactivateStrategy, exitAlgoPosition,
  placeManualTrade, stopAllAlgo, getBrokerStatus,
} from '../api/index.js'

// ── Tiny helpers ──────────────────────────────────────────────────────────────
function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-[#152031] rounded ${className}`} />
}

function Toast({ msg, type = 'info', onClose }) {
  useEffect(() => {
    if (msg) { const t = setTimeout(onClose, 3500); return () => clearTimeout(t) }
  }, [msg, onClose])
  if (!msg) return null
  const color = type === 'error' ? 'border-[#ffb4ab]/40 text-[#ffb4ab]' : 'border-[#46f1c5]/30 text-[#d8e3fb]'
  const icon  = type === 'error' ? 'error' : 'check_circle'
  const icolor = type === 'error' ? 'text-[#ffb4ab]' : 'text-[#46f1c5]'
  return (
    <div className={`fixed bottom-6 right-6 bg-[#1f2a3c] border ${color} px-5 py-3 rounded-lg text-sm z-50 shadow-xl flex items-center gap-2 animate-fade-in`}>
      <span className={`material-symbols-outlined text-[16px] ${icolor}`}>{icon}</span>
      {msg}
    </div>
  )
}

const RISK_COLOR = {
  conservative: 'bg-[#46f1c5]/15 text-[#46f1c5] border-[#46f1c5]/30',
  moderate:     'bg-[#ffa858]/15 text-[#ffa858] border-[#ffa858]/30',
  aggressive:   'bg-[#ffb4ab]/15 text-[#ffb4ab] border-[#ffb4ab]/30',
}

function ScoreBar({ score }) {
  const color = score >= 85 ? '#46f1c5' : score >= 70 ? '#ffa858' : '#ffb4ab'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-[#2a3548] rounded-full h-1.5">
        <div className="h-1.5 rounded-full transition-all" style={{ width: `${score}%`, background: color }} />
      </div>
      <span className="text-[10px] font-mono font-bold shrink-0" style={{ color }}>{score}%</span>
    </div>
  )
}

// ── Strategy detail drawer ─────────────────────────────────────────────────────
function StrategyDrawer({ strategy, onClose, onActivate, onDeactivate }) {
  const [params, setParams] = useState({ ...strategy.parameters })
  const [saving, setSaving] = useState(false)

  const isActive = strategy.status === 'ACTIVE'

  const handleToggle = async () => {
    setSaving(true)
    try {
      if (isActive) await onDeactivate(strategy.id)
      else          await onActivate(strategy.id, { mode: strategy.mode, capital: strategy.capital })
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-end sm:items-center justify-center z-50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[#111c2d] border border-[#2a3548] rounded-t-2xl sm:rounded-xl w-full sm:max-w-xl max-h-[85vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-[#2a3548] flex items-start justify-between sticky top-0 bg-[#111c2d] z-10">
          <div>
            <h2 className="text-[#d8e3fb] font-bold text-base">{strategy.name}</h2>
            <div className="flex gap-2 mt-1">
              <span className={`px-2 py-0.5 rounded text-[9px] font-bold border ${RISK_COLOR[strategy.risk_profile] || RISK_COLOR.moderate}`}>
                {strategy.risk_profile?.toUpperCase()}
              </span>
              <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-[#46f1c5]/10 border border-[#46f1c5]/30 text-[#46f1c5]">
                {strategy.win_rate} WIN RATE
              </span>
            </div>
          </div>
          <button onClick={onClose} className="text-[#bacac2] hover:text-[#d8e3fb] transition-colors">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <div className="p-5 flex flex-col gap-5">
          {/* Description */}
          <p className="text-sm text-[#bacac2] leading-relaxed">{strategy.description}</p>

          {/* When to use */}
          <div className="bg-[#00382b]/40 border border-[#46f1c5]/20 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="material-symbols-outlined text-[#46f1c5] text-[15px]">check_circle</span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#46f1c5]">When to Use</span>
            </div>
            <p className="text-sm text-[#d8e3fb] leading-relaxed">{strategy.when_to_use}</p>
          </div>

          {/* When NOT to use */}
          <div className="bg-[#3f1500]/40 border border-[#ffa858]/20 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="material-symbols-outlined text-[#ffa858] text-[15px]">warning</span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#ffa858]">When NOT to Use</span>
            </div>
            <p className="text-sm text-[#d8e3fb] leading-relaxed">{strategy.when_not_to_use}</p>
          </div>

          {/* Best stocks */}
          <div className="bg-[#1f2a3c] border border-[#2a3548] rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="material-symbols-outlined text-[#c0c6db] text-[15px]">star</span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#c0c6db]">Best Stocks for This Strategy</span>
            </div>
            <p className="text-sm text-[#bacac2] leading-relaxed">{strategy.best_stocks}</p>
          </div>

          {/* Parameters */}
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#bacac2] mb-3">Parameters</div>
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(params).map(([key, val]) => (
                typeof val !== 'boolean' ? (
                  <div key={key} className="bg-[#152031] border border-[#2a3548] rounded p-2.5">
                    <label className="text-[9px] uppercase tracking-wider text-[#bacac2] block mb-1">
                      {key.replace(/_/g, ' ')}
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={val}
                      onChange={e => setParams(prev => ({ ...prev, [key]: parseFloat(e.target.value) || val }))}
                      className="w-full bg-[#081425] text-[#d8e3fb] font-mono text-sm px-2 py-1 rounded border border-[#2a3548] focus:border-[#46f1c5] outline-none"
                    />
                  </div>
                ) : (
                  <div key={key} className="bg-[#152031] border border-[#2a3548] rounded p-2.5 flex items-center justify-between">
                    <span className="text-[9px] uppercase tracking-wider text-[#bacac2]">{key.replace(/_/g, ' ')}</span>
                    <span className={`text-xs font-bold ${val ? 'text-[#46f1c5]' : 'text-[#bacac2]'}`}>{val ? 'ON' : 'OFF'}</span>
                  </div>
                )
              ))}
            </div>
          </div>

          {/* Activate / Deactivate */}
          <button
            onClick={handleToggle}
            disabled={saving}
            className={`w-full py-3 rounded-lg text-sm font-bold uppercase tracking-wider transition-colors disabled:opacity-50 ${
              isActive
                ? 'bg-[#ffb4ab]/10 border border-[#ffb4ab]/50 text-[#ffb4ab] hover:bg-[#ffb4ab]/20'
                : 'bg-[#46f1c5] text-[#00382b] hover:bg-[#28dfb5]'
            }`}
          >
            {saving ? 'Updating…' : isActive ? 'Pause Strategy' : 'Activate Strategy'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Live trading confirmation modal ───────────────────────────────────────────
function LiveConfirmModal({ brokerName, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-[#111c2d] border border-[#ffb4ab]/40 rounded-xl p-6 w-[340px] shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <span className="material-symbols-outlined text-[#ffb4ab] text-[24px]">warning</span>
          <h3 className="text-[#d8e3fb] font-bold">Switch to LIVE Trading</h3>
        </div>
        <div className="bg-[#3f0003]/60 border border-[#ffb4ab]/30 rounded-lg p-3 mb-4 text-sm text-[#ffdad6]">
          <p className="mb-2">Real orders will be placed with real money.</p>
          <p className="mb-2">Make sure your broker API is configured.</p>
          <p className="text-[#ffb4ab] font-bold">Current broker: <span className="uppercase">{brokerName}</span></p>
        </div>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-2 rounded text-sm border border-[#2a3548] text-[#bacac2] hover:text-[#d8e3fb] transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm} className="flex-1 py-2 rounded text-sm font-bold bg-[#ffb4ab]/20 text-[#ffb4ab] border border-[#ffb4ab]/50 hover:bg-[#ffb4ab]/30 transition-colors">
            Confirm LIVE Trading
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Alignment card in centre column ───────────────────────────────────────────
function AlignmentCard({ alignment, onActivate }) {
  const [placing, setPlacing] = useState(false)
  const rr = alignment.risk_reward || '1:2'
  const scoreColor = alignment.alignment_score >= 85 ? '#46f1c5' : '#ffa858'

  const handleActivate = async () => {
    setPlacing(true)
    try { await onActivate(alignment) }
    finally { setPlacing(false) }
  }

  return (
    <div className="bg-[#152031] border border-[#2a3548] rounded-lg p-3 hover:border-[#00d4aa]/30 transition-colors">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold text-[#d8e3fb] text-sm">{alignment.symbol}</span>
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#ffa858]/10 border border-[#ffa858]/20 text-[#ffa858]">
            {alignment.strategy_name}
          </span>
        </div>
        <span className="font-mono text-sm font-bold" style={{ color: scoreColor }}>
          {alignment.alignment_score}%
        </span>
      </div>

      <ScoreBar score={alignment.alignment_score} />

      {/* Reasons */}
      <div className="mt-2 flex flex-col gap-0.5">
        {(alignment.reasons || []).slice(0, 2).map((r, i) => (
          <div key={i} className="flex items-start gap-1.5">
            <span className="text-[#46f1c5] text-[10px] mt-0.5 shrink-0">▸</span>
            <span className="text-[10px] text-[#bacac2]">{r}</span>
          </div>
        ))}
      </div>

      {/* Entry / SL / Target */}
      <div className="mt-2 grid grid-cols-3 gap-1 text-center">
        {[
          { label: 'Entry', val: alignment.entry_price, color: '#d8e3fb' },
          { label: 'SL',    val: alignment.suggested_sl,     color: '#ffb4ab' },
          { label: 'Target',val: alignment.suggested_target, color: '#46f1c5' },
        ].map(({ label, val, color }) => (
          <div key={label} className="bg-[#081425] rounded p-1.5">
            <div className="text-[8px] uppercase text-[#4a5568] mb-0.5">{label}</div>
            <div className="font-mono text-[11px] font-bold" style={{ color }}>
              ₹{val?.toLocaleString('en-IN', { minimumFractionDigits: 0 }) ?? '—'}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between">
        <span className="text-[9px] text-[#4a5568]">R:R {rr}</span>
        <button
          disabled={placing}
          onClick={handleActivate}
          className="px-3 py-1 bg-[#00d4aa] text-[#005643] rounded text-[10px] font-bold hover:bg-[#46f1c5] transition-colors disabled:opacity-50"
        >
          {placing ? '…' : 'ACTIVATE TRADE'}
        </button>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function Algo() {
  const navigate = useNavigate()

  // ── state ────────────────────────────────────────────────────────────────
  const [strategies,    setStrategies]    = useState([])
  const [alignments,    setAlignments]    = useState([])
  const [positions,     setPositions]     = useState([])
  const [history,       setHistory]       = useState([])
  const [pnlToday,      setPnlToday]      = useState(null)
  const [marketCtx,     setMarketCtx]     = useState(null)
  const [alertFeed,     setAlertFeed]     = useState([])
  const [loading,       setLoading]       = useState(true)
  const [scanning,      setScanning]      = useState(false)
  const [lastScan,      setLastScan]      = useState(null)

  const [toast,         setToast]         = useState({ msg: '', type: 'info' })
  const [detailStrat,   setDetailStrat]   = useState(null)   // drawer open
  const [confirmExit,   setConfirmExit]   = useState(null)
  const [exiting,       setExiting]       = useState(null)
  const [newTradeIds,   setNewTradeIds]   = useState(new Set())

  // Mode
  const [tradingMode,   setTradingMode]   = useState('PAPER')
  const [showLiveModal, setShowLiveModal] = useState(false)
  const [brokerName,    setBrokerName]    = useState('yfinance')

  // Banners
  const [stopBanner,    setStopBanner]    = useState(false)
  const [lossLimitBanner, setLossLimitBanner] = useState(null)

  const socketRef = useRef(null)

  // ── data loading ──────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    try {
      const [sRes, aRes, pRes, hRes, pnlRes] = await Promise.allSettled([
        getAlgoRegistry(),
        getAlgoAlignments(),
        getAlgoPositions(),
        getAlgoTradesHistory(),
        getAlgoPnlToday(),
      ])

      if (sRes.status === 'fulfilled') {
        setStrategies(sRes.value.data?.strategies ?? [])
      }
      if (aRes.status === 'fulfilled') {
        const d = aRes.value.data
        setAlignments(d?.alignments ?? [])
        setLastScan(d?.last_scan ?? null)
      }
      if (pRes.status === 'fulfilled') setPositions(pRes.value.data ?? [])
      if (hRes.status === 'fulfilled') setHistory(hRes.value.data ?? [])
      if (pnlRes.status === 'fulfilled') setPnlToday(pnlRes.value.data ?? null)
    } catch (e) {
      console.error('Algo load error', e)
    } finally {
      setLoading(false)
    }
  }, [])

  // Fetch broker status on mount
  useEffect(() => {
    getBrokerStatus()
      .then(r => setBrokerName(r.data?.broker ?? 'yfinance'))
      .catch(() => {})
  }, [])

  // Poll positions every 30 s to update prices
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const r = await getAlgoPositions()
        setPositions(r.data ?? [])
      } catch {}
    }, 30_000)
    return () => clearInterval(id)
  }, [])

  // ── socket.io ─────────────────────────────────────────────────────────────
  useEffect(() => {
    loadAll()

    const socket = io('http://localhost:5000', { transports: ['websocket'] })
    socketRef.current = socket

    socket.on('algo_stopped', () => {
      setStopBanner(true)
      setStrategies(prev => prev.map(s => ({ ...s, status: 'PAUSED' })))
    })

    socket.on('new_algo_trade', trade => {
      setPositions(prev => {
        if (prev.find(p => p.id === trade.id)) return prev
        return [trade, ...prev]
      })
      setNewTradeIds(prev => new Set([...prev, trade.id]))
      setTimeout(() => setNewTradeIds(p => { const n = new Set(p); n.delete(trade.id); return n }), 2500)
      getAlgoPnlToday().then(r => setPnlToday(r.data)).catch(() => {})
      showToast(`New trade: ${trade.symbol} LONG ${trade.qty} @ ₹${trade.entry_price?.toFixed(2)}`)
    })

    socket.on('algo_trade_closed', trade => {
      setPositions(prev => prev.filter(p => p.id !== trade.id))
      setHistory(prev => [{ ...trade, badge: trade.pnl >= 0 ? 'WIN' : 'LOSS' }, ...prev])
      getAlgoPnlToday().then(r => setPnlToday(r.data)).catch(() => {})
      const badge = trade.pnl >= 0 ? '🟢 WIN' : '🔴 LOSS'
      showToast(`${badge} ${trade.symbol} closed @ ₹${trade.exit_price?.toFixed(2)} | ₹${trade.pnl?.toFixed(0)}`)
    })

    socket.on('daily_loss_limit_reached', data => {
      setLossLimitBanner(data)
      setStrategies(prev => prev.map(s =>
        s.instance_id === data.strategy_id || s.id === data.strategy_id
          ? { ...s, status: 'PAUSED' }
          : s
      ))
    })

    socket.on('strategy_alignments', data => {
      setAlignments(data.alignments ?? [])
      setLastScan(data.scan_time ?? null)
    })

    socket.on('strategy_alert', alert => {
      setAlertFeed(prev => [alert, ...prev].slice(0, 30))
    })

    socket.on('market_context', ctx => {
      setMarketCtx(ctx)
    })

    return () => socket.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── actions ───────────────────────────────────────────────────────────────
  const showToast = (msg, type = 'info') => setToast({ msg, type })

  const handleActivate = async (stratId, opts = {}) => {
    try {
      await activateStrategy(stratId, { mode: tradingMode, ...opts })
      setStrategies(prev => prev.map(s =>
        s.id === stratId ? { ...s, status: 'ACTIVE', mode: tradingMode } : s
      ))
      showToast('Strategy activated')
      loadAll()
    } catch { showToast('Failed to activate strategy', 'error') }
  }

  const handleDeactivate = async (stratId) => {
    try {
      await deactivateStrategy(stratId)
      setStrategies(prev => prev.map(s =>
        s.id === stratId ? { ...s, status: 'PAUSED' } : s
      ))
      showToast('Strategy paused')
    } catch { showToast('Failed to pause strategy', 'error') }
  }

  const handleAlignmentActivate = async (alignment) => {
    try {
      // Place paper trade for this alignment signal
      const r = await placeManualTrade({
        symbol: alignment.symbol,
        side:   'BUY',
        qty:    1,
        mode:   tradingMode.toLowerCase(),
      })
      setPositions(prev => [r.data, ...prev])
      showToast(`Paper trade placed: ${alignment.symbol} @ ₹${alignment.entry_price}`)
    } catch { showToast(`Failed to place trade for ${alignment.symbol}`, 'error') }
  }

  const handleScanNow = async () => {
    setScanning(true)
    try {
      const r = await triggerAlgoScan()
      setAlignments(r.data?.alignments ?? [])
      setLastScan(r.data?.scanned_at ?? new Date().toISOString())
      showToast(`Scan complete — ${r.data?.total ?? 0} alignments found`)
    } catch { showToast('Scan failed — ML service may be busy', 'error') }
    finally { setScanning(false) }
  }

  const handleStopAll = async () => {
    if (!window.confirm('Stop ALL running strategies? This will pause all active algo trading.')) return
    try {
      await stopAllAlgo()
      setStopBanner(true)
      setStrategies(prev => prev.map(s => ({ ...s, status: 'PAUSED' })))
      showToast('All strategies stopped')
    } catch { showToast('Failed to stop all', 'error') }
  }

  const requestExit = pos => setConfirmExit(pos)

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
    } catch { showToast('Failed to exit position', 'error') }
    finally { setExiting(null) }
  }

  const handleModeSwitch = async (newMode) => {
    if (newMode === 'LIVE') { setShowLiveModal(true); return }
    setTradingMode('PAPER')
  }

  const confirmLiveMode = () => {
    setTradingMode('LIVE')
    setShowLiveModal(false)
    showToast('Switched to LIVE trading mode — use with caution', 'error')
  }

  const totalPnl = pnlToday?.total_pnl ?? positions.reduce((s, p) => s + (p.pnl ?? 0), 0)

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <main className="flex flex-col h-[calc(100vh-4rem)] w-full overflow-hidden">

      {/* ── Modals ── */}
      {showLiveModal && (
        <LiveConfirmModal
          brokerName={brokerName}
          onConfirm={confirmLiveMode}
          onCancel={() => setShowLiveModal(false)}
        />
      )}
      {detailStrat && (
        <StrategyDrawer
          strategy={detailStrat}
          onClose={() => setDetailStrat(null)}
          onActivate={handleActivate}
          onDeactivate={handleDeactivate}
        />
      )}
      {confirmExit && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-[#111c2d] border border-[#ffb4ab]/40 rounded-xl p-6 w-[320px] shadow-2xl">
            <h3 className="text-[#d8e3fb] font-bold mb-2">Confirm Exit</h3>
            <p className="text-[#bacac2] text-sm mb-5">
              Exit <span className="text-white font-bold">{confirmExit.symbol}</span> at{' '}
              <span className="text-[#46f1c5] font-mono">₹{confirmExit.current_price?.toLocaleString('en-IN') ?? '—'}</span>?
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setConfirmExit(null)} className="px-4 py-2 rounded text-sm border border-[#2a3548] text-[#bacac2] hover:text-[#d8e3fb] transition-colors">Cancel</button>
              <button onClick={confirmExitAction} className="px-4 py-2 rounded text-sm font-bold bg-[#ffb4ab]/20 text-[#ffb4ab] border border-[#ffb4ab]/50 hover:bg-[#ffb4ab]/30 transition-colors">Exit Position</button>
            </div>
          </div>
        </div>
      )}

      <Toast msg={toast.msg} type={toast.type} onClose={() => setToast({ msg: '', type: 'info' })} />

      {/* ── Banners ── */}
      {lossLimitBanner && (
        <div className="flex-shrink-0 bg-[#3f0003]/95 border-b-2 border-[#ff4444] text-[#ffdad6] flex items-center justify-center text-[11px] font-bold uppercase z-30 gap-2 py-1.5">
          <span className="material-symbols-outlined text-[14px] text-[#ff4444]">block</span>
          Daily loss limit hit for <span className="text-white mx-1">{lossLimitBanner.strategy_name}</span>
          (₹{Math.abs(lossLimitBanner.pnl ?? 0).toLocaleString('en-IN')})
          <button onClick={() => setLossLimitBanner(null)} className="ml-4 underline text-[10px]">Dismiss</button>
        </div>
      )}
      {stopBanner && (
        <div className="flex-shrink-0 bg-[#ffb4ab]/90 text-[#690005] flex items-center justify-center text-[11px] font-bold uppercase z-20 gap-2 py-1.5">
          <span className="material-symbols-outlined text-[14px]">stop_circle</span>
          ALL STRATEGIES PAUSED — Emergency stop activated
          <button onClick={() => setStopBanner(false)} className="ml-4 underline text-[10px]">Dismiss</button>
        </div>
      )}

      {/* ── Paper/Live Mode Banner ── */}
      <div className={`flex-shrink-0 flex items-center justify-between px-4 py-2 text-[11px] font-bold uppercase ${
        tradingMode === 'LIVE'
          ? 'bg-[#3f0003] border-b border-[#ff4444] text-[#ffdad6]'
          : 'bg-[#ffa858] text-[#733e00]'
      }`}>
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[15px]">
            {tradingMode === 'LIVE' ? 'warning' : 'science'}
          </span>
          {tradingMode === 'LIVE'
            ? '⚠ LIVE TRADING ACTIVE — Real orders will be placed'
            : 'PAPER TRADING ACTIVE — No real orders being placed'}
        </div>
        <div className="flex bg-black/20 rounded p-0.5 gap-0.5">
          {['PAPER', 'LIVE'].map(m => (
            <button
              key={m}
              onClick={() => handleModeSwitch(m)}
              className={`px-3 py-0.5 rounded text-[10px] font-bold transition-colors ${
                tradingMode === m
                  ? 'bg-white/20 text-white shadow'
                  : 'text-current/60 hover:text-current/90'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* ── 3-column layout ── */}
      <div className="flex flex-1 gap-3 p-3 overflow-hidden">

        {/* ═══ LEFT (25%): Strategy Library ═══ */}
        <section className="w-[25%] flex flex-col bg-[#111c2d] border border-[#2a3548] rounded-lg overflow-hidden">
          <div className="p-3 border-b border-[#2a3548] bg-[#152031]/50 flex items-center justify-between shrink-0">
            <h2 className="text-[10px] font-bold uppercase text-[#bacac2]">Strategy Library</h2>
            <span className="text-[9px] text-[#4a5568]">5 strategies</span>
          </div>

          <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
            {loading
              ? [...Array(5)].map((_, i) => <Skeleton key={i} className="h-28" />)
              : strategies.map(s => {
                  const isActive = s.status === 'ACTIVE'
                  return (
                    <div
                      key={s.id}
                      className={`bg-[#152031] border rounded-lg p-3 cursor-pointer hover:bg-[#1a2840] transition-all relative overflow-hidden ${
                        isActive ? 'border-[#46f1c5]/40' : 'border-[#2a3548]'
                      }`}
                      onClick={() => setDetailStrat(s)}
                    >
                      {isActive && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-[#46f1c5]" />}

                      <div className="flex justify-between items-start mb-1.5">
                        <div className="flex-1 min-w-0 pr-2">
                          <h3 className="text-[13px] font-semibold text-[#d8e3fb] leading-tight">{s.name}</h3>
                          <div className="flex flex-wrap gap-1 mt-1">
                            <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold border ${RISK_COLOR[s.risk_profile] || RISK_COLOR.moderate}`}>
                              {s.risk_profile?.toUpperCase()}
                            </span>
                            <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${isActive ? 'bg-[#46f1c5]/15 text-[#46f1c5]' : 'bg-[#2a3548] text-[#bacac2]'}`}>
                              {s.status}
                            </span>
                          </div>
                        </div>
                        {/* Toggle */}
                        <button
                          className={`relative w-7 h-4 rounded-full border cursor-pointer transition-colors shrink-0 ${isActive ? 'bg-[#46f1c5]/20 border-[#46f1c5]' : 'bg-[#2a3548] border-[#3b4a44]'}`}
                          onClick={e => {
                            e.stopPropagation()
                            isActive ? handleDeactivate(s.id) : handleActivate(s.id)
                          }}
                        >
                          <div className={`absolute top-0.5 h-3 w-3 rounded-full transition-all ${isActive ? 'left-[calc(100%-14px)] bg-[#46f1c5]' : 'left-0.5 bg-[#bacac2]'}`} />
                        </button>
                      </div>

                      <p className="text-[10px] text-[#bacac2] line-clamp-2 leading-relaxed mb-2">{s.description}</p>

                      <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono">
                        <div className="bg-[#081425] rounded p-1.5">
                          <div className="text-[8px] text-[#4a5568] uppercase mb-0.5">Today P&L</div>
                          <div className={s.today_pnl >= 0 ? 'text-[#46f1c5]' : 'text-[#ffb4ab]'}>
                            {s.today_pnl >= 0 ? '+' : ''}₹{(s.today_pnl ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                          </div>
                        </div>
                        <div className="bg-[#081425] rounded p-1.5">
                          <div className="text-[8px] text-[#4a5568] uppercase mb-0.5">Open Pos.</div>
                          <div className="text-[#d8e3fb]">{s.open_positions ?? 0}</div>
                        </div>
                      </div>

                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-[9px] text-[#46f1c5]">{s.win_rate}</span>
                        <button
                          className="text-[9px] text-[#00d4aa] hover:text-[#46f1c5] font-bold transition-colors"
                          onClick={e => { e.stopPropagation(); setDetailStrat(s) }}
                        >
                          View Details →
                        </button>
                      </div>
                    </div>
                  )
                })
            }
          </div>
        </section>

        {/* ═══ CENTRE (45%): Live Monitor ═══ */}
        <section className="w-[45%] flex flex-col gap-2 overflow-hidden">

          {/* Alignment Scan */}
          <div className="bg-[#111c2d] border border-[#2a3548] rounded-lg flex flex-col" style={{ maxHeight: '45%' }}>
            <div className="p-3 border-b border-[#2a3548] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#00d4aa] animate-pulse" />
                <h2 className="text-[10px] font-bold uppercase text-[#d8e3fb]">Today's Alignment Scan</h2>
                <span className="text-[9px] text-[#4a5568]">{alignments.length} found</span>
              </div>
              <button
                onClick={handleScanNow}
                disabled={scanning}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#00d4aa]/10 border border-[#00d4aa]/30 text-[#00d4aa] text-[10px] font-bold hover:bg-[#00d4aa]/20 transition-colors disabled:opacity-50"
              >
                <span className={`material-symbols-outlined text-[13px] ${scanning ? 'animate-spin' : ''}`}>
                  {scanning ? 'refresh' : 'radar'}
                </span>
                {scanning ? 'Scanning…' : 'Scan Now'}
              </button>
            </div>
            {lastScan && (
              <div className="px-3 py-1 text-[9px] text-[#4a5568] border-b border-[#2a3548] shrink-0">
                Last scan: {new Date(lastScan).toLocaleTimeString('en-IN')}
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
              {alignments.length === 0 ? (
                <div className="p-6 text-center text-[#4a5568] text-xs flex flex-col items-center gap-2">
                  <span className="material-symbols-outlined text-[28px]">radar</span>
                  {scanning ? 'Scanning 50+ stocks…' : 'No alignments yet — click Scan Now or wait for 9:20 AM scan'}
                </div>
              ) : (
                alignments.map((a, i) => (
                  <AlignmentCard
                    key={`${a.symbol}-${a.strategy_id}-${i}`}
                    alignment={a}
                    onActivate={handleAlignmentActivate}
                  />
                ))
              )}
            </div>
          </div>

          {/* Open Positions */}
          <div className="bg-[#111c2d] border border-[#2a3548] rounded-lg flex flex-col flex-1 min-h-0">
            <div className="p-3 border-b border-[#2a3548] flex items-center justify-between shrink-0">
              <h2 className="text-[10px] font-bold uppercase text-[#d8e3fb]">Open Positions ({positions.length})</h2>
            </div>
            <div className="flex-1 overflow-y-auto">
              {positions.length === 0 ? (
                <div className="p-6 text-center text-[#4a5568] text-xs flex flex-col items-center gap-2">
                  <span className="material-symbols-outlined text-[24px]">analytics</span>
                  No open positions
                </div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#2a3548] bg-[#081425] text-[9px] uppercase tracking-wider text-[#4a5568]">
                      {['Symbol', 'Strategy', 'Entry', 'LTP', 'P&L%', 'Days', 'Act'].map(h => (
                        <th key={h} className={`py-2 px-2 font-medium ${['Entry','LTP','P&L%'].includes(h) ? 'text-right' : h === 'Act' ? 'text-center' : ''}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="font-mono text-xs divide-y divide-[#2a3548]">
                    {positions.map(pos => {
                      const isNew = newTradeIds.has(pos.id)
                      const pnl   = pos.pnl ?? pos.unrealized_pnl ?? 0
                      const pnlPct = pos.pnl_pct ?? 0
                      return (
                        <tr key={pos.id} className={`transition-all ${isNew ? 'bg-[#46f1c5]/10' : 'hover:bg-[#152031]'}`}>
                          <td className="py-1.5 px-2">
                            <div className="text-[#d8e3fb] font-bold">{pos.symbol}</div>
                            <div className="text-[8px] text-[#46f1c5]">LONG</div>
                          </td>
                          <td className="py-1.5 px-2 text-[9px] text-[#bacac2] max-w-[80px] truncate">
                            {pos.strategy_name ?? pos.strategy_type ?? '—'}
                          </td>
                          <td className="py-1.5 px-2 text-right text-[#bacac2]">₹{pos.entry_price?.toFixed(0)}</td>
                          <td className="py-1.5 px-2 text-right text-[#d8e3fb]">₹{pos.current_price?.toFixed(0) ?? '—'}</td>
                          <td
                            title={`₹${pnl >= 0 ? '+' : ''}${pnl.toFixed(0)}`}
                            className={`py-1.5 px-2 text-right font-bold cursor-default ${pnlPct >= 0 ? 'text-[#46f1c5]' : 'text-[#ffb4ab]'}`}
                          >
                            {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
                          </td>
                          <td className="py-1.5 px-2 text-right text-[#bacac2]">{pos.hold_days ?? 0}d</td>
                          <td className="py-1.5 px-2 text-center">
                            <button
                              disabled={exiting === pos.id}
                              onClick={() => requestExit(pos)}
                              className="text-[#ffb4ab] bg-[#ffb4ab]/10 px-2 py-0.5 rounded text-[9px] font-bold disabled:opacity-50 hover:bg-[#ffb4ab]/20 transition-colors"
                            >
                              {exiting === pos.id ? '…' : 'EXIT'}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Closed Trades Today */}
          <div className="bg-[#111c2d] border border-[#2a3548] rounded-lg" style={{ maxHeight: '28%' }}>
            <div className="p-3 border-b border-[#2a3548] shrink-0">
              <h2 className="text-[10px] font-bold uppercase text-[#d8e3fb]">Today's Closed Trades ({history.length})</h2>
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: 'calc(28vh - 36px)' }}>
              {history.length === 0 ? (
                <div className="p-4 text-center text-[#4a5568] text-xs">No closed trades yet</div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#2a3548] bg-[#081425] text-[9px] uppercase tracking-wider text-[#4a5568]">
                      {['Symbol', 'Entry', 'Exit', 'P&L', 'Reason', 'Days'].map(h => (
                        <th key={h} className={`py-1.5 px-2 font-medium ${['Entry','Exit','P&L'].includes(h) ? 'text-right' : ''}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="font-mono text-xs divide-y divide-[#2a3548]">
                    {history.slice(0, 20).map((t, i) => {
                      const pnl = t.pnl ?? 0
                      return (
                        <tr key={t.id || i} className="hover:bg-[#152031] transition-colors">
                          <td className="py-1.5 px-2 text-[#d8e3fb] font-bold">{t.symbol}</td>
                          <td className="py-1.5 px-2 text-right text-[#bacac2]">₹{t.entry_price?.toFixed(0)}</td>
                          <td className="py-1.5 px-2 text-right text-[#d8e3fb]">₹{t.exit_price?.toFixed(0)}</td>
                          <td className={`py-1.5 px-2 text-right font-bold ${pnl >= 0 ? 'text-[#46f1c5]' : 'text-[#ffb4ab]'}`}>
                            {pnl >= 0 ? '+' : ''}₹{Math.abs(pnl).toFixed(0)}
                          </td>
                          <td className="py-1.5 px-2 text-[8px] text-[#bacac2]">
                            {t.exit_reason?.replace(/_/g, ' ')}
                          </td>
                          <td className="py-1.5 px-2 text-right text-[#bacac2]">{t.hold_days ?? 0}d</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </section>

        {/* ═══ RIGHT (30%): Intelligence Panel ═══ */}
        <section className="w-[30%] flex flex-col gap-2 overflow-hidden">

          {/* P&L Summary */}
          <div className="bg-[#111c2d] border border-[#2a3548] rounded-lg p-4 shrink-0">
            <div className="text-[10px] font-bold uppercase text-[#bacac2] mb-3 flex items-center gap-2">
              <span className="material-symbols-outlined text-[14px] text-[#ffa858]">account_balance_wallet</span>
              Overall Performance — Today
            </div>
            <div className="text-center mb-3">
              <div className={`font-mono text-2xl font-bold ${totalPnl >= 0 ? 'text-[#46f1c5]' : 'text-[#ffb4ab]'}`}>
                {totalPnl >= 0 ? '+' : ''}₹{Math.abs(totalPnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </div>
              <div className="text-[10px] text-[#bacac2] mt-0.5">Today's Total P&L</div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-center">
              {[
                { label: 'Win Rate', val: `${pnlToday?.win_rate_today ?? 0}%`, color: '#46f1c5' },
                { label: 'Trades', val: pnlToday?.trades_today ?? 0, color: '#d8e3fb' },
                { label: 'Open Pos.', val: positions.length, color: '#ffa858' },
                { label: 'Best Strat', val: pnlToday?.best_strategy ?? '—', color: '#00d4aa', small: true },
              ].map(({ label, val, color, small }) => (
                <div key={label} className="bg-[#081425] rounded p-2">
                  <div className="text-[8px] text-[#4a5568] uppercase mb-0.5">{label}</div>
                  <div className={`font-mono font-bold ${small ? 'text-[9px]' : 'text-sm'}`} style={{ color }}>{val}</div>
                </div>
              ))}
            </div>
            <button
              onClick={handleStopAll}
              className="mt-3 w-full bg-[#3f0003] hover:bg-[#690005] border border-[#ffb4ab] text-[#ffb4ab] py-2 rounded text-[10px] font-bold uppercase tracking-widest transition-colors flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[14px]">stop_circle</span>
              Emergency Stop All
            </button>
          </div>

          {/* Market Context */}
          <div className="bg-[#111c2d] border border-[#2a3548] rounded-lg p-4 shrink-0">
            <div className="text-[10px] font-bold uppercase text-[#bacac2] mb-3 flex items-center gap-2">
              <span className="material-symbols-outlined text-[14px] text-[#c0c6db]">monitoring</span>
              Market Context
            </div>
            {marketCtx ? (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <div className={`px-3 py-1 rounded text-[11px] font-bold ${
                    marketCtx.nifty_trend === 'UP'       ? 'bg-[#46f1c5]/15 text-[#46f1c5]'
                    : marketCtx.nifty_trend === 'DOWN'   ? 'bg-[#ffb4ab]/15 text-[#ffb4ab]'
                    : 'bg-[#ffa858]/15 text-[#ffa858]'
                  }`}>
                    NIFTY50 {marketCtx.nifty_trend}
                  </div>
                </div>
                <p className="text-[10px] text-[#bacac2] leading-relaxed mb-3">{marketCtx.market_note}</p>
                <div className="flex flex-col gap-1.5">
                  <div className="text-[9px] text-[#46f1c5] font-bold uppercase">✓ Recommended</div>
                  {(marketCtx.suitable_strategies || []).map(id => (
                    <span key={id} className="text-[10px] text-[#bacac2] pl-2">• {id.replace(/_/g, ' ')}</span>
                  ))}
                  <div className="text-[9px] text-[#ffb4ab] font-bold uppercase mt-1">✗ Avoid Today</div>
                  {(marketCtx.avoid_strategies || []).map(id => (
                    <span key={id} className="text-[10px] text-[#bacac2] pl-2">• {id.replace(/_/g, ' ')}</span>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-[10px] text-[#4a5568] text-center py-2">
                Market context updates every 30 min during market hours
              </p>
            )}
          </div>

          {/* Live Alerts Feed */}
          <div className="bg-[#111c2d] border border-[#2a3548] rounded-lg flex flex-col flex-1 min-h-0">
            <div className="p-3 border-b border-[#2a3548] flex items-center gap-2 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-[#ffa858] animate-pulse" />
              <h2 className="text-[10px] font-bold uppercase text-[#d8e3fb]">Strategy Alerts</h2>
              {alertFeed.length > 0 && (
                <span className="bg-[#ffa858]/20 text-[#ffa858] px-1.5 py-0.5 rounded text-[9px] font-bold">{alertFeed.length}</span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto">
              {alertFeed.length === 0 ? (
                <div className="p-4 text-center text-[#4a5568] text-xs">
                  Strategy alerts appear here when alignment score ≥ 85%
                </div>
              ) : (
                alertFeed.map((a, i) => (
                  <div key={i} className="px-3 py-2.5 border-b border-[#2a3548] hover:bg-[#152031] transition-colors cursor-pointer"
                    onClick={() => navigate(`/intelligence/${a.symbol}`)}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-[#d8e3fb] text-xs">{a.symbol}</span>
                        <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-[#ffa858]/10 text-[#ffa858]">
                          {a.alignment_score ?? a.score}%
                        </span>
                      </div>
                      <span className="text-[8px] text-[#4a5568]">
                        {a.timestamp ? new Date(a.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}
                      </span>
                    </div>
                    <div className="text-[10px] text-[#bacac2]">{a.strategy ?? a.strategy_name}</div>
                    <div className="text-[9px] text-[#4a5568] mt-0.5 line-clamp-1">{a.message}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

      </div>
    </main>
  )
}
