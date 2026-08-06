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

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.error(`  ❌ ${label}`);
  }
}

function assertDeepEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.error(`  ❌ ${label}`);
    console.error(`    expected: ${e}`);
    console.error(`    actual:   ${a}`);
  }
}

// ── Invalid input ──
console.log('Invalid input');
assert(evaluate(null, 100).valid === false, 'null alert → valid: false');
assert(evaluate({}, 100).valid === false, 'alert without condition → valid: false');
assert(evaluate(makeAlert(10), 'not-a-number').valid === false, 'non-number price → valid: false');
assert(evaluate(makeAlert(10), NaN).valid === false, 'NaN price → valid: false');
assert(evaluate(makeAlert(10), Infinity).valid === false, 'Infinity price → valid: false');
assert(evaluate(makeAlert(10), 0).valid === false, 'zero price → valid: false');
assert(evaluate(makeAlert(10), -5).valid === false, 'negative price → valid: false');
// changePercent validation is done in addAlert/updateAlertThreshold before calling evaluate
// evaluate itself does not validate changePercent range
assert(evaluate(makeAlert(10), null).valid === false, 'null baseline → valid: false (price must be number)');
assert(evaluate(makeAlert(10), undefined).valid === false, 'undefined baseline → valid: false (price must be number)');
assert(evaluate(makeAlert(10, 100), 100, 'unknown_kind').triggered === false, 'unknown kind → not triggered (falls through to below-threshold)');

// ── First run (needsBaseline) ──
console.log('First run (needsBaseline)');
const firstRun = evaluate(makeAlert(10), 100);
assert(firstRun.needsBaseline === true, 'first run → needsBaseline: true');
assert(firstRun.newBaseline === 100, 'newBaseline set to current price');

// ── Below threshold ──
console.log('Below threshold');
const below = evaluate(makeAlert(10, 100), 105);
assert(below.triggered === false, '5% change on 10% threshold → not triggered');
assert(below.triggered !== true, 'no triggered flag when below');

// ── Exactly at threshold ──
console.log('At threshold (edge)');
const atThreshold = evaluate(makeAlert(10, 100), 110);
assert(atThreshold.triggered === true, '10% change on 10% threshold → triggered');
assert(atThreshold.direction === 'up', 'direction is up');
assert(atThreshold.changePct === 10, 'changePct is exactly 10');
assert(atThreshold.newBaseline === 110, 'newBaseline set to 110');

// ── Above threshold (up) ──
console.log('Above threshold (up)');
const up = evaluate(makeAlert(10, 100), 115);
assert(up.triggered === true, '15% change → triggered');
assert(up.direction === 'up', 'direction is up');
assert(up.changePct === 15, 'changePct is 15');
assert(up.newBaseline === 115, 'newBaseline is 115');

// ── Above threshold (down) ──
console.log('Above threshold (down)');
const down = evaluate(makeAlert(10, 100), 85);
assert(down.triggered === true, '15% drop → triggered');
assert(down.direction === 'down', 'direction is down');
assert(down.changePct === 15, 'changePct is 15');
assert(down.newBaseline === 85, 'newBaseline is 85');

// ── Summary ──
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
