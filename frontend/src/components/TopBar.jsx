import { useState, useEffect } from 'react'
import { getIndex } from '../api/index.js'

function isMarketOpen() {
  const now = new Date()
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000)
  const day = ist.getUTCDay()
  if (day === 0 || day === 6) return false
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes()
  return mins >= 555 && mins <= 930
}

export default function TopBar() {
  const [nifty, setNifty]     = useState(null)
  const [banknifty, setBanknifty] = useState(null)
  const [open, setOpen]       = useState(isMarketOpen())

  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await getIndex()
        setNifty(data.nifty)
        setBanknifty(data.banknifty)
      } catch (e) {
        console.error('TopBar index fetch error', e)
      }
      setOpen(isMarketOpen())
    }
    load()
    const id = setInterval(load, 60000)
    return () => clearInterval(id)
  }, [])

  const fmt = (val, pct) => {
    if (val == null) return { price: '—', change: '', pos: true }
    const sign = pct >= 0 ? '+' : ''
    return { price: val.toLocaleString('en-IN'), change: `(${sign}${pct?.toFixed(2)}%)`, pos: pct >= 0 }
  }

  const n = fmt(nifty?.ltp, nifty?.change_pct)
  const b = fmt(banknifty?.ltp, banknifty?.change_pct)

  return (
    <header className="fixed top-0 w-full z-50 flex justify-between items-center h-14 px-4 bg-[#0a0e1a] border-b border-[#1e293b]">
      <div className="flex items-center gap-4">
        <span className="text-xl font-black tracking-tighter text-[#00d4aa]">FinoLens Terminal</span>
        <div className="hidden lg:flex items-center gap-4 border-l border-[#1e293b] pl-4">
          <div className="flex items-center gap-2 bg-[#1e293b] px-3 py-1 rounded">
            <span className="font-mono text-xs text-slate-400">NIFTY 50: {n.price}</span>
            {nifty && <span className={`font-mono text-xs ${n.pos ? 'text-[#00d4aa]' : 'text-[#ffb4ab]'}`}>{n.change}</span>}
          </div>
          <div className="flex items-center gap-2 bg-[#1e293b] px-3 py-1 rounded">
            <span className="font-mono text-xs text-slate-400">BANK NIFTY: {b.price}</span>
            {banknifty && <span className={`font-mono text-xs ${b.pos ? 'text-[#00d4aa]' : 'text-[#ffb4ab]'}`}>{b.change}</span>}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className={`hidden md:flex items-center gap-1.5 px-2 py-1 rounded border ${open ? 'bg-[#00d4aa]/10 border-[#00d4aa]/20' : 'bg-[#1e293b] border-[#2a3548]'}`}>
          <div className={`w-2 h-2 rounded-full ${open ? 'bg-[#00d4aa] animate-pulse-slow' : 'bg-slate-500'}`} />
          <span className={`text-[10px] font-bold uppercase tracking-widest ${open ? 'text-[#00d4aa]' : 'text-slate-500'}`}>
            {open ? 'MARKET OPEN' : 'MARKET CLOSED'}
          </span>
        </div>
        <button className="p-1.5 rounded text-slate-400 hover:bg-[#1e293b] transition-colors">
          <span className="material-symbols-outlined text-[20px]">notifications</span>
        </button>
        <button className="p-1.5 rounded text-slate-400 hover:bg-[#1e293b] transition-colors">
          <span className="material-symbols-outlined text-[20px]">settings</span>
        </button>
        <button className="p-1.5 rounded text-slate-400 hover:bg-[#1e293b] transition-colors">
          <span className="material-symbols-outlined text-[20px]">account_circle</span>
        </button>
      </div>
    </header>
  )
}
