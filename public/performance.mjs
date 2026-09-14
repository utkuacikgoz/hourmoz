export function frameTiming(milliseconds) {
  const seconds = Math.max(0, milliseconds / 1000);
  return {dt: Math.min(seconds || 1 / 60, .25), stalled: seconds > .25};
}
export function steerVector(x, z, radius = 35) {
  const length = Math.hypot(x, z), amount = Math.min(1, length / radius);
  if (amount < .12) return {x: 0, z: 0};
  const strength = (amount - .12) / .88;
  return {x: x / length * strength, z: z / length * strength};
}
export class GraphicsBudget {
  constructor() { this.level = 0; this.samples = 0; this.elapsed = 0; }
  update(dt) {
    this.elapsed += dt; this.samples++;
    if (this.elapsed < 3) return false;
    const slow = this.elapsed / this.samples > .024;
    this.elapsed = 0; this.samples = 0;
    if (slow && this.level < 3) { this.level++; return true; }
    return false;
  }
  get pixelRatio() { return [1.6, 1.25, 1, .8][this.level]; }
}
