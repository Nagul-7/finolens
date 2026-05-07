import { useState } from 'react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts'
import { runBacktest } from '../api/index.js'

const STRATEGIES = [
  { value: 'rsi',    label: 'Mean Reversion (RSI)' },
  { value: 'macd',   label: 'Trend Follower (MACD)' },
  { value: 'custom', label: 'Custom Strategy (My Rules)' },
]

const IND_OPTIONS = [
  { value: 'rsi',  label: 'RSI' },
  { value: 'macd', label: 'MACD Histogram' },
]

const OP_OPTIONS = [
  { value: 'below',         label: '< below' },
  { value: 'above',         label: '> above' },
  { value: 'crosses_above', label: '↑ crosses above' },
  { value: 'crosses_below', label: '↓ crosses below' },
]

const today = new Date().toISOString().split('T')[0]
const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-[#1f2a3c] rounded ${className}`} />
}

function downloadCSV(tradeLog, symbol) {
  const header = 'Date Range,Symbol,Type,Entry,Exit,P&L'
  const rows = tradeLog.map(r => `"${r.dt}","${r.symbol || symbol}","${r.type}",${r.entry},${r.exit},${r.pnl}`)
  const csv = [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `backtest_${symbol}.csv`; a.click()
  URL.revokeObjectURL(url)
}

export default function Backtest() {
  const [symbol, setSymbol]       = useState('RELIANCE')
  const [strategy, setStrategy]   = useState('rsi')
  const [from, setFrom]           = useState(sixMonthsAgo)
  const [to, setTo]               = useState(today)
  const [capital, setCapital]     = useState(100000)

  const [customRules, setCustomRules] = useState({
    entryIndicator: 'rsi', entryOperator: 'crosses_above', entryValue: 30,
    exitIndicator:  'rsi', exitOperator:  'crosses_above', exitValue:  70,
    stopLossPct: 2, targetPct: 5,
  })

  const [running, setRunning]     = useState(false)
  const [result, setResult]       = useState(null)
  const [error, setError]         = useState(null)

  const handleRun = async () => {
    setRunning(true); setError(null); setResult(null)
    try {
      const payload = { symbol: symbol.toUpperCase(), strategy, from, to, capital: +capital }
      if (strategy === 'custom') payload.custom_rules = customRules
      const { data } = await runBacktest(payload)
      setResult(data)
    } catch (e) {
      console.error('Backtest error', e)
      setError('Backtest failed. Check symbol and date range.')
    } finally {
      setRunning(false)
    }
  }

  const stats = result ? [
    { label: 'WIN RATE',      value: `${result.win_rate?.toFixed(1)}%`,  color: 'text-[#00d4aa]' },
    { label: 'TOTAL TRADES',  value: String(result.total_trades),          color: 'text-[#d8e3fb]' },
    { label: 'AVG P&L',       value: `₹${result.avg_pnl?.toFixed(0)}`,    color: result.avg_pnl >= 0 ? 'text-[#00d4aa]' : 'text-[#ffb4ab]' },
    { label: 'MAX DRAWDOWN',  value: `${result.max_drawdown?.toFixed(2)}%`, color: 'text-[#ffb4ab]' },
    { label: 'SHARPE RATIO',  value: result.sharpe_ratio?.toFixed(2),      color: 'text-[#55fcd0]' },
  ] : []

  return (
    <main className="min-h-screen p-4 flex flex-col gap-4 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[#3b4a44] pb-4">
        <h1 className="text-2xl font-semibold text-[#d8e3fb]">Strategy Backtest</h1>
        {result && (
          <button
            onClick={() => downloadCSV(result.trade_log ?? [], symbol)}
            className="flex items-center gap-2 px-4 py-2 bg-[#00d4aa] text-[#005643] hover:bg-[#55fcd0] rounded font-mono text-sm font-bold transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">download</span> Export CSV
          </button>
        )}
      </div>

      {/* Parameters */}
      <div className="bg-[#1f2a3c] border border-[#3b4a44] rounded p-4 flex flex-col md:flex-row items-start md:items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-[11px] font-bold uppercase text-[#bacac2] whitespace-nowrap">SYMBOL</label>
          <input
            value={symbol}
            onChange={e => setSymbol(e.target.value.toUpperCase())}
            className="w-28 bg-[#081425] border border-[#3b4a44] rounded py-1.5 px-3 text-[#d8e3fb] font-mono text-sm focus:border-[#00d4aa] outline-none uppercase"
          />
        </div>

        <div className="flex items-center gap-2">
          <label className="text-[11px] font-bold uppercase text-[#bacac2] whitespace-nowrap">FROM</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="bg-[#081425] border border-[#3b4a44] rounded py-1.5 px-3 text-[#d8e3fb] font-mono text-sm focus:border-[#00d4aa] outline-none" />
        </div>

        <div className="flex items-center gap-2">
          <label className="text-[11px] font-bold uppercase text-[#bacac2] whitespace-nowrap">TO</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="bg-[#081425] border border-[#3b4a44] rounded py-1.5 px-3 text-[#d8e3fb] font-mono text-sm focus:border-[#00d4aa] outline-none" />
        </div>

        <div className="flex items-center gap-2">
          <label className="text-[11px] font-bold uppercase text-[#bacac2] whitespace-nowrap">STRATEGY</label>
          <select value={strategy} onChange={e => setStrategy(e.target.value)}
            className="bg-[#081425] border border-[#3b4a44] rounded py-1.5 px-3 text-[#d8e3fb] font-mono text-sm focus:border-[#00d4aa] outline-none">
            {STRATEGIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-[11px] font-bold uppercase text-[#bacac2] whitespace-nowrap">CAPITAL ₹</label>
          <input type="number" value={capital} onChange={e => setCapital(e.target.value)} min="10000"
            className="w-32 bg-[#081425] border border-[#3b4a44] rounded py-1.5 px-3 text-[#d8e3fb] font-mono text-sm focus:border-[#00d4aa] outline-none" />
        </div>

      </div>

      {/* Custom rules builder */}
      {strategy === 'custom' && (
        <div className="bg-[#081425] border border-[#ffa858]/30 rounded p-4 flex flex-col gap-3">
          <p className="text-[11px] font-bold uppercase text-[#ffa858]">Custom Strategy Rules</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <p className="text-[10px] font-bold uppercase text-[#00d4aa]">Entry Signal</p>
              <div className="flex items-center gap-2 flex-wrap">
                <select value={customRules.entryIndicator} onChange={e => setCustomRules(r => ({ ...r, entryIndicator: e.target.value }))}
                  className="bg-[#1f2a3c] border border-[#3b4a44] rounded py-1 px-2 text-[#d8e3fb] font-mono text-xs focus:border-[#00d4aa] outline-none">
                  {IND_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <select value={customRules.entryOperator} onChange={e => setCustomRules(r => ({ ...r, entryOperator: e.target.value }))}
                  className="bg-[#1f2a3c] border border-[#3b4a44] rounded py-1 px-2 text-[#d8e3fb] font-mono text-xs focus:border-[#00d4aa] outline-none">
                  {OP_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <input type="number" value={customRules.entryValue} onChange={e => setCustomRules(r => ({ ...r, entryValue: e.target.value }))}
                  className="w-20 bg-[#1f2a3c] border border-[#3b4a44] rounded py-1 px-2 text-[#d8e3fb] font-mono text-xs focus:border-[#00d4aa] outline-none" />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-[10px] font-bold uppercase text-[#ffb4ab]">Exit Signal</p>
              <div className="flex items-center gap-2 flex-wrap">
                <select value={customRules.exitIndicator} onChange={e => setCustomRules(r => ({ ...r, exitIndicator: e.target.value }))}
                  className="bg-[#1f2a3c] border border-[#3b4a44] rounded py-1 px-2 text-[#d8e3fb] font-mono text-xs focus:border-[#00d4aa] outline-none">
                  {IND_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <select value={customRules.exitOperator} onChange={e => setCustomRules(r => ({ ...r, exitOperator: e.target.value }))}
                  className="bg-[#1f2a3c] border border-[#3b4a44] rounded py-1 px-2 text-[#d8e3fb] font-mono text-xs focus:border-[#00d4aa] outline-none">
                  {OP_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <input type="number" value={customRules.exitValue} onChange={e => setCustomRules(r => ({ ...r, exitValue: e.target.value }))}
                  className="w-20 bg-[#1f2a3c] border border-[#3b4a44] rounded py-1 px-2 text-[#d8e3fb] font-mono text-xs focus:border-[#00d4aa] outline-none" />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-[10px] font-bold uppercase text-[#bacac2]">Stop Loss %</label>
              <input type="number" value={customRules.stopLossPct} min="0.5" max="20" step="0.5"
                onChange={e => setCustomRules(r => ({ ...r, stopLossPct: e.target.value }))}
                className="w-20 bg-[#1f2a3c] border border-[#3b4a44] rounded py-1 px-2 text-[#d8e3fb] font-mono text-xs focus:border-[#00d4aa] outline-none" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[10px] font-bold uppercase text-[#bacac2]">Target %</label>
              <input type="number" value={customRules.targetPct} min="0.5" max="50" step="0.5"
                onChange={e => setCustomRules(r => ({ ...r, targetPct: e.target.value }))}
                className="w-20 bg-[#1f2a3c] border border-[#3b4a44] rounded py-1 px-2 text-[#d8e3fb] font-mono text-xs focus:border-[#00d4aa] outline-none" />
            </div>
          </div>
        </div>
      )}

      <div className="bg-[#1f2a3c] border border-[#3b4a44] rounded p-4 flex justify-end">
        <button
          onClick={handleRun}
          disabled={running}
          className="px-6 py-2 bg-[#00d4aa] text-[#005643] hover:bg-[#55fcd0] rounded font-mono text-sm font-bold transition-colors disabled:opacity-60 flex items-center gap-2"
        >
          {running ? (
            <>
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              RUNNING…
            </>
          ) : 'RUN BACKTEST'}
        </button>
      </div>

      {error && <div className="p-3 bg-[#ffb4ab]/10 border border-[#ffb4ab]/30 rounded text-[#ffb4ab] text-sm">{error}</div>}

      {/* Placeholder while idle */}
      {!result && !running && !error && (
        <div className="bg-[#1f2a3c] border border-[#3b4a44] rounded p-12 text-center">
          <span className="material-symbols-outlined text-[48px] text-[#3b4a44]">bar_chart</span>
          <p className="text-[#bacac2] mt-3">Configure parameters above and click Run Backtest.</p>
        </div>
      )}

      {running && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      )}

      {result && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {stats.map(s => (
              <div key={s.label} className="bg-[#1f2a3c] border border-[#3b4a44] rounded p-3 flex flex-col items-center text-center">
                <span className="text-[11px] font-bold uppercase tracking-wide text-[#bacac2] mb-1">{s.label}</span>
                <span className={`font-mono text-lg font-semibold ${s.color}`}>{s.value}</span>
              </div>
            ))}
          </div>

          {/* Equity Curve */}
          <div className="bg-[#1f2a3c] border border-[#3b4a44] rounded flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-[#3b4a44] flex justify-between items-center bg-[#040e1f]/50">
              <span className="text-[11px] font-bold uppercase text-[#d8e3fb]">EQUITY CURVE VS BENCHMARK</span>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2"><div className="w-3 h-0.5 bg-[#00d4aa]" /><span className="font-mono text-[10px] text-[#bacac2]">Strategy</span></div>
                <div className="flex items-center gap-2"><div className="w-3 h-0.5 bg-[#3b4a44]" /><span className="font-mono text-[10px] text-[#bacac2]">Nifty B&H</span></div>
              </div>
            </div>
            <div className="p-4" style={{ minHeight: 280 }}>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={result.equity_curve ?? []}>
                  <XAxis dataKey="t" tick={{ fill: '#bacac2', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#bacac2', fontSize: 10 }} axisLine={false} tickLine={false} width={40} />
                  <Tooltip contentStyle={{ background: '#1f2a3c', border: '1px solid #3b4a44', color: '#d8e3fb', fontSize: 12 }} />
                  <Line type="monotone" dataKey="benchmark" stroke="#3b4a44" dot={false} strokeWidth={2} name="Nifty B&H" />
                  <Line type="monotone" dataKey="strategy" stroke="#00d4aa" dot={false} strokeWidth={3} name="Strategy" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Trade log */}
          {(result.trade_log?.length ?? 0) > 0 && (
            <div className="bg-[#1f2a3c] border border-[#3b4a44] rounded flex flex-col overflow-hidden">
              <div className="px-4 py-3 border-b border-[#3b4a44] bg-[#040e1f]/50">
                <span className="text-[11px] font-bold uppercase text-[#d8e3fb]">EXECUTION LOG ({result.trade_log.length} trades)</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse whitespace-nowrap">
                  <thead className="bg-[#152031] text-[11px] font-bold uppercase text-[#bacac2] border-b border-[#3b4a44]">
                    <tr>
                      {['Date Range', 'Symbol', 'Type', 'Entry', 'Exit', 'P&L'].map(h => (
                        <th key={h} className={`px-4 py-2 ${['Entry', 'Exit', 'P&L'].includes(h) ? 'text-right' : ''}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="font-mono text-sm text-[#d8e3fb]">
                    {result.trade_log.map((row, i) => (
                      <tr key={i} className={`border-b border-[#3b4a44]/30 hover:bg-[#2f3a4c] transition-colors ${row.positive ? 'bg-[#00d4aa]/5' : 'bg-[#93000a]/10'}`}>
                        <td className="px-4 py-2 text-[#bacac2]">{row.dt}</td>
                        <td className="px-4 py-2 font-bold">{row.symbol ?? symbol}</td>
                        <td className="px-4 py-2">
                          <span className={`bg-[#081425] border border-[#3b4a44] px-1.5 py-0.5 rounded text-[10px] ${row.type === 'LONG' ? 'text-[#00d4aa]' : 'text-[#ffb4ab]'}`}>{row.type}</span>
                        </td>
                        <td className="px-4 py-2 text-right">₹{row.entry?.toLocaleString('en-IN')}</td>
                        <td className="px-4 py-2 text-right">₹{row.exit?.toLocaleString('en-IN')}</td>
                        <td className={`px-4 py-2 text-right font-bold ${row.positive ? 'text-[#00d4aa]' : 'text-[#ffb4ab]'}`}>
                          {row.positive ? '+' : ''}₹{Math.abs(row.pnl ?? 0).toLocaleString('en-IN')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  )
}
