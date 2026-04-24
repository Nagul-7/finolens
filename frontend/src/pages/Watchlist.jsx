import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { io } from 'socket.io-client'
import { getWatchlist, getWatchlistQuotes, addToWatchlist, removeFromWatchlist, getOHLCV } from '../api/index.js'

function Sparkline({ closes = [], color = '#00d4aa' }) {
  if (closes.length < 2) return <div className="w-16 h-8" />
  const min = Math.min(...closes), max = Math.max(...closes)
  const range = max - min || 1
  const w = 64, h = 32
  const pts = closes.map((v, i) => `${(i / (closes.length - 1)) * w},${h - ((v - min) / range) * h}`)
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="opacity-80">
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

function WatchCard({ item, onRemove, onClick }) {
  const [alertOn, setAlertOn] = useState(true)
  const [sparkCloses, setSparkCloses] = useState([])
  const pos = item.change_pct >= 0
  const color = pos ? '#00d4aa' : '#ffb4ab'

  useEffect(() => {
    getOHLCV(item.symbol, '1d')
      .then(res => {
        const closes = (res.data ?? []).slice(-10).map(r => r.close).filter(Boolean)
        setSparkCloses(closes)
      })
      .catch(() => {})
  }, [item.symbol])

  return (
    <div
      className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 flex flex-col gap-3 hover:bg-[#1a2333] transition-colors cursor-pointer group relative"
      onClick={onClick}
    >
      <div className="flex justify-between items-start">
        <div>
          <h3 className="font-mono font-bold text-[#d8e3fb] group-hover:text-[#00d4aa] transition-colors">{item.symbol}</h3>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-[9px] font-bold uppercase text-[#bacac2]">NSE:EQ</p>
            <span className="bg-[#00d4aa]/20 text-[#00d4aa] px-1.5 py-0.5 rounded text-[8px] font-bold">ALGO</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="relative inline-flex items-center cursor-pointer" title="Toggle Alerts" onClick={e => e.stopPropagation()}>
            <input type="checkbox" className="sr-only peer" checked={alertOn} onChange={() => setAlertOn(v => !v)} />
            <div className={`w-8 h-4 rounded-full border relative transition-colors ${alertOn ? 'bg-[#00d4aa]/20 border-[#00d4aa]' : 'bg-[#1f2a3c] border-[#3b4a44]'}`}>
              <div className={`absolute top-[2px] h-3 w-3 rounded-full transition-all ${alertOn ? 'left-[calc(100%-14px)] bg-[#00d4aa]' : 'left-[2px] bg-[#bacac2]'}`} />
            </div>
          </label>
          <button
            className="text-[#bacac2] hover:text-[#ffb4ab] transition-colors"
            onClick={e => { e.stopPropagation(); onRemove(item.symbol) }}
            title="Remove"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      </div>
      <div className="flex justify-between items-end mt-1">
        <div>
          <div className="text-lg font-semibold text-[#d8e3fb] tracking-tight">
            ₹{item.ltp?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div className={`font-mono text-sm flex items-center gap-1 ${pos ? 'text-[#00d4aa]' : 'text-[#ffb4ab]'}`}>
            <span className="material-symbols-outlined text-[14px]">{pos ? 'arrow_upward' : 'arrow_downward'}</span>
            {item.change_pct >= 0 ? '+' : ''}{item.change_pct?.toFixed(2)}% (₹{Math.abs(item.change ?? 0).toFixed(2)})
          </div>
        </div>
        <Sparkline closes={sparkCloses} color={color} />
      </div>
    </div>
  )
}

export default function Watchlist() {
  const navigate = useNavigate()
  const [symbols, setSymbols]   = useState([])
  const [quotes, setQuotes]     = useState({})
  const [loading, setLoading]   = useState(true)
  const [addInput, setAddInput] = useState('')
  const [addMsg, setAddMsg]     = useState('')
  const [alerts, setAlerts]     = useState([])
  const socketRef = useRef(null)

  const loadData = async () => {
    try {
      const [wRes, qRes] = await Promise.all([getWatchlist(), getWatchlistQuotes().catch(() => ({ data: [] }))])
      setSymbols(wRes.data ?? [])
      const qMap = {}
      for (const q of qRes.data ?? []) qMap[q.symbol] = q
      setQuotes(qMap)
    } catch (e) {
      console.error('Watchlist load error', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()

    const socket = io('http://localhost:5000', { transports: ['websocket'] })
    socketRef.current = socket

    socket.on('new_call', data => {
      setAlerts(prev => [{
        type: 'NEW CALL',
        typeColor: 'text-[#00d4aa] bg-[#00d4aa]/10',
        borderColor: 'border-l-[#00d4aa]',
        time: new Date().toLocaleTimeString('en-IN'),
        symbol: data.symbol ?? '—',
        desc: `${data.call ?? data.signal ?? 'Signal'} — ${data.reason ?? ''}`,
        price: data.price ? `₹${data.price}` : '',
      }, ...prev].slice(0, 20))
    })

    socket.on('volume_spike', data => {
      setAlerts(prev => [{
        type: 'VOLUME SPIKE',
        typeColor: 'text-[#ffa858] bg-[#ffa858]/10',
        borderColor: 'border-l-[#ffa858]',
        time: new Date().toLocaleTimeString('en-IN'),
        symbol: data.symbol ?? '—',
        desc: `${data.ratio?.toFixed(1) ?? ''}x avg volume detected`,
        price: data.price ? `₹${data.price}` : '',
      }, ...prev].slice(0, 20))
    })

    socket.on('price_update', data => {
      setQuotes(prev => {
        if (!data.symbol) return prev
        return { ...prev, [data.symbol]: { ...(prev[data.symbol] ?? {}), ...data } }
      })
    })

    return () => socket.disconnect()
  }, [])

  const handleAdd = async () => {
    const sym = addInput.trim().toUpperCase()
    if (!sym) return
    try {
      await addToWatchlist(sym)
      setAddInput('')
      setAddMsg(`${sym} added!`)
      setTimeout(() => setAddMsg(''), 2000)
      loadData()
    } catch (e) {
      setAddMsg('Already in watchlist or invalid symbol')
      setTimeout(() => setAddMsg(''), 2000)
    }
  }

  const handleRemove = async sym => {
    try {
      await removeFromWatchlist(sym)
      setSymbols(prev => prev.filter(s => s !== sym))
    } catch (e) {
      console.error('Remove error', e)
    }
  }

  const watchItems = symbols.map(sym => quotes[sym] ?? { symbol: sym, ltp: 0, change_pct: 0, change: 0 })

  return (
    <main className="min-h-screen pt-4 pb-4">
      <div className="px-6 grid grid-cols-1 xl:grid-cols-12 gap-4 flex-grow">
        {/* Left */}
        <div className="xl:col-span-8 flex flex-col gap-6">
          <div className="flex items-center justify-between border-b border-[#3b4a44] pb-3">
            <h1 className="text-2xl font-semibold text-[#d8e3fb]">Active Watchlist</h1>
          </div>

          {/* Add symbol */}
          <div className="flex gap-2 items-center">
            <input
              value={addInput}
              onChange={e => setAddInput(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              placeholder="Add symbol (e.g. TITAN)"
              className="flex-1 max-w-xs bg-[#1f2a3c] border border-[#3b4a44] rounded px-3 py-2 text-[#d8e3fb] text-sm font-mono focus:border-[#00d4aa] outline-none uppercase placeholder:normal-case placeholder:text-[#bacac2]"
            />
            <button onClick={handleAdd} className="bg-[#00d4aa] hover:bg-[#46f1c5] text-[#005643] px-4 py-2 rounded text-sm font-bold transition-colors">
              ADD
            </button>
            {addMsg && <span className="text-xs text-[#00d4aa]">{addMsg}</span>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {loading ? (
              [...Array(4)].map((_, i) => <div key={i} className="h-32 bg-[#111827] border border-[#1e293b] rounded-xl animate-pulse" />)
            ) : (
              <>
                {watchItems.map(item => (
                  <WatchCard
                    key={item.symbol}
                    item={item}
                    onRemove={handleRemove}
                    onClick={() => navigate(`/intelligence/${item.symbol}`)}
                  />
                ))}
                <div
                  className="bg-[#040e1f] border border-dashed border-[#3b4a44] rounded-xl p-6 flex flex-col items-center justify-center gap-4 hover:bg-[#1f2a3c] transition-colors cursor-pointer group"
                  onClick={() => document.querySelector('input[placeholder^="Add symbol"]')?.focus()}
                >
                  <svg className="w-12 h-12 text-[#3b4a44] group-hover:text-[#00d4aa] transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
                  </svg>
                  <div className="text-center">
                    <p className="font-mono text-[#bacac2] font-bold">Add Symbol</p>
                    <p className="text-[10px] font-bold uppercase text-[#85948d] mt-1">Start tracking assets</p>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right: Alert feed */}
        <div className="xl:col-span-4 h-full">
          <div className="bg-[#152031] border border-[#3b4a44] rounded-xl flex flex-col max-h-[calc(100vh-160px)] sticky top-[80px] overflow-hidden shadow-2xl shadow-black/50">
            <div className="px-4 py-3 border-b border-[#3b4a44] bg-[#111827] flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-[#ffa858]">bolt</span>
                <h2 className="text-[11px] font-bold uppercase text-[#d8e3fb]">REAL-TIME ALERTS</h2>
              </div>
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00d4aa] opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#00d4aa]" />
              </span>
            </div>

            <div className="flex-1 overflow-y-auto bg-[#111c2d]">
              {alerts.length === 0 ? (
                <div className="p-6 text-center">
                  <p className="text-xs text-[#bacac2]">Waiting for live alerts…</p>
                  <p className="text-[10px] text-[#85948d] mt-1">Alerts appear during market hours (9:15–15:30 IST)</p>
                </div>
              ) : (
                alerts.map((alert, i) => (
                  <div key={i} className={`px-4 py-3 border-b border-[#3b4a44] border-l-4 ${alert.borderColor} bg-[#081425] hover:bg-[#2f3a4c] transition-colors`}>
                    <div className="flex justify-between items-start mb-1">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-sm ${alert.typeColor}`}>{alert.type}</span>
                      <span className="font-mono text-[10px] text-[#bacac2]">{alert.time}</span>
                    </div>
                    <div className="flex justify-between items-end">
                      <div>
                        <h4 className="font-mono font-bold text-[#d8e3fb] text-sm">{alert.symbol}</h4>
                        <p className="text-[11px] text-[#bacac2] mt-0.5">{alert.desc}</p>
                      </div>
                      {alert.price && <div className="font-mono text-xs text-[#d8e3fb]">{alert.price}</div>}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="p-2 border-t border-[#3b4a44] bg-[#111827]">
              <button className="w-full py-2 text-center text-[11px] font-bold uppercase text-[#bacac2] hover:text-[#d8e3fb] transition-colors flex items-center justify-center gap-1">
                <span className="material-symbols-outlined text-[14px]">settings</span> MANAGE ALERTS
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
