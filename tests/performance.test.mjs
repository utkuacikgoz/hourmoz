import assert from 'node:assert/strict';
import {frameTiming,steerVector,GraphicsBudget} from '../public/performance.mjs';
assert.equal(frameTiming(100).dt,.1);assert.equal(frameTiming(100).stalled,false);assert.equal(frameTiming(400).stalled,true);assert.deepEqual(steerVector(1,1),{x:0,z:0});assert.deepEqual(steerVector(70,0),{x:1,z:0});assert(Math.abs(Math.hypot(...Object.values(steerVector(80,80)))-1)<.0001);
const slow=new GraphicsBudget();for(let i=0;i<300;i++)slow.update(.04);assert.equal(slow.level,3);const fast=new GraphicsBudget();for(let i=0;i<300;i++)fast.update(1/60);assert.equal(fast.level,0);
console.log('PASS: elapsed-time preservation, stall detection, touch dead zone, adaptive graphics bounds.');
