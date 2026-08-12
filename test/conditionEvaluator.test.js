// ==============================
// Tests for conditionEvaluator.evaluate()
// ==============================

const { evaluate } = require('../conditionEvaluator');

// Helper to create a minimal alert
function makeAlert(changePercent, baselinePrice = null) {
  return {
    condition: { kind: 'percent_change', changePercent, baselinePrice },
  };
}

describe('conditionEvaluator.evaluate()', () => {
  // ── Invalid input ──
  test('null alert → valid: false', () => {
    expect(evaluate(null, 100).valid).toBe(false);
  });

  test('alert without condition → valid: false', () => {
    expect(evaluate({}, 100).valid).toBe(false);
  });

  test('non-number price → valid: false', () => {
    expect(evaluate(makeAlert(10), 'not-a-number').valid).toBe(false);
  });

  test('NaN price → valid: false', () => {
    expect(evaluate(makeAlert(10), NaN).valid).toBe(false);
  });

  test('Infinity price → valid: false', () => {
    expect(evaluate(makeAlert(10), Infinity).valid).toBe(false);
  });

  test('zero price → valid: false', () => {
    expect(evaluate(makeAlert(10), 0).valid).toBe(false);
  });

  test('negative price → valid: false', () => {
    expect(evaluate(makeAlert(10), -5).valid).toBe(false);
  });

  test('null baseline → valid: false (price must be number)', () => {
    expect(evaluate(makeAlert(10), null).valid).toBe(false);
  });

  test('undefined baseline → valid: false (price must be number)', () => {
    expect(evaluate(makeAlert(10), undefined).valid).toBe(false);
  });

  test('unknown kind → valid: false', () => {
    expect(evaluate({ condition: { kind: 'unknown_kind', changePercent: 10, baselinePrice: 100 } }, 100).valid).toBe(false);
  });

  // ── First run (needsBaseline) ──
  test('first run → needsBaseline: true', () => {
    const result = evaluate(makeAlert(10), 100);
    expect(result.needsBaseline).toBe(true);
    expect(result.newBaseline).toBe(100);
  });

  // ── Below threshold ──
  test('5% change on 10% threshold → not triggered', () => {
    const result = evaluate(makeAlert(10, 100), 105);
    expect(result.triggered).toBe(false);
  });

  test('no triggered flag when below', () => {
    const result = evaluate(makeAlert(10, 100), 105);
    expect(result.triggered).not.toBe(true);
  });

  // ── Exactly at threshold ──
  test('10% change on 10% threshold → triggered', () => {
    const result = evaluate(makeAlert(10, 100), 110);
    expect(result.triggered).toBe(true);
    expect(result.direction).toBe('up');
    expect(result.changePct).toBe(10);
    expect(result.newBaseline).toBe(110);
  });

  // ── Above threshold (up) ──
  test('15% change → triggered', () => {
    const result = evaluate(makeAlert(10, 100), 115);
    expect(result.triggered).toBe(true);
    expect(result.direction).toBe('up');
    expect(result.changePct).toBe(15);
    expect(result.newBaseline).toBe(115);
  });

  // ── Above threshold (down) ──
  test('15% drop → triggered', () => {
    const result = evaluate(makeAlert(10, 100), 85);
    expect(result.triggered).toBe(true);
    expect(result.direction).toBe('down');
    expect(result.changePct).toBe(15);
    expect(result.newBaseline).toBe(85);
  });
});
