import assert from 'node:assert/strict';
import {frameTiming, steerVector, GraphicsBudget} from '../public/performance.mjs';
assert.equal(frameTiming(100).dt, 0.1);
assert.equal(frameTiming(100).hitch, false);
assert.equal(frameTiming(100).stalled, false);
// A hitch skips the frame without pausing; only a freeze over a second pauses.
assert.equal(frameTiming(400).dt, 0);
assert.equal(frameTiming(400).hitch, true);
assert.equal(frameTiming(400).stalled, false);
assert.equal(frameTiming(1500).stalled, true);
assert.equal(frameTiming(0).dt, 1 / 60);
assert.deepEqual(steerVector(1, 1), {x: 0, z: 0});
assert.deepEqual(steerVector(70, 0), {x: 1, z: 0});
assert(Math.abs(Math.hypot(...Object.values(steerVector(80, 80))) - 1) < 0.0001);
const slow = new GraphicsBudget();
for (let i = 0; i < 300; i++) slow.update(0.04);
assert.equal(slow.level, 3);
const fast = new GraphicsBudget();
for (let i = 0; i < 300; i++) fast.update(1 / 60);
assert.equal(fast.level, 0);
const phone = new GraphicsBudget(1);
assert.equal(phone.level, 1);
assert.equal(phone.pixelRatio, 1.25);
console.log(
  'PASS: elapsed-time preservation, hitch skipping, freeze detection, touch dead zone, adaptive graphics bounds.',
);
