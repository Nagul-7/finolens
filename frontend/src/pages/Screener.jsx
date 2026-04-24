import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getScreener } from '../api/index.js'

const SECTORS = ['All Sectors', 'Banking', 'Information Tech', 'Automobiles', 'Pharma', 'Finance', 'FMCG', 'Energy', 'Metals', 'Infrastructure', 'Consumer', 'Insurance']
const SIGNAL_OPTIONS = ['BUY', 'NEUTRAL', 'SELL']
const VOL_OPTIONS = ['Any', '1x', '2x', 'spike']

const SCORE_COLOR = score =>
  score >= 70 ? 'bg-[#00d4aa]/20 text-[#00d4aa] border border-[#00d4aa]/30'
  : score >= 50 ? 'bg-[#ffa858]/20 text-[#ffa858] border border-[#ffa858]/30'
  : 'bg-[#ffb4ab]/20 text-[#ffb4ab] border border-[#ffb4ab]/30'

const SIGNAL_COLOR = sig =>
  sig === 'BUY' ? 'text-[#46f1c5] bg-[#46f1c5]/10 border-[#46f1c5]/20'
  : sig === 'SELL' ? 'text-[#ffb4ab] bg-[#ffb4ab]/10 border-[#ffb4ab]/20'
  : 'text-[#c0c6db] bg-[#c0c6db]/10 border-[#c0c6db]/20'

export default function Screener() {
  const navigate = useNavigate()
  const [results, setResults]     = useState([])
  const [loading, setLoading]     = useState(true)
  const [scanning, setScanning]   = useState(false)
  const [error, setError]         = useState(null)

  const [signalTypes, setSignalTypes] = useState({ BUY: true, NEUTRAL: true, SELL: false })
  const [confidence, setConfidence]   = useState(50)
  const [sector, setSector]           = useState('All Sectors')
  const [volFilter, setVolFilter]     = useState('Any')
  const [rsiMin, setRsiMin]           = useState(30)
  const [rsiMax, setRsiMax]           = useState(70)

  const buildFilters = () => {
    const activeSignals = Object.entries(signalTypes).filter(([, v]) => v).map(([k]) => k)
    const f = {}
    if (activeSignals.length && activeSignals.length < 3) f.signal = activeSignals[0]
    if (confidence > 50) f.min_score = confidence
    if (sector !== 'All Sectors') f.sector = sector
    if (volFilter !== 'Any') f.volume = volFilter
    if (rsiMin !== 30 || rsiMax !== 70) { f.rsi_min = rsiMin; f.rsi_max = rsiMax }
    return f
  }

  const scan = async (isManual = false) => {
    if (isManual) setScanning(true); else setLoading(true)
    setError(null)
    try {
      const { data } = await getScreener(buildFilters())
      setResults(Array.isArray(data) ? data : [])
    } catch (e) {
      console.error('Screener error', e)
      setError('Screener scan failed. Retrying…')
    } finally {
      setLoading(false); setScanning(false)
    }
  }

  useEffect(() => { scan() }, [])

  const toggleSignal = key => setSignalTypes(prev => ({ ...prev, [key]: !prev[key] }))

  const setRsiPreset = (min, max) => { setRsiMin(min); setRsiMax(max) }

  return (
    <main className="h-[calc(100vh-7rem)] flex overflow-hidden bg-[#081425]">
      {/* Sidebar */}
      <aside className="w-72 bg-[#0a0e1a] border-r border-[#1e293b] flex flex-col h-full overflow-y-auto">
        <div className="p-4 border-b border-[#1e293b] flex justify-between items-center sticky top-0 bg-[#0a0e1a] z-10">
          <h2 className="text-lg font-semibold text-slate-200">Screener Filters</h2>
          <button
            onClick={() => { setSignalTypes({ BUY: true, NEUTRAL: true, SELL: false }); setConfidence(50); setSector('All Sectors'); setVolFilter('Any'); setRsiMin(30); setRsiMax(70) }}
            className="text-slate-400 hover:text-slate-100 text-xs flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[14px]">refresh</span> Reset
          </button>
        </div>
        <div className="p-4 flex flex-col gap-6">
          {/* Signal Type */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-3 block">Signal Type</label>
            <div className="flex flex-col gap-2">
              {SIGNAL_OPTIONS.map(key => (
                <label key={key} className="flex items-center gap-2 text-slate-300 text-sm cursor-pointer hover:bg-[#111827] p-1 rounded">
                  <input type="checkbox" checked={signalTypes[key]} onChange={() => toggleSignal(key)} className="rounded border-[#3b4a44] bg-[#111827] accent-[#46f1c5]" />
                  {key}
                </label>
              ))}
            </div>
          </div>

          {/* Confidence slider */}
          <div>
            <div className="flex justify-between items-center mb-3">
              <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Min Score</label>
              <span className="text-xs text-[#46f1c5] font-mono">&gt;{confidence}</span>
            </div>
            <input type="range" min="0" max="100" value={confidence} onChange={e => setConfidence(+e.target.value)}
              className="w-full accent-[#46f1c5] h-1 bg-[#1e293b] rounded-full appearance-none cursor-pointer" />
            <div className="flex justify-between text-xs text-slate-500 mt-1"><span>0</span><span>100</span></div>
          </div>

          {/* Sector */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-3 block">Sector</label>
            <select value={sector} onChange={e => setSector(e.target.value)}
              className="w-full bg-[#111827] border border-[#1e293b] rounded px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-[#00d4aa]">
              {SECTORS.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>

          {/* Volume */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-3 block">Volume Filter</label>
            <div className="grid grid-cols-2 gap-2">
              {VOL_OPTIONS.map(opt => (
                <button key={opt} onClick={() => setVolFilter(opt)}
                  className={`py-1.5 px-2 rounded text-xs transition-colors ${volFilter === opt ? 'bg-[#46f1c5]/10 border border-[#46f1c5] text-[#46f1c5] font-medium' : 'bg-[#111827] border border-[#1e293b] text-slate-300 hover:bg-[#1c2533]'}`}>
                  {opt === 'spike' ? 'Spike Vol' : opt === 'Any' ? 'Any' : `>${opt} Avg`}
                </button>
              ))}
            </div>
          </div>

          {/* RSI Range */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-3 block">RSI (14) Range</label>
            <div className="flex items-center gap-2">
              <input type="number" value={rsiMin} onChange={e => setRsiMin(+e.target.value)} min="0" max="100"
                className="w-full bg-[#111827] border border-[#1e293b] rounded px-2 py-1.5 text-sm text-slate-300 focus:outline-none focus:border-[#00d4aa]" />
              <span className="text-slate-500">-</span>
              <input type="number" value={rsiMax} onChange={e => setRsiMax(+e.target.value)} min="0" max="100"
                className="w-full bg-[#111827] border border-[#1e293b] rounded px-2 py-1.5 text-sm text-slate-300 focus:outline-none focus:border-[#00d4aa]" />
            </div>
            <div className="flex gap-2 mt-2">
              <button onClick={() => setRsiPreset(0, 30)} className="text-xs text-slate-400 hover:text-[#46f1c5] bg-[#111827] px-2 py-1 rounded border border-[#1e293b]">Oversold &lt;30</button>
              <button onClick={() => setRsiPreset(70, 100)} className="text-xs text-slate-400 hover:text-[#46f1c5] bg-[#111827] px-2 py-1 rounded border border-[#1e293b]">Overbought &gt;70</button>
            </div>
          </div>

          <button
            onClick={() => scan(true)}
            disabled={scanning}
            className="w-full py-2 bg-[#00d4aa] text-[#005643] rounded font-bold text-sm flex items-center justify-center gap-2 hover:bg-[#46f1c5] transition-colors disabled:opacity-60"
          >
            {scanning ? (
              <>
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                SCANNING…
              </>
            ) : 'SCAN NOW'}
          </button>
        </div>
      </aside>

      {/* Table */}
      <div className="flex-1 flex flex-col bg-[#0a0e1a] p-4 overflow-hidden">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-slate-200">Screener Results</h2>
            {!loading && (
              <span className="bg-[#111827] border border-[#1e293b] text-slate-400 px-2 py-0.5 rounded text-xs">{results.length} Matches</span>
            )}
          </div>
        </div>

        {error && <div className="mb-3 p-3 bg-[#ffb4ab]/10 border border-[#ffb4ab]/30 rounded text-[#ffb4ab] text-sm">{error}</div>}

        <div className="flex-1 bg-[#111827] border border-[#1e293b] rounded overflow-auto">
          <table className="w-full text-left border-collapse whitespace-nowrap">
            <thead className="sticky top-0 bg-[#111827] z-10 text-[11px] font-bold uppercase text-slate-400 border-b border-[#1e293b]">
              <tr>
                {['Symbol', 'Sector', 'LTP', 'Change %', 'Score', 'Signal', 'Trigger Reason'].map(h => (
                  <th key={h} className={`px-3 py-3 ${h === 'LTP' || h === 'Change %' ? 'text-right' : h === 'Score' || h === 'Signal' ? 'text-center' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="font-mono text-sm text-slate-300">
              {loading ? (
                [...Array(8)].map((_, i) => (
                  <tr key={i} className="border-b border-[#1e293b]">
                    {[...Array(7)].map((_, j) => (
                      <td key={j} className="px-3 py-3"><div className="h-4 bg-[#1e293b] rounded animate-pulse" /></td>
                    ))}
                  </tr>
                ))
              ) : results.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-slate-500">No matches for current filters.</td>
                </tr>
              ) : (
                results.map(row => (
                  <tr
                    key={row.symbol}
                    className="border-b border-[#1e293b] hover:bg-[#1c2533] transition-colors cursor-pointer"
                    onClick={() => navigate(`/intelligence/${row.symbol}`)}
                  >
                    <td className="px-3 py-3 font-bold text-slate-200">{row.symbol}</td>
                    <td className="px-3 py-3 text-slate-400 text-xs">{row.sector}</td>
                    <td className="px-3 py-3 text-right">₹{row.ltp?.toLocaleString('en-IN')}</td>
                    <td className={`px-3 py-3 text-right ${row.change_pct >= 0 ? 'text-[#46f1c5]' : 'text-[#ffb4ab]'}`}>
                      {row.change_pct >= 0 ? '+' : ''}{row.change_pct?.toFixed(2)}%
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${SCORE_COLOR(row.score)}`}>
                        {row.score?.toFixed(1)}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded border text-[10px] font-bold tracking-wider ${SIGNAL_COLOR(row.signal)}`}>
                        {row.signal}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-400 max-w-xs truncate">{row.trigger_reason}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  )
}
