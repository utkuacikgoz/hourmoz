// An isolated hitch (a garbage-collection pause, a shader compile, a notification) skips the
// simulation for that frame instead of advancing it in one jump or interrupting the player. When
// slow frames follow each other the device is simply slow, so time advances by a capped step and
// play stays possible. A freeze is reported as stalled; the game only pauses when the tab is
// hidden or loses focus.
export function frameTiming(milliseconds, previousHitch = false) {
  const seconds = Math.max(0, milliseconds / 1000);
  const hitch = seconds > 0.25;
  const dt = hitch ? (previousHitch ? 0.25 : 0) : seconds || 1 / 60;
  return {dt, hitch, stalled: seconds > 1};
}
export function steerVector(x, z, radius = 35) {
  const length = Math.hypot(x, z),
    amount = Math.min(1, length / radius);
  if (amount < 0.12) return {x: 0, z: 0};
  const strength = (amount - 0.12) / 0.88;
  return {x: (x / length) * strength, z: (z / length) * strength};
}
// Starts at a device-class guess and only ratchets down when frames stay slow.
export class GraphicsBudget {
  constructor(level = 0) {
    this.level = level;
    this.samples = 0;
    this.elapsed = 0;
  }
  update(dt) {
    this.elapsed += dt;
    this.samples++;
    if (this.elapsed < 3) return false;
    const slow = this.elapsed / this.samples > 0.024;
    this.elapsed = 0;
    this.samples = 0;
    if (slow && this.level < 3) {
      this.level++;
      return true;
    }
    return false;
  }
  get pixelRatio() {
    return [1.6, 1.25, 1, 0.8][this.level];
  }
}
