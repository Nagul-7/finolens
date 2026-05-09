import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { io } from 'socket.io-client'
import { getAlertHistory } from '../api/index.js'

const UNREAD_KEY    = 'finolens_alerts_unread'
const PRICE_KEY     = 'finolens_price_alerts'

// ── Badge helpers ────────────────────────────────────────────────────────────
function incrementUnread() {
  try {
    const n = parseInt(localStorage.getItem(UNREAD_KEY) || '0', 10) + 1
    localStorage.setItem(UNREAD_KEY, String(n))
    window.dispatchEvent(new Event('storage'))
  } catch { /* non-fatal */ }
}
function clearUnread() {
  localStorage.setItem(UNREAD_KEY, '0')
  window.dispatchEvent(new Event('storage'))
}

// ── Persistent price alerts ──────────────────────────────────────────────────
function loadPriceAlerts() {
  try { return JSON.parse(localStorage.getItem(PRICE_KEY) || '[]') } catch { return [] }
}

// ── Maker functions ──────────────────────────────────────────────────────────
function makeBuy(data) {
  return {
    id:           Date.now() + Math.random(),
    type:         data.confidence >= 80 ? 'STRONG BUY' : 'BUY SIGNAL',
    category:     'SIGNAL',
    typeColor:    'text-[#00d4aa] bg-[#00d4aa]/10',
    borderColor:  'border-l-[#00d4aa]',
    time:         new Date().toLocaleTimeString('en-IN'),
    symbol:       data.symbol ?? '—',
    desc:         data.reason ?? `Confidence: ${data.confidence ?? ''}%`,
    price:        data.price ? `₹${Number(data.price).toLocaleString('en-IN')}` : '',
    active:       true,
  }
}

function makeVolume(data) {
  return {
    id:           Date.now() + Math.random(),
    type:         'VOLUME SPIKE',
    category:     'VOLUME',
    typeColor:    'text-[#ffa858] bg-[#ffa858]/10',
    borderColor:  'border-l-[#ffa858]',
    time:         new Date().toLocaleTimeString('en-IN'),
    symbol:       data.symbol ?? '—',
    desc:         `${data.volume_ratio?.toFixed(1) ?? data.ratio?.toFixed(1) ?? ''}× avg volume`,
    price:        data.price ? `₹${Number(data.price).toLocaleString('en-IN')}` : '',
    active:       true,
  }
}

function makeAlgoTrade(data) {
  return {
    id:           Date.now() + Math.random(),
    type:         'ALGO TRADE',
    category:     'SIGNAL',
    typeColor:    'text-[#c0c6db] bg-[#c0c6db]/10',
    borderColor:  'border-l-[#c0c6db]',
    time:         new Date().toLocaleTimeString('en-IN'),
    symbol:       data.symbol ?? '—',
    desc:         `${data.side ?? 'LONG'} ${data.qty ?? ''} @ ₹${data.entry_price ?? data.current_price ?? '—'} — ${data.strategy_name ?? ''}`,
    price:        '',
    active:       true,
  }
}

function makeLossLimit(data) {
  return {
    id:           Date.now() + Math.random(),
    type:         'LOSS LIMIT',
    category:     'POSITION',
    typeColor:    'text-[#ffb4ab] bg-[#ffb4ab]/10',
    borderColor:  'border-l-[#ffb4ab]',
    time:         new Date().toLocaleTimeString('en-IN'),
    symbol:       data.strategy_name ?? '—',
    desc:         `Daily loss limit hit: ₹${Math.abs(data.pnl ?? 0).toLocaleString('en-IN')}`,
    price:        '',
    active:       true,
  }
}

function makeStrategyAlert(data) {
  return {
    id:            Date.now() + Math.random(),
    type:          'STRATEGY SIGNAL',
    category:      'STRATEGY',
    typeColor:     'text-[#00d4aa] bg-[#00d4aa]/10',
    borderColor:   'border-l-[#00d4aa]',
    time:          new Date().toLocaleTimeString('en-IN'),
    symbol:        data.symbol ?? '—',
    strategy_name: data.strategy_name ?? '',
    score:         data.score ?? 0,
    reasons:       data.reasons ?? [],
    entry:         data.entry ?? data.suggested_entry ?? null,
    sl:            data.sl ?? data.suggested_sl ?? null,
    target:        data.target ?? data.suggested_target ?? null,
    desc:          data.reasons?.[0] ?? `Alignment score: ${data.score ?? 0}`,
    price:         '',
    active:        true,
    high_priority: (data.score ?? 0) >= 85,
  }
}

function makePositionAlert(data) {
  const pnl = data.pnl ?? 0
  const isProfit = pnl >= 0
  return {
    id:           Date.now() + Math.random(),
    type:         data.exit_reason ? `EXIT: ${String(data.exit_reason).toUpperCase()}` : 'POSITION UPDATE',
    category:     'POSITION',
    typeColor:    isProfit ? 'text-[#46f1c5] bg-[#46f1c5]/10' : 'text-[#ffb4ab] bg-[#ffb4ab]/10',
    borderColor:  isProfit ? 'border-l-[#46f1c5]' : 'border-l-[#ffb4ab]',
    time:         new Date().toLocaleTimeString('en-IN'),
    symbol:       data.symbol ?? '—',
    desc:         data.exit_reason ?? 'Position updated',
    pnl,
    pnl_pct:      data.pnl_pct ?? 0,
    exit_price:   data.exit_price ?? null,
    price:        data.exit_price ? `₹${Number(data.exit_price).toLocaleString('en-IN')}` : '',
    active:       true,
  }
}

// ── History → alert objects ──────────────────────────────────────────────────
function historyToAlert(d) {
  if (d.event === 'new_call')               return makeBuy(d)
  if (d.event === 'volume_spike')           return makeVolume(d)
  if (d.event === 'new_algo_trade')         return makeAlgoTrade(d)
  if (d.event === 'daily_loss_limit_reached') return makeLossLimit(d)
  if (d.event === 'strategy_alert')         return makeStrategyAlert(d)
  if (d.event === 'position_update')        return makePositionAlert(d)
  return null
}

// ── Sub-component: Strategy Alert (expanded) ─────────────────────────────────
function StrategyAlertCard({ alert, onDismiss }) {
  const navigate  = useNavigate()
  const score     = alert.score ?? 0
  const scoreColor = score >= 85 ? '#00d4aa' : score >= 70 ? '#46f1c5' : '#ffa858'

  return (
    <div className={`px-4 py-4 border-b border-[#3b4a44] border-l-4 ${alert.borderColor} hover:bg-[#152031] transition-colors ${!alert.active ? 'opacity-60' : ''}`}>
      {/* Header row */}
      <div className="flex justify-between items-start mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-sm ${alert.typeColor}`}>{alert.type}</span>
          {alert.high_priority && (
            <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-[#00d4aa]/20 text-[#00d4aa] animate-pulse tracking-wide">⚡ HIGH SCORE</span>
          )}
        </div>
        <span className="font-mono text-[10px] text-[#bacac2] shrink-0">{alert.time}</span>
      </div>

      {/* Symbol + strategy + score */}
      <div className="flex justify-between items-start mb-2">
        <div>
          <h4 className="font-mono font-bold text-[#d8e3fb] text-base leading-tight">{alert.symbol}</h4>
          <p className="text-[11px] text-[#00d4aa] mt-0.5">{alert.strategy_name}</p>
        </div>
        <div className="text-right">
          <span className="font-mono text-xl font-black" style={{ color: scoreColor }}>{score}</span>
          <span className="text-[10px] text-[#bacac2]">/100</span>
        </div>
      </div>

      {/* Score bar */}
      <div className="h-1.5 bg-[#2a3548] rounded-full mb-3">
        <div
          className="h-1.5 rounded-full transition-all duration-700"
          style={{ width: `${Math.min(100, score)}%`, background: scoreColor }}
        />
      </div>

      {/* Top 2 reasons */}
      {alert.reasons.slice(0, 2).map((r, i) => (
        <p key={i} className="text-[11px] text-[#bacac2] flex items-start gap-1.5 mb-1 leading-snug">
          <span className="text-[#00d4aa] font-bold shrink-0">›</span>{r}
        </p>
      ))}

      {/* Entry / SL / Target grid */}
      {(alert.entry || alert.sl || alert.target) && (
        <div className="grid grid-cols-3 gap-2 mt-3 mb-3">
          <div className="bg-[#081425] border border-[#2a3548] rounded p-2 text-center">
            <div className="text-[9px] text-[#bacac2] uppercase tracking-wide mb-0.5">Entry</div>
            <div className="font-mono text-[11px] text-[#d8e3fb] font-bold">
              {alert.entry ? `₹${Number(alert.entry).toLocaleString('en-IN')}` : '—'}
            </div>
          </div>
          <div className="bg-[#1a0a0a] border border-[#ffb4ab]/20 rounded p-2 text-center">
            <div className="text-[9px] text-[#bacac2] uppercase tracking-wide mb-0.5">Stop Loss</div>
            <div className="font-mono text-[11px] text-[#ffb4ab] font-bold">
              {alert.sl ? `₹${Number(alert.sl).toLocaleString('en-IN')}` : '—'}
            </div>
          </div>
          <div className="bg-[#0a1a0a] border border-[#46f1c5]/20 rounded p-2 text-center">
            <div className="text-[9px] text-[#bacac2] uppercase tracking-wide mb-0.5">Target</div>
            <div className="font-mono text-[11px] text-[#46f1c5] font-bold">
              {alert.target ? `₹${Number(alert.target).toLocaleString('en-IN')}` : '—'}
            </div>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 mt-1">
        <button
          onClick={() => {
            sessionStorage.setItem('charts_symbol', alert.symbol)
            navigate('/charts')
          }}
          className="flex-1 py-1.5 text-[10px] font-bold bg-[#1f2a3c] border border-[#3b4a44] text-[#bacac2] rounded hover:text-[#d8e3fb] hover:bg-[#2f3a4c] transition-colors flex items-center justify-center gap-1"
        >
          <span className="material-symbols-outlined text-[12px]">candlestick_chart</span>
          Open in Charts
        </button>
        <button
          onClick={() => navigate(`/intelligence/${alert.symbol}`)}
          className="flex-1 py-1.5 text-[10px] font-bold bg-[#00d4aa]/10 border border-[#00d4aa]/30 text-[#00d4aa] rounded hover:bg-[#00d4aa]/20 transition-colors flex items-center justify-center gap-1"
        >
          <span className="material-symbols-outlined text-[12px]">insights</span>
          View Intelligence
        </button>
        {alert.active && (
          <button
            onClick={() => onDismiss(alert.id)}
            className="px-2.5 py-1.5 text-[#bacac2] hover:text-[#ffb4ab] transition-colors border border-[#3b4a44] rounded bg-[#1f2a3c]"
          >
            <span className="material-symbols-outlined text-[14px]">close</span>
          </button>
        )}
      </div>
    </div>
  )
}

// ── Sub-component: Position Alert ────────────────────────────────────────────
function PositionAlertCard({ alert, onDismiss }) {
  const pnl       = alert.pnl ?? 0
  const pnlPct    = alert.pnl_pct ?? 0
  const isProfit  = pnl >= 0

  return (
    <div className={`px-4 py-4 border-b border-[#3b4a44] border-l-4 ${alert.borderColor} hover:bg-[#152031] transition-colors ${!alert.active ? 'opacity-60' : ''}`}>
      <div className="flex justify-between items-start mb-1.5">
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-sm ${alert.typeColor}`}>{alert.type}</span>
        <span className="font-mono text-[10px] text-[#bacac2]">{alert.time}</span>
      </div>
      <div className="flex justify-between items-end">
        <div>
          <h4 className="font-mono font-bold text-[#d8e3fb] text-base">{alert.symbol}</h4>
          <p className="text-sm text-[#bacac2] mt-0.5">{alert.desc}</p>
        </div>
        <div className="text-right">
          <div className={`font-mono text-sm font-bold ${isProfit ? 'text-[#46f1c5]' : 'text-[#ffb4ab]'}`}>
            {isProfit ? '+' : ''}₹{Math.abs(pnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </div>
          <div className={`font-mono text-[10px] ${isProfit ? 'text-[#46f1c5]' : 'text-[#ffb4ab]'}`}>
            {isProfit ? '+' : ''}{pnlPct.toFixed(2)}%
          </div>
          {alert.price && <div className="font-mono text-[10px] text-[#bacac2]">{alert.price}</div>}
          {alert.active && (
            <button
              onClick={() => onDismiss(alert.id)}
              className="text-[10px] text-[#bacac2] hover:text-[#ffb4ab] mt-1 transition-colors"
            >
              Dismiss
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Sub-component: Generic Alert Row ─────────────────────────────────────────
function AlertRow({ alert, onDismiss, isLast }) {
  return (
    <div
      className={`px-4 py-4 border-b border-[#3b4a44] border-l-4 ${alert.borderColor} hover:bg-[#2f3a4c] transition-colors cursor-pointer ${!alert.active ? 'opacity-60' : ''} ${isLast ? 'border-b-0' : ''}`}
    >
      <div className="flex justify-between items-start mb-1.5">
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-sm ${alert.typeColor}`}>{alert.type}</span>
        <div className="flex items-center gap-3">
          {!alert.active && (
            <span className="text-[10px] text-[#bacac2] bg-[#2a3548] px-1.5 py-0.5 rounded">DISMISSED</span>
          )}
          <span className="font-mono text-[10px] text-[#bacac2]">{alert.time}</span>
        </div>
      </div>
      <div className="flex justify-between items-end">
        <div>
          <h4 className="font-mono font-bold text-[#d8e3fb] text-base">{alert.symbol}</h4>
          <p className="text-sm text-[#bacac2] mt-0.5">{alert.desc}</p>
        </div>
        <div className="text-right">
          {alert.price && <div className="font-mono text-sm font-semibold text-[#d8e3fb]">{alert.price}</div>}
          {alert.active && (
            <button
              onClick={e => { e.stopPropagation(); onDismiss(alert.id) }}
              className="text-[10px] text-[#bacac2] hover:text-[#ffb4ab] mt-1 transition-colors"
            >
              Dismiss
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
const FILTERS = ['ALL', 'STRATEGY', 'POSITION', 'VOLUME', 'SIGNAL', 'PRICE']

export default function Alerts() {
  const [alerts,      setAlerts]      = useState([])
  const [filter,      setFilter]      = useState('ALL')
  const [connected,   setConnected]   = useState(false)
  const [priceAlerts, setPriceAlerts] = useState(loadPriceAlerts)
  const [showCreate,  setShowCreate]  = useState(false)
  const [newAlert,    setNewAlert]    = useState({ symbol: '', condition: 'above', price: '' })
  const socketRef = useRef(null)

  // Clear badge on page visit
  useEffect(() => { clearUnread() }, [])

  // Load history on mount
  useEffect(() => {
    getAlertHistory()
      .then(res => {
        const history = (res.data ?? [])
          .map(historyToAlert)
          .filter(Boolean)
        setAlerts(history)
      })
      .catch(() => {})
  }, [])

  // Socket.IO
  useEffect(() => {
    const socket = io({ transports: ['websocket', 'polling'], reconnectionAttempts: 10, reconnectionDelay: 1000 })
    socketRef.current = socket

    socket.on('connect',    () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))

    socket.on('new_call', data => {
      setAlerts(prev => [makeBuy(data), ...prev].slice(0, 100))
    })

    socket.on('volume_spike', data => {
      setAlerts(prev => [makeVolume(data), ...prev].slice(0, 100))
    })

    socket.on('new_algo_trade', data => {
      setAlerts(prev => [makeAlgoTrade(data), ...prev].slice(0, 100))
    })

    socket.on('daily_loss_limit_reached', data => {
      setAlerts(prev => [makeLossLimit(data), ...prev].slice(0, 100))
    })

    socket.on('strategy_alert', data => {
      const a = makeStrategyAlert(data)
      if (a.high_priority) incrementUnread()
      setAlerts(prev => [a, ...prev].slice(0, 100))
    })

    socket.on('position_update', data => {
      setAlerts(prev => [makePositionAlert(data), ...prev].slice(0, 100))
    })

    socket.on('algo_trade_closed', data => {
      setAlerts(prev => [makePositionAlert({ ...data, exit_reason: data.exit_reason ?? 'Trade closed' }), ...prev].slice(0, 100))
    })

    return () => socket.disconnect()
  }, [])

  const dismiss = id => setAlerts(prev => prev.map(a => a.id === id ? { ...a, active: false } : a))

  const addPriceAlert = () => {
    const sym   = newAlert.symbol.trim().toUpperCase()
    const price = parseFloat(newAlert.price)
    if (!sym || !price) return
    const entry   = { id: Date.now(), symbol: sym, condition: newAlert.condition, price, createdAt: new Date().toLocaleString('en-IN') }
    const updated = [entry, ...priceAlerts]
    setPriceAlerts(updated)
    localStorage.setItem(PRICE_KEY, JSON.stringify(updated))
    setNewAlert({ symbol: '', condition: 'above', price: '' })
    setShowCreate(false)
  }

  const removePriceAlert = id => {
    const updated = priceAlerts.filter(a => a.id !== id)
    setPriceAlerts(updated)
    localStorage.setItem(PRICE_KEY, JSON.stringify(updated))
  }

  const filtered = (() => {
    if (filter === 'ALL')      return alerts
    if (filter === 'STRATEGY') return alerts.filter(a => a.category === 'STRATEGY')
    if (filter === 'POSITION') return alerts.filter(a => a.category === 'POSITION')
    if (filter === 'VOLUME')   return alerts.filter(a => a.category === 'VOLUME')
    if (filter === 'SIGNAL')   return alerts.filter(a => a.category === 'SIGNAL')
    return [] // PRICE tab shows only the price alerts section
  })()

  const strategyCount = alerts.filter(a => a.category === 'STRATEGY' && a.high_priority && a.active).length

  return (
    <main className="min-h-screen p-6">
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 border-b border-[#3b4a44] pb-4">
          <div>
            <h1 className="text-2xl font-semibold text-[#d8e3fb]">Alerts &amp; Notifications</h1>
            <p className="text-sm text-[#bacac2] mt-1">Real-time signal feed — strategies, positions, volume anomalies</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 relative">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${connected ? 'bg-[#00d4aa]' : 'bg-slate-500'}`} />
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${connected ? 'bg-[#00d4aa]' : 'bg-slate-500'}`} />
            </span>
            <span className={`text-[11px] font-bold uppercase tracking-widest ${connected ? 'text-[#00d4aa]' : 'text-slate-500'}`}>
              {connected ? 'LIVE' : 'DISCONNECTED'}
            </span>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 mb-4 flex-wrap">
          {FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`relative px-4 py-1.5 rounded text-xs font-bold uppercase tracking-wide transition-colors ${
                filter === f
                  ? 'bg-[#00d4aa] text-[#005643]'
                  : 'bg-[#1f2a3c] border border-[#3b4a44] text-[#bacac2] hover:text-[#d8e3fb] hover:bg-[#2f3a4c]'
              }`}
            >
              {f}
              {f === 'STRATEGY' && strategyCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-[#00d4aa] text-[#005643] text-[8px] font-black rounded-full min-w-[14px] h-[14px] flex items-center justify-center px-0.5">
                  {strategyCount > 9 ? '9+' : strategyCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Alert list */}
        {filter !== 'PRICE' && (
          filtered.length === 0 ? (
            <div className="bg-[#111c2d] border border-[#3b4a44] rounded-xl p-12 text-center">
              <span className="material-symbols-outlined text-[48px] text-[#3b4a44]">notifications_off</span>
              <p className="text-[#bacac2] mt-3 text-sm">
                {connected ? `No ${filter === 'ALL' ? '' : filter.toLowerCase() + ' '}alerts yet…` : 'Connecting to alert stream…'}
              </p>
              <p className="text-[10px] text-[#85948d] mt-1">Alerts appear during market hours (9:15–15:30 IST)</p>
            </div>
          ) : (
            <div className="flex flex-col bg-[#111c2d] border border-[#3b4a44] rounded-xl overflow-hidden">
              {filtered.map((alert, i) => {
                if (alert.category === 'STRATEGY') {
                  return (
                    <StrategyAlertCard
                      key={alert.id}
                      alert={alert}
                      onDismiss={dismiss}
                    />
                  )
                }
                if (alert.category === 'POSITION') {
                  return (
                    <PositionAlertCard
                      key={alert.id}
                      alert={alert}
                      onDismiss={dismiss}
                    />
                  )
                }
                return (
                  <AlertRow
                    key={alert.id}
                    alert={alert}
                    onDismiss={dismiss}
                    isLast={i === filtered.length - 1}
                  />
                )
              })}
            </div>
          )
        )}

        {/* Price Alerts section — always shown in PRICE tab, also shown in ALL tab */}
        {(filter === 'ALL' || filter === 'PRICE') && (
          <div className={`${filter === 'ALL' ? 'mt-6' : ''} bg-[#111c2d] border border-[#3b4a44] rounded-xl overflow-hidden`}>
            <div className="px-4 py-3 border-b border-[#3b4a44] bg-[#0d1829] flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px] text-[#ffa858]">price_check</span>
                <h2 className="text-[11px] font-bold uppercase text-[#d8e3fb]">Price Alerts</h2>
                {priceAlerts.length > 0 && (
                  <span className="bg-[#ffa858]/20 text-[#ffa858] px-1.5 py-0.5 rounded text-[9px] font-bold">{priceAlerts.length}</span>
                )}
              </div>
              <button
                onClick={() => setShowCreate(v => !v)}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#00d4aa]/10 border border-[#00d4aa]/30 text-[#00d4aa] text-[10px] font-bold hover:bg-[#00d4aa]/20 transition-colors"
              >
                <span className="material-symbols-outlined text-[13px]">{showCreate ? 'close' : 'add'}</span>
                {showCreate ? 'CANCEL' : 'NEW ALERT'}
              </button>
            </div>

            {showCreate && (
              <div className="px-4 py-3 border-b border-[#3b4a44] bg-[#081425] flex flex-col gap-3">
                <p className="text-[10px] font-bold uppercase text-[#bacac2]">Create Price Alert</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    value={newAlert.symbol}
                    onChange={e => setNewAlert(a => ({ ...a, symbol: e.target.value.toUpperCase() }))}
                    placeholder="SYMBOL"
                    className="w-28 bg-[#1f2a3c] border border-[#3b4a44] rounded py-1.5 px-2 text-[#d8e3fb] font-mono text-xs focus:border-[#00d4aa] outline-none uppercase placeholder:normal-case placeholder:text-[#bacac2]"
                  />
                  <select
                    value={newAlert.condition}
                    onChange={e => setNewAlert(a => ({ ...a, condition: e.target.value }))}
                    className="bg-[#1f2a3c] border border-[#3b4a44] rounded py-1.5 px-2 text-[#d8e3fb] font-mono text-xs focus:border-[#00d4aa] outline-none"
                  >
                    <option value="above">Price rises above</option>
                    <option value="below">Price falls below</option>
                  </select>
                  <input
                    type="number"
                    value={newAlert.price}
                    onChange={e => setNewAlert(a => ({ ...a, price: e.target.value }))}
                    placeholder="₹ target price"
                    className="w-36 bg-[#1f2a3c] border border-[#3b4a44] rounded py-1.5 px-2 text-[#d8e3fb] font-mono text-xs focus:border-[#00d4aa] outline-none"
                  />
                  <button
                    onClick={addPriceAlert}
                    className="px-4 py-1.5 bg-[#00d4aa] text-[#005643] rounded text-xs font-bold hover:bg-[#55fcd0] transition-colors"
                  >
                    CREATE
                  </button>
                </div>
              </div>
            )}

            {priceAlerts.length === 0 && !showCreate ? (
              <div className="p-6 text-center">
                <p className="text-xs text-[#bacac2]">No price alerts set.</p>
                <p className="text-[10px] text-[#85948d] mt-1">Click NEW ALERT to set a price trigger.</p>
              </div>
            ) : (
              priceAlerts.map(a => (
                <div
                  key={a.id}
                  className="px-4 py-3 border-b border-[#3b4a44] last:border-b-0 flex justify-between items-center hover:bg-[#2f3a4c] transition-colors"
                >
                  <div>
                    <span className="font-mono font-bold text-[#d8e3fb] text-sm">{a.symbol}</span>
                    <span className="ml-2 text-[11px] text-[#bacac2]">
                      {a.condition === 'above' ? '↑ rises above' : '↓ falls below'}{' '}
                      <span className="font-mono text-[#ffa858]">₹{a.price.toLocaleString('en-IN')}</span>
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-[#85948d]">{a.createdAt}</span>
                    <button onClick={() => removePriceAlert(a.id)} className="text-[#bacac2] hover:text-[#ffb4ab] transition-colors">
                      <span className="material-symbols-outlined text-[15px]">close</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

      </div>
    </main>
  )
}
