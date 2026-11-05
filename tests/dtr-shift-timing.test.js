import test from 'node:test';
import assert from 'node:assert/strict';
import { shiftExpectations, clockOutTiming } from '../features/dtr/shiftTiming.js';

test('day shift marks the ten-minute threshold and clock-out labels', () => {
  const before = shiftExpectations('2026-11-05 08:09:59', '08:00', '17:00');
  const after = shiftExpectations('2026-11-05 08:10:00', '08:00', '17:00');
  assert.equal(before.late, false);
  assert.equal(after.late, true);
  assert.equal(after.expectedOut, '2026-11-05 17:00:00');
  assert.deepEqual(clockOutTiming('2026-11-05 16:59:59', after.expectedOut), { undertime: true, overtime: false });
  assert.deepEqual(clockOutTiming('2026-11-05 17:29:59', after.expectedOut), { undertime: false, overtime: false });
  assert.deepEqual(clockOutTiming('2026-11-05 17:30:00', after.expectedOut), { undertime: false, overtime: true });
});

test('overnight shift anchors a post-midnight clock-in to the previous day', () => {
  const shift = shiftExpectations('2026-11-06 00:15:00', '22:00', '06:00');
  assert.equal(shift.expectedIn, '2026-11-05 22:00:00');
  assert.equal(shift.expectedOut, '2026-11-06 06:00:00');
  assert.equal(shift.late, true);
  assert.equal(clockOutTiming('2026-11-06 05:30:00', shift.expectedOut).undertime, true);
  assert.equal(shiftExpectations('2026-11-06 07:00:00', '22:00', '06:00').expectedIn, '2026-11-05 22:00:00');
});

test('no schedule creates no timing labels', () => {
  assert.equal(shiftExpectations('2026-11-05 08:00:00', null, null), null);
  assert.deepEqual(clockOutTiming('2026-11-05 17:00:00', null), { undertime: false, overtime: false });
});
