// ─── Indicator Engine ─────────────────────────────────────────────────────────
// All indicator computations live here.
// Each function is standalone and exported — add new indicators here only.

// ─── Core computations ────────────────────────────────────────────────────────

export function computeEMA(values, period) {
  if (!values || values.length === 0) return []
  const k = 2 / (period + 1)
  const out = []
  let ema = values[0]
  for (let i = 0; i < values.length; i++) {
    ema = i === 0 ? values[0] : values[i] * k + ema * (1 - k)
    out.push(ema)
  }
  return out
}

export function computeSMA(values, period) {
  if (!values || values.length < period) return []
  const out = new Array(period - 1).fill(null)
  for (let i = period - 1; i < values.length; i++) {
    const sum = values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0)
    out.push(sum / period)
  }
  return out
}

export function computeBollingerBands(values, period = 20, stdMult = 2) {
  const sma = computeSMA(values, period)
  const upper = [], lower = []
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { upper.push(null); lower.push(null); continue }
    const slice = values.slice(i - period + 1, i + 1)
    const mean  = sma[i]
    const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period
    const std = Math.sqrt(variance)
    upper.push(mean + stdMult * std)
    lower.push(mean - stdMult * std)
  }
  return { middle: sma, upper, lower }
}

export function computeVWAP(bars) {
  const out = []
  let cumTPV = 0, cumVol = 0
  for (const b of bars) {
    const tp = (b.high + b.low + b.close) / 3
    cumTPV += tp * b.volume
    cumVol += b.volume
    out.push(cumVol > 0 ? cumTPV / cumVol : b.close)
  }
  return out
}

export function computeRSI(closes, period = 14) {
  if (closes.length < period + 1) return []
  const out = new Array(period).fill(null)
  let avgGain = 0, avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1]
    if (d > 0) avgGain += d; else avgLoss -= d
  }
  avgGain /= period; avgLoss /= period
  out.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss))
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    avgGain = (avgGain * (period - 1) + Math.max(0, d)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -d)) / period
    out.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss))
  }
  return out
}

export function computeMACD(closes, fast = 12, slow = 26, signal = 9) {
  const emaFast = computeEMA(closes, fast)
  const emaSlow = computeEMA(closes, slow)
  const macdLine = closes.map((_, i) => emaFast[i] - emaSlow[i])
  const signalLine = computeEMA(macdLine.slice(slow - 1), signal)
  const hist = signalLine.map((v, i) => macdLine[i + slow - 1] - v)
  return { macdLine, signalLine, hist, offset: slow - 1 }
}

// SuperTrend — returns {values, trend} where trend[i]=1 (bullish) or -1 (bearish)
export function computeSuperTrend(candles, period = 10, multiplier = 3) {
  const n = candles.length
  if (n < period + 5) return { values: new Array(n).fill(null), trend: new Array(n).fill(0) }
  const atr = new Array(n).fill(0)
  for (let i = 1; i < n; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low  - candles[i - 1].close)
    )
    atr[i] = i < period ? tr : (atr[i - 1] * (period - 1) + tr) / period
  }
  const upper = new Array(n).fill(0)
  const lower = new Array(n).fill(0)
  const st    = new Array(n).fill(0)
  for (let i = 1; i < n; i++) {
    const hl2 = (candles[i].high + candles[i].low) / 2
    const bu = hl2 + multiplier * atr[i]
    const bl = hl2 - multiplier * atr[i]
    upper[i] = (bu < upper[i - 1] || candles[i - 1].close > upper[i - 1]) ? bu : upper[i - 1]
    lower[i] = (bl > lower[i - 1] || candles[i - 1].close < lower[i - 1]) ? bl : lower[i - 1]
    if (st[i - 1] === upper[i - 1]) {
      st[i] = candles[i].close > upper[i] ? lower[i] : upper[i]
    } else {
      st[i] = candles[i].close < lower[i] ? upper[i] : lower[i]
    }
  }
  const trend = st.map((v, i) => (candles[i].close > v ? 1 : -1))
  return { values: st, trend }
}

// Standard pivot points from previous session H/L/C
export function computePivotPoints(prevH, prevL, prevC) {
  const p   = (prevH + prevL + prevC) / 3
  const r1  = 2 * p - prevL
  const s1  = 2 * p - prevH
  const r2  = p + (prevH - prevL)
  const s2  = p - (prevH - prevL)
  const r3  = prevH + 2 * (p - prevL)
  const s3  = prevL - 2 * (prevH - p)
  return { p, r1, r2, r3, s1, s2, s3 }
}

// Fibonacci retracement levels
export function computeFibonacci(high, low) {
  const range = high - low
  return {
    high,  low,
    f236: high - 0.236 * range,
    f382: high - 0.382 * range,
    f500: high - 0.500 * range,
    f618: high - 0.618 * range,
    f786: high - 0.786 * range,
  }
}

// ─── Signal Markers ───────────────────────────────────────────────────────────
// showText=false → clean colored arrows with no label (for Intelligence tab)
// showText=true  → arrows with short label text (for Charts compare panel)

export function buildRSIMarkers(times, closes, period = 14, showText = true) {
  const rsi = computeRSI(closes, period)
  const markers = []
  for (let i = 1; i < rsi.length; i++) {
    const r = rsi[i], p = rsi[i - 1]
    if (r == null || p == null) continue
    if (p >= 30 && r < 30)
      markers.push({ time: times[i], position: 'belowBar', color: '#00d4aa', shape: 'arrowUp',   text: showText ? 'RSI↑' : '' })
    if (p <= 70 && r > 70)
      markers.push({ time: times[i], position: 'aboveBar', color: '#ffb4ab', shape: 'arrowDown', text: showText ? 'RSI↓' : '' })
  }
  return markers
}

export function buildMACDMarkers(times, closes, showText = true) {
  const { hist, offset } = computeMACD(closes)
  const markers = []
  for (let i = 1; i < hist.length; i++) {
    const h = hist[i], p = hist[i - 1]
    if (h == null || p == null) continue
    const ti = times[i + offset]
    if (!ti) continue
    if (p <= 0 && h > 0)
      markers.push({ time: ti, position: 'belowBar', color: '#00d4aa', shape: 'arrowUp',   text: showText ? 'MACD↑' : '' })
    if (p >= 0 && h < 0)
      markers.push({ time: ti, position: 'aboveBar', color: '#ffb4ab', shape: 'arrowDown', text: showText ? 'MACD↓' : '' })
  }
  return markers
}

export function buildBBMarkers(times, closes, period = 20, showText = true) {
  const { upper, lower } = computeBollingerBands(closes, period)
  const markers = []
  for (let i = 1; i < closes.length; i++) {
    if (upper[i] == null) continue
    if (closes[i - 1] >= upper[i - 1] && closes[i] < upper[i])
      markers.push({ time: times[i], position: 'aboveBar', color: '#ffb4ab', shape: 'arrowDown', text: showText ? 'BB↓' : '' })
    if (closes[i - 1] <= lower[i - 1] && closes[i] > lower[i])
      markers.push({ time: times[i], position: 'belowBar', color: '#00d4aa', shape: 'arrowUp',   text: showText ? 'BB↑' : '' })
  }
  return markers
}

export function buildVolumeSpikeMarkers(times, volumes, showText = true) {
  if (!volumes || volumes.length < 20) return []
  const markers = []
  for (let i = 20; i < volumes.length; i++) {
    const avg = volumes.slice(i - 20, i).reduce((a, b) => a + b, 0) / 20
    if (volumes[i] > avg * 2.5)
      markers.push({ time: times[i], position: 'belowBar', color: '#ffa858', shape: 'circle', text: showText ? 'Vol' : '' })
  }
  return markers
}

export function buildEMACrossMarkers(times, closes, fast = 9, slow = 21, showText = true) {
  const emaF = computeEMA(closes, fast)
  const emaS = computeEMA(closes, slow)
  const markers = []
  for (let i = 1; i < closes.length; i++) {
    if (emaF[i - 1] <= emaS[i - 1] && emaF[i] > emaS[i])
      markers.push({ time: times[i], position: 'belowBar', color: '#00d4aa', shape: 'arrowUp',   text: showText ? 'EMA↑' : '' })
    if (emaF[i - 1] >= emaS[i - 1] && emaF[i] < emaS[i])
      markers.push({ time: times[i], position: 'aboveBar', color: '#ffb4ab', shape: 'arrowDown', text: showText ? 'EMA↓' : '' })
  }
  return markers
}

export function buildSuperTrendMarkers(candles, showText = true) {
  const { trend } = computeSuperTrend(candles)
  const times = candles.map(c => c.time)
  const markers = []
  for (let i = 1; i < trend.length; i++) {
    if (trend[i - 1] === -1 && trend[i] === 1)
      markers.push({ time: times[i], position: 'belowBar', color: '#00d4aa', shape: 'arrowUp',   text: showText ? 'ST↑' : '' })
    if (trend[i - 1] === 1 && trend[i] === -1)
      markers.push({ time: times[i], position: 'aboveBar', color: '#ffb4ab', shape: 'arrowDown', text: showText ? 'ST↓' : '' })
  }
  return markers
}
