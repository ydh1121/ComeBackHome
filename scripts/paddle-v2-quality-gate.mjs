import assert from 'node:assert/strict';

// Existing .98 recognition target, applied only to immutable synthetic v2.
// Passing it is not private-image, native-device or production acceptance.
export function assertPaddleV2Quality(report) {
  assert.equal(report.source,'IMMUTABLE_SYNTHETIC_V2');
  assert.equal(report.images.length,12);
  assert.ok(report.images.every(image=>image.error===null),'Every image must reach actual recognition');
  assert.deepEqual([report.external_inference,report.private_images,report.d1_writes],[0,0,0]);
  const score=report.aggregate;
  assert.equal(score.real_provider_accuracy_measured,true);
  assert.deepEqual([score.truth_cells,score.predicted_cells,score.aligned_cells],[336,336,336]);
  assert.deepEqual([score.missing_cells,score.unmatched_predictions,score.duplicate_position_predictions],[0,0,0]);
  for(const field of ['employee_row','column_group','row_and_column','date','weekday','employee_name','status','clock_in_shift','clock_out_shift','break_minutes_shift'])
    assert.ok(score.metrics[field].accuracy>=.98,field+' below unchanged 98% target');
  assert.equal(score.metrics.review_required.accuracy,1,'Every prediction remains review-required');
  for(const field of ['dangerous_auto_confirmations','dangerous_shift_on_nonshift','dangerous_off_on_blank_or_unreadable','incomplete_shift_predictions','invalid_status'])
    assert.equal(score.safety[field],0,field);
  return {scope:'IMMUTABLE_SYNTHETIC_V2_ONLY',pass:true,threshold:.98,privateAcceptance:false,nativeAcceptance:false};
}
