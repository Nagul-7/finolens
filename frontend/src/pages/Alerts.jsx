import { useState } from 'react'

const allAlerts = [
  { id: 1, type: 'STRONG BUY', typeColor: 'text-[#00d4aa] bg-[#00d4aa]/10', borderColor: 'border-l-[#00d4aa]', time: '10:42:05 AM', symbol: 'RELIANCE', desc: 'MACD Bullish Crossover (5m)', price: '₹2,985.00', active: true },
  { id: 2, type: 'VOLUME SPIKE', typeColor: 'text-[#ffa858] bg-[#ffa858]/10', borderColor: 'border-l-[#ffa858]', time: '10:38:12 AM', symbol: 'ITC', desc: '300% avg volume detected', price: '₹412.30', active: true },
  { id: 3, type: 'SELL SIGNAL', typeColor: 'text-[#ffb4ab] bg-[#ffb4ab]/10', borderColor: 'border-l-[#ffb4ab]', time: '10:30:00 AM', symbol: 'HDFCBANK', desc: 'RSI Overbought & Breakdown', price: '₹1,445.00', active: false },
  { id: 4, type: 'BUY SIGNAL', typeColor: 'text-[#46f1c5] bg-[#46f1c5]/10', borderColor: 'border-l-[#46f1c5]', time: '10:15:22 AM', symbol: 'INFY', desc: 'VWAP Bounce', price: '₹1,630.50', active: true },
  { id: 5, type: 'STRONG BUY', typeColor: 'text-[#00d4aa] bg-[#00d4aa]/10', borderColor: 'border-l-[#00d4aa]', time: '09:58:00 AM', symbol: 'TCS', desc: 'Breakout above 20-day high', price: '₹3,992.00', active: true },
  { id: 6, type: 'PRICE ALERT', typeColor: 'text-[#c0c6db] bg-[#c0c6db]/10', borderColor: 'border-l-[#c0c6db]', time: '09:45:10 AM', symbol: 'WIPRO', desc: 'Target price ₹480 reached', price: '₹481.20', active: false },
]

export default function Alerts() {
  const [filter, setFilter] = useState('ALL')
  const filters = ['ALL', 'BUY', 'SELL', 'VOLUME']

  const filtered = filter === 'ALL' ? allAlerts : allAlerts.filter(a => a.type.includes(filter.toUpperCase() === 'BUY' ? 'BUY' : filter.toUpperCase() === 'SELL' ? 'SELL' : 'VOLUME'))

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
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00d4aa] opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#00d4aa]" />
            </span>
            <span className="text-[11px] font-bold uppercase tracking-widest text-[#00d4aa]">LIVE</span>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 mb-4">
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
          <button className="ml-auto flex items-center gap-1 px-3 py-1.5 rounded text-xs text-[#bacac2] bg-[#1f2a3c] border border-[#3b4a44] hover:bg-[#2f3a4c] transition-colors font-bold uppercase tracking-wide">
            <span className="material-symbols-outlined text-[14px]">settings</span> Manage
          </button>
        </div>

        {/* Alert list */}
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
                  <div className="font-mono text-sm font-semibold text-[#d8e3fb]">{alert.price}</div>
                  {alert.active && (
                    <button className="text-[10px] text-[#bacac2] hover:text-[#ffb4ab] mt-1 transition-colors">Dismiss</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

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
