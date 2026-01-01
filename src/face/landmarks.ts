// tiny type + helper for distance between two landmarks
export type Landmark = { x: number; y: number; z?: number };

export function dist2D(a: Landmark, b: Landmark) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}
