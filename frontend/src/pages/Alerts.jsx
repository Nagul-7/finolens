import { useState, useEffect, useRef } from 'react'
import { io } from 'socket.io-client'
import { getAlertHistory } from '../api/index.js'

function makeBuy(data) {
  return {
    id: Date.now() + Math.random(),
    type: data.confidence >= 80 ? 'STRONG BUY' : 'BUY SIGNAL',
    typeColor: 'text-[#00d4aa] bg-[#00d4aa]/10',
    borderColor: 'border-l-[#00d4aa]',
    time: new Date().toLocaleTimeString('en-IN'),
    symbol: data.symbol ?? '—',
    desc: data.reason ?? `Confidence: ${data.confidence ?? ''}%`,
    price: data.price ? `₹${Number(data.price).toLocaleString('en-IN')}` : '',
    active: true,
  }
}

function makeVolume(data) {
  return {
    id: Date.now() + Math.random(),
    type: 'VOLUME SPIKE',
    typeColor: 'text-[#ffa858] bg-[#ffa858]/10',
    borderColor: 'border-l-[#ffa858]',
    time: new Date().toLocaleTimeString('en-IN'),
    symbol: data.symbol ?? '—',
    desc: `${data.volume_ratio?.toFixed(1) ?? data.ratio?.toFixed(1) ?? ''}× avg volume detected`,
    price: data.price ? `₹${Number(data.price).toLocaleString('en-IN')}` : '',
    active: true,
  }
}

function makeAlgoTrade(data) {
  return {
    id: Date.now() + Math.random(),
    type: 'ALGO TRADE',
    typeColor: 'text-[#c0c6db] bg-[#c0c6db]/10',
    borderColor: 'border-l-[#c0c6db]',
    time: new Date().toLocaleTimeString('en-IN'),
    symbol: data.symbol ?? '—',
    desc: `${data.side ?? 'LONG'} ${data.qty ?? ''} @ ₹${data.entry_price ?? data.current_price ?? '—'} — ${data.strategy_name ?? ''}`,
    price: '',
    active: true,
  }
}

function makeLossLimit(data) {
  return {
    id: Date.now() + Math.random(),
    type: 'LOSS LIMIT',
    typeColor: 'text-[#ffb4ab] bg-[#ffb4ab]/10',
    borderColor: 'border-l-[#ffb4ab]',
    time: new Date().toLocaleTimeString('en-IN'),
    symbol: data.strategy_name ?? '—',
    desc: `Daily loss limit hit: ₹${Math.abs(data.pnl ?? 0).toLocaleString('en-IN')}`,
    price: '',
    active: true,
  }
}

const PRICE_ALERTS_KEY = 'finolens_price_alerts'

function loadPriceAlerts() {
  try { return JSON.parse(localStorage.getItem(PRICE_ALERTS_KEY) || '[]') } catch { return [] }
}

export default function Alerts() {
  const [alerts, setAlerts] = useState([])
  const [filter, setFilter] = useState('ALL')
  const [connected, setConnected] = useState(false)
  const [priceAlerts, setPriceAlerts] = useState(loadPriceAlerts)
  const [showCreate, setShowCreate] = useState(false)
  const [newAlert, setNewAlert] = useState({ symbol: '', condition: 'above', price: '' })
  const socketRef = useRef(null)
  const filters = ['ALL', 'BUY', 'SELL', 'VOLUME', 'ALGO']

  useEffect(() => {
    getAlertHistory()
      .then(res => {
        const history = (res.data ?? []).map(d => {
          if (d.event === 'new_call')     return makeBuy(d)
          if (d.event === 'volume_spike') return makeVolume(d)
          return null
        }).filter(Boolean)
        setAlerts(history)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const socket = io({ transports: ['websocket', 'polling'], reconnectionAttempts: 10, reconnectionDelay: 1000 })
    socketRef.current = socket

    socket.on('connect', () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))

    socket.on('new_call', data => {
      setAlerts(prev => [makeBuy(data), ...prev].slice(0, 50))
    })

    socket.on('volume_spike', data => {
      setAlerts(prev => [makeVolume(data), ...prev].slice(0, 50))
    })

    socket.on('new_algo_trade', data => {
      setAlerts(prev => [makeAlgoTrade(data), ...prev].slice(0, 50))
    })

    socket.on('daily_loss_limit_reached', data => {
      setAlerts(prev => [makeLossLimit(data), ...prev].slice(0, 50))
    })

    return () => socket.disconnect()
  }, [])

  const dismiss = id => setAlerts(prev => prev.map(a => a.id === id ? { ...a, active: false } : a))

  const addPriceAlert = () => {
    const sym = newAlert.symbol.trim().toUpperCase()
    const price = parseFloat(newAlert.price)
    if (!sym || !price) return
    const entry = { id: Date.now(), symbol: sym, condition: newAlert.condition, price, createdAt: new Date().toLocaleString('en-IN') }
    const updated = [entry, ...priceAlerts]
    setPriceAlerts(updated)
    localStorage.setItem(PRICE_ALERTS_KEY, JSON.stringify(updated))
    setNewAlert({ symbol: '', condition: 'above', price: '' })
    setShowCreate(false)
  }

  const removePriceAlert = id => {
    const updated = priceAlerts.filter(a => a.id !== id)
    setPriceAlerts(updated)
    localStorage.setItem(PRICE_ALERTS_KEY, JSON.stringify(updated))
  }

  const filtered = filter === 'ALL' ? alerts
    : filter === 'BUY'    ? alerts.filter(a => a.type.includes('BUY') || a.type.includes('STRONG'))
    : filter === 'SELL'   ? alerts.filter(a => a.type.includes('SELL'))
    : filter === 'VOLUME' ? alerts.filter(a => a.type.includes('VOLUME'))
    : alerts.filter(a => a.type.includes('ALGO') || a.type.includes('LOSS'))

  return (
    <main className="min-h-screen p-6">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 border-b border-[#3b4a44] pb-4">
          <div>
            <h1 className="text-2xl font-semibold text-[#d8e3fb]">Alerts &amp; Notifications</h1>
            <p className="text-sm text-[#bacac2] mt-1">Real-time signal feed from your watchlist &amp; algo strategies</p>
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
          {filters.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded text-xs font-bold uppercase tracking-wide transition-colors ${
                filter === f
                  ? 'bg-[#00d4aa] text-[#005643]'
                  : 'bg-[#1f2a3c] border border-[#3b4a44] text-[#bacac2] hover:text-[#d8e3fb] hover:bg-[#2f3a4c]'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Alert list */}
        {filtered.length === 0 ? (
          <div className="bg-[#111c2d] border border-[#3b4a44] rounded-xl p-12 text-center">
            <span className="material-symbols-outlined text-[48px] text-[#3b4a44]">notifications_off</span>
            <p className="text-[#bacac2] mt-3 text-sm">
              {connected ? 'Waiting for live alerts…' : 'Connecting to alert stream…'}
            </p>
            <p className="text-[10px] text-[#85948d] mt-1">Alerts appear during market hours (9:15–15:30 IST)</p>
          </div>
        ) : (
          <div className="flex flex-col gap-0 bg-[#111c2d] border border-[#3b4a44] rounded-xl overflow-hidden">
            {filtered.map((alert, i) => (
              <div
                key={alert.id}
                className={`px-4 py-4 border-b border-[#3b4a44] border-l-4 ${alert.borderColor} hover:bg-[#2f3a4c] transition-colors cursor-pointer ${!alert.active ? 'opacity-60' : ''} ${i === filtered.length - 1 ? 'border-b-0' : ''}`}
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
                        onClick={e => { e.stopPropagation(); dismiss(alert.id) }}
                        className="text-[10px] text-[#bacac2] hover:text-[#ffb4ab] mt-1 transition-colors"
                      >
                        Dismiss
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Price Alerts */}
        <div className="mt-6 bg-[#111c2d] border border-[#3b4a44] rounded-xl overflow-hidden">
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
              <div key={a.id} className="px-4 py-3 border-b border-[#3b4a44] last:border-b-0 flex justify-between items-center hover:bg-[#2f3a4c] transition-colors">
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
      </div>
    </main>
  )
}
