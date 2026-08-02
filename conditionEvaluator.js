// ==============================
// Condition evaluator - evaluates if alert should trigger
// ==============================

/**
 * Evaluate if an alert condition is met.
 * Returns:
 *   { needsBaseline: true, newBaseline: <number> } — baseline not set yet
 *   { triggered: false } — change below threshold, baseline stays unchanged
 *   { triggered: true, direction, changePct, newBaseline } — alert fired
 *   { valid: false } — invalid input
 */
function evaluate(alert, currentPrice) {
  if (!alert || !alert.condition || typeof currentPrice !== 'number' || !isFinite(currentPrice) || currentPrice <= 0) {
    return { valid: false };
  }

  const { kind, changePercent, baselinePrice } = alert.condition;

  if (kind !== 'percent_change') {
    return { valid: false };
  }

  // First run: no baseline yet — set it, no alert
  if (baselinePrice === null || baselinePrice === undefined) {
    return { needsBaseline: true, newBaseline: currentPrice };
  }

  const change = ((currentPrice - baselinePrice) / baselinePrice) * 100;

  // Below threshold — baseline stays, change continues to accumulate
  if (Math.abs(change) < changePercent) {
    return { triggered: false };
  }

  // Alert fired — reset baseline to current price
  return {
    triggered: true,
    direction: change > 0 ? 'up' : 'down',
    changePct: Math.abs(change),
    newBaseline: currentPrice,
  };
}

module.exports = { evaluate };