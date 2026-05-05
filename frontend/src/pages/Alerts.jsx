import { useState, useEffect, useRef } from 'react'
import { io } from 'socket.io-client'

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

export default function Alerts() {
  const [alerts, setAlerts] = useState([])
  const [filter, setFilter] = useState('ALL')
  const [connected, setConnected] = useState(false)
  const socketRef = useRef(null)
  const filters = ['ALL', 'BUY', 'SELL', 'VOLUME', 'ALGO']

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

        {/* Create alert CTA */}
        <div className="mt-4 bg-[#111c2d] border border-dashed border-[#3b4a44] rounded-xl p-6 flex flex-col items-center gap-3 hover:bg-[#1f2a3c] transition-colors cursor-pointer">
          <span className="material-symbols-outlined text-[32px] text-[#3b4a44]">add_circle</span>
          <div className="text-center">
            <p className="font-mono font-bold text-[#bacac2]">Create Custom Alert</p>
            <p className="text-[11px] text-[#85948d] mt-1">Set price triggers, indicator crossovers, or volume spikes</p>
          </div>
        </div>
      </div>
    </main>
  )
}
