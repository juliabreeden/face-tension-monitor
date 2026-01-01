export function highlightPoints(
  ctx: CanvasRenderingContext2D,
  points: Array<{ x: number; y: number }>,
  canvasWidth: number,
  canvasHeight: number,
  options?: { color?: string; radius?: number }
) {
  const { color = "red", radius = 4 } = options ?? {};
  ctx.fillStyle = color;

  for (const pt of points) {
    ctx.beginPath();
    ctx.arc(pt.x * canvasWidth, pt.y * canvasHeight, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

