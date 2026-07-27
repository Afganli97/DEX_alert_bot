// ==============================
// Condition evaluator - evaluates if alert should trigger
// ==============================

/**
 * Evaluate if an alert condition is met
 * @param {Object} alert - Alert document with condition
 * @param {number} currentPrice - Current token price
 * @returns {Object|null} Evaluation result or null if baseline should be set
 */
function evaluate(alert, currentPrice) {
  const { kind } = alert.condition;

  if (kind === 'percent_change') {
    const { changePercent, baselinePrice } = alert.condition;

    // If no baseline price, set current as baseline and return null (no alert yet)
    if (baselinePrice == null) {
      return null;
    }

    // Calculate percentage change
    const changePct = ((currentPrice - baselinePrice) / baselinePrice) * 100;

    // Check if change exceeds threshold
    if (Math.abs(changePct) >= changePercent) {
      return {
        triggered: true,
        changePct,
        direction: changePct > 0 ? 'up' : 'down',
        newBaseline: currentPrice,
      };
    }

    return {
      triggered: false,
      changePct,
      direction: changePct > 0 ? 'up' : 'down',
    };
  }

  // Unknown condition kind - treat as no trigger
  return { triggered: false };
}

module.exports = {
  evaluate,
};