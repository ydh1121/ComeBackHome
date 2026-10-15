import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertPaddleV2Quality} from './paddle-v2-quality-gate.mjs';
// Recorded, source-linked real outputs; this command makes no model/API call.
const evidence=JSON.parse(readFileSync('runtime-evidence/paddle-v2-final-20261015.json','utf8'));
for(const report of evidence.reports) {
  assertPaddleV2Quality(report);
  for(const mutate of [r=>r.aggregate.metrics.clock_in_shift.accuracy=.97,
    r=>r.aggregate.metrics.break_minutes_shift.accuracy=.97,
    r=>r.aggregate.metrics.status.accuracy=.97,
    r=>r.aggregate.safety.dangerous_auto_confirmations=1,
    r=>r.aggregate.safety.dangerous_off_on_blank_or_unreadable=1,
    r=>r.aggregate.missing_cells=1,
    r=>r.aggregate.metrics.review_required.accuracy=.99,
    r=>r.images[0].error='PRODUCT_RUNTIME_ERROR']) {
    const bad=structuredClone(report);mutate(bad);assert.throws(()=>assertPaddleV2Quality(bad));
  }
}
console.log('CBH_PADDLE_V2_RECORDED_GATE_NEGATIVE_CONTROLS_PASS no_new_inference=1 private_acceptance=0');
