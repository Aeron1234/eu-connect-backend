import test from 'node:test';
import assert from 'node:assert/strict';
import { shiftExpectations, datedShiftExpectations, clockOutTiming } from '../features/dtr/shiftTiming.js';

test('day shift marks the ten-minute threshold and clock-out labels', () => {
  const before = shiftExpectations('2026-11-05 08:09:59', '08:00', '17:00');
  const after = shiftExpectations('2026-11-05 08:10:00', '08:00', '17:00');
  assert.equal(before.late, false);
  assert.equal(after.late, true);
  assert.equal(after.expectedOut, '2026-11-05 17:00:00');
  assert.deepEqual(clockOutTiming('2026-11-05 16:00:00', after.expectedOut, 7), { undertime: true, overtime: false });
  assert.deepEqual(clockOutTiming('2026-11-05 16:00:01', after.expectedOut, 7), { undertime: false, overtime: false });
  assert.deepEqual(clockOutTiming('2026-11-05 17:29:59', after.expectedOut), { undertime: false, overtime: false });
  assert.deepEqual(clockOutTiming('2026-11-05 17:30:00', after.expectedOut), { undertime: false, overtime: true });
});

test('overnight shift anchors a post-midnight clock-in to the previous day', () => {
  const shift = shiftExpectations('2026-11-06 00:15:00', '22:00', '06:00');
  assert.equal(shift.expectedIn, '2026-11-05 22:00:00');
  assert.equal(shift.expectedOut, '2026-11-06 06:00:00');
  assert.equal(shift.late, true);
  assert.equal(clockOutTiming('2026-11-06 05:00:00', shift.expectedOut, 7).undertime, true);
  assert.equal(shiftExpectations('2026-11-06 07:00:00', '22:00', '06:00').expectedIn, '2026-11-05 22:00:00');
});

test('no schedule marks duty under seven hours as undertime', () => {
  assert.equal(shiftExpectations('2026-11-05 08:00:00', null, null), null);
  assert.deepEqual(clockOutTiming('2026-11-05 17:00:00', null, 6.99), { undertime: true, overtime: false });
  assert.deepEqual(clockOutTiming('2026-11-05 17:00:00', null, 7), { undertime: false, overtime: false });
});

test('optional range includes its start and end dates, using the overnight shift start', () => {
  assert.equal(datedShiftExpectations('2026-11-04 08:00:00', '08:00', '17:00', '2026-11-05', '2026-11-06'), null);
  assert.equal(datedShiftExpectations('2026-11-05 08:00:00', '08:00', '17:00', '2026-11-05', '2026-11-06').expectedIn, '2026-11-05 08:00:00');
  assert.equal(datedShiftExpectations('2026-11-07 00:15:00', '22:00', '06:00', '2026-11-05', '2026-11-06').expectedIn, '2026-11-06 22:00:00');
  assert.equal(datedShiftExpectations('2026-11-08 00:15:00', '22:00', '06:00', '2026-11-05', '2026-11-06'), null);
  assert.ok(datedShiftExpectations('2026-11-07 08:00:00', '08:00', '17:00', null, null));
});
