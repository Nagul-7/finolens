const db = require("../config/database");

/**
 * Persist a generated call to the database and return the saved row.
 * Intentionally fire-and-forget safe — caller does not need to await.
 */
async function saveCall(signal) {
  const { symbol, call, confidence, current_price, entry, stop_loss, target, risk_reward } = signal;

  const callResult = await db.query(
    `INSERT INTO calls
       (symbol, call_type, confidence, current_price, entry_price,
        stop_loss, target_price, risk_reward)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id`,
    [symbol, call, confidence, current_price, entry, stop_loss, target, risk_reward]
  );

  const callId = callResult.rows[0].id;

  if (signal.signals?.length) {
    const signalRows = signal.signals.map((s) => [
      callId,
      s.indicator,
      s.signal,
      s.raw_value,
      s.weight ?? 1.0,
      s.reason,
    ]);

    const placeholders = signalRows
      .map(
        (_, i) =>
          `($${i * 6 + 1},$${i * 6 + 2},$${i * 6 + 3},$${i * 6 + 4},$${i * 6 + 5},$${i * 6 + 6})`
      )
      .join(",");

    await db.query(
      `INSERT INTO signals (call_id, indicator, signal_type, raw_value, weight, reason)
       VALUES ${placeholders}`,
      signalRows.flat()
    );
  }

  return callId;
}

/**
 * Retrieve the N most recent active calls, optionally filtered by symbol.
 */
async function getRecentCalls(symbol = null, limit = 20) {
  const params = symbol ? [symbol.toUpperCase(), limit] : [limit];
  const whereClause = symbol ? "WHERE c.symbol = $1" : "";
  const limitParam = symbol ? "$2" : "$1";

  const { rows } = await db.query(
    `SELECT c.*, s.name, s.sector
     FROM calls c
     JOIN stocks s ON s.symbol = c.symbol
     ${whereClause}
     ORDER BY c.created_at DESC
     LIMIT ${limitParam}`,
    params
  );
  return rows;
}

module.exports = { saveCall, getRecentCalls };
