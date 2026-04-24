import { useState, useEffect } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts'
import { getOptionsChain } from '../api/index.js'

const SYMBOLS = ['NIFTY', 'BANKNIFTY']

function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-[#152031] rounded ${className}`} />
}

export default function Options() {
  const [symbol, setSymbol]   = useState('NIFTY')
  const [chain, setChain]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [noBroker, setNoBroker] = useState(false)
  const [error, setError]     = useState(null)

  useEffect(() => {
    setLoading(true); setNoBroker(false); setError(null); setChain(null)
    getOptionsChain(symbol)
      .then(res => setChain(res.data))
      .catch(err => {
        if (err?.response?.status === 404) setNoBroker(true)
        else setError('Failed to fetch options data.')
      })
      .finally(() => setLoading(false))
  }, [symbol])

  const expiry    = chain?.expiry ?? '—'
  const pcr       = chain?.pcr ?? null
  const maxPain   = chain?.max_pain ?? null
  const spotPrice = chain?.spot_price ?? null
  const aiSignal  = chain?.ai_signal ?? null
  const rows      = chain?.chain ?? []

  const oiData = rows.slice(0, 10).map(r => ({
    strike: String(r.strike),
    callOI: r.call_oi,
    putOI: r.put_oi,
  }))

  return (
    <main className="min-h-screen p-4 space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 border-b border-[#2a3548] pb-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00d4aa] opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#00d4aa]" />
            </span>
            <span className="text-[11px] font-bold uppercase tracking-widest text-[#00d4aa]">OPTIONS SUITE</span>
          </div>
          <h1 className="text-2xl font-semibold text-[#d8e3fb]">{symbol} Options</h1>
          {spotPrice && (
            <div className="font-mono text-sm text-[#c0c6db] mt-1 flex gap-4">
              <span>Spot: <span className="text-[#d8e3fb]">₹{spotPrice.toLocaleString('en-IN')}</span></span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-2">
            {SYMBOLS.map(s => (
              <button
                key={s}
                onClick={() => setSymbol(s)}
                className={`px-4 py-1.5 rounded font-mono text-sm font-bold transition-colors ${symbol === s ? 'bg-[#00d4aa] text-[#005643]' : 'bg-[#152031] border border-[#3b4a44] text-[#d8e3fb] hover:bg-[#2a3548]'}`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Broker connection required */}
      {noBroker && (
        <div className="bg-[#152031] border border-[#ffa858]/40 rounded-lg p-8 text-center flex flex-col items-center gap-4">
          <span className="material-symbols-outlined text-[48px] text-[#ffa858]">link_off</span>
          <div>
            <h2 className="text-lg font-semibold text-[#d8e3fb] mb-2">Live options data requires broker connection</h2>
            <p className="text-sm text-[#bacac2] max-w-md">
              Connect Zerodha Kite or Angel One to enable live options chain, OI analysis, and PCR data for {symbol}.
            </p>
          </div>
          <button className="mt-2 flex items-center gap-2 bg-[#ffa858] text-[#3a1e00] px-6 py-2.5 rounded font-bold text-sm hover:bg-[#ffbc7a] transition-colors">
            <span className="material-symbols-outlined text-[18px]">link</span>
            Connect Broker
          </button>
          <p className="text-[11px] text-[#85948d]">Supported: Zerodha Kite · Angel One · Upstox · Fyers</p>
        </div>
      )}

      {/* Error */}
      {error && !noBroker && (
        <div className="p-4 bg-[#ffb4ab]/10 border border-[#ffb4ab]/30 rounded text-[#ffb4ab] text-sm">{error}</div>
      )}

      {/* Loading */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="md:col-span-2 h-36" />
          <Skeleton className="h-36" />
          <Skeleton className="col-span-full h-64" />
        </div>
      )}

      {/* Data */}
      {!loading && !noBroker && chain && (
        <>
          {/* AI Signal + PCR */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 bg-[#152031] border border-[#00d4aa]/30 rounded-lg p-5 relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-[#00d4aa]/10 to-transparent pointer-events-none" />
              <div className="text-[11px] font-bold uppercase tracking-widest text-[#00d4aa] mb-2 flex items-center gap-2">
                <span className="material-symbols-outlined text-[14px]">smart_toy</span> AI RECOMMENDATION
              </div>
              <div className="text-lg font-semibold text-[#d8e3fb] flex items-center gap-3 mb-2">
                {aiSignal?.signal ?? 'Analysing...'}
                <span className="bg-[#00d4aa] text-[#005643] px-2 py-0.5 rounded text-sm font-bold">{aiSignal?.action ?? '—'}</span>
              </div>
              <p className="text-sm text-[#bacac2] mb-4">{aiSignal?.reason ?? 'Options data analysis in progress.'}</p>
              {maxPain && (
                <div className="flex gap-2 font-mono text-sm flex-wrap">
                  <span className="bg-[#081425] border border-[#1e293b] px-2 py-1 rounded text-[#ffa858]">Max Pain: ₹{maxPain.toLocaleString('en-IN')}</span>
                  <span className="bg-[#081425] border border-[#1e293b] px-2 py-1 rounded text-[#d8e3fb]">Expiry: {expiry}</span>
                </div>
              )}
            </div>

            <div className="bg-[#152031] border border-[#3b4a44] rounded-lg p-5 flex flex-col justify-center items-center">
              <div className="text-[11px] font-bold uppercase tracking-widest text-[#bacac2] mb-3">PUT CALL RATIO (PCR)</div>
              <div className={`text-2xl font-semibold mb-3 ${pcr >= 1 ? 'text-[#00d4aa]' : 'text-[#ffb4ab]'}`}>{pcr?.toFixed(2) ?? '—'}</div>
              {pcr != null && (
                <>
                  <div className="w-full max-w-[200px] h-2 bg-[#2a3548] rounded-full flex overflow-hidden relative mb-2">
                    <div className="bg-[#ffb4ab] w-1/3" />
                    <div className="bg-[#404758] w-1/3" />
                    <div className="bg-[#00d4aa] w-1/3" />
                    <div className="absolute top-0 bottom-0 w-0.5 bg-[#d8e3fb] z-10"
                      style={{ left: `${Math.min(95, Math.max(5, (pcr / 2) * 100))}%` }} />
                  </div>
                  <div className="w-full max-w-[200px] flex justify-between text-[9px] font-bold uppercase text-[#bacac2]/60 px-1">
                    <span className="text-[#ffb4ab]">BEARISH</span>
                    <span>NEUTRAL</span>
                    <span className="text-[#00d4aa]">BULLISH</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Options Chain */}
          {rows.length > 0 && (
            <div className="bg-[#152031] border border-[#3b4a44] rounded-lg overflow-hidden">
              <div className="p-3 border-b border-[#3b4a44] flex justify-between items-center bg-[#0a0e1a]">
                <h2 className="text-[11px] font-bold uppercase tracking-widest text-[#d8e3fb]">Options Chain — {expiry}</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[700px]">
                  <thead>
                    <tr className="text-[11px] font-bold text-[#c0c6db] border-b border-[#1e293b] bg-[#0a0e1a]">
                      <th className="p-2 text-right border-r border-[#1e293b]" colSpan={4}>CALLS</th>
                      <th className="p-2 text-center bg-[#1c2533] border-r border-[#1e293b]">STRIKE</th>
                      <th className="p-2 text-left" colSpan={4}>PUTS</th>
                    </tr>
                    <tr className="text-[10px] text-[#c0c6db] border-b border-[#1e293b] bg-[#0a0e1a]">
                      {['OI', 'IV', 'Vol', 'LTP'].map(h => <th key={`c-${h}`} className="p-2 text-right font-normal">{h}</th>)}
                      <th className="p-2 text-center bg-[#1c2533] border-x border-[#1e293b]">PRICE</th>
                      {['LTP', 'Vol', 'IV', 'OI'].map(h => <th key={`p-${h}`} className="p-2 text-left font-normal">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody className="font-mono text-xs">
                    {rows.map(row => (
                      <tr key={row.strike} className={`border-b border-[#1e293b] hover:bg-[#1e293b] transition-colors ${row.atm ? 'border-b-2 border-b-[#00d4aa]' : ''}`}>
                        <td className="p-2 text-right text-[#bacac2]">{(row.call_oi / 1e5).toFixed(1)}L</td>
                        <td className="p-2 text-right">{row.call_iv?.toFixed(1) ?? '—'}</td>
                        <td className="p-2 text-right">{row.call_volume?.toLocaleString('en-IN') ?? '—'}</td>
                        <td className="p-2 text-right border-r border-[#1e293b] text-[#00d4aa]">₹{row.call_ltp?.toFixed(2) ?? '—'}</td>
                        <td className={`p-2 text-center font-bold border-r border-[#1e293b] bg-[#1c2533] ${row.strike === maxPain ? 'text-[#ffa858]' : 'text-[#d8e3fb]'}`}>
                          {row.strike.toLocaleString('en-IN')}
                          {row.strike === maxPain && <div className="text-[9px] text-[#ffa858]">MAX PAIN</div>}
                        </td>
                        <td className="p-2 text-left text-[#ffb4ab]">₹{row.put_ltp?.toFixed(2) ?? '—'}</td>
                        <td className="p-2 text-left">{row.put_volume?.toLocaleString('en-IN') ?? '—'}</td>
                        <td className="p-2 text-left">{row.put_iv?.toFixed(1) ?? '—'}</td>
                        <td className="p-2 text-left text-[#bacac2]">{(row.put_oi / 1e5).toFixed(1)}L</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* OI Buildup */}
          {oiData.length > 0 && (
            <div className="bg-[#152031] border border-[#3b4a44] rounded-lg p-5">
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-[#bacac2] mb-4">OI BUILDUP</h3>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={oiData} barCategoryGap="20%">
                    <XAxis dataKey="strike" tick={{ fill: '#bacac2', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#bacac2', fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
                    <Tooltip contentStyle={{ background: '#1f2a3c', border: '1px solid #3b4a44', color: '#d8e3fb', fontSize: 12 }} />
                    <Bar dataKey="callOI" name="Call OI" fill="#2a3548" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="putOI" name="Put OI" fill="#00d4aa" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  )
}
