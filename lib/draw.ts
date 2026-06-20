import type { LM } from "./analysis";
import { L_SH, R_SH, L_HIP, R_HIP } from "./analysis";

// 33-landmark skeleton connections (same map as the Python tool).
export const POSE_CONNECTIONS: [number, number][] = [
  [0, 2], [2, 7], [0, 5], [5, 8],
  [11, 13], [13, 15], [12, 14], [14, 16],
  [15, 17], [15, 19], [15, 21], [16, 18], [16, 20], [16, 22],
  [11, 12], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32],
];

export function drawPose(ctx: CanvasRenderingContext2D, lm: LM[], w: number, h: number): void {
  const unit = Math.max(2, Math.round(w / 220));
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(0,255,90,0.95)";
  ctx.lineWidth = unit;
  for (const [a, b] of POSE_CONNECTIONS) {
    ctx.beginPath();
    ctx.moveTo(lm[a].x * w, lm[a].y * h);
    ctx.lineTo(lm[b].x * w, lm[b].y * h);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(255,200,0,0.95)";
  for (const p of lm) {
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, unit * 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Hand-path tracer: mid-wrist trail up to the current frame, comet-style
// (older segments fade, the leading edge glows).
export function drawTrail(
  ctx: CanvasRenderingContext2D,
  pts: ([number, number] | null)[],
  upto: number,
  w: number,
  h: number
): void {
  const last = Math.min(upto, pts.length - 1);
  if (last < 1) return;
  const unit = Math.max(2, Math.round(w / 260));
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let j = 1; j <= last; j++) {
    const a = pts[j - 1];
    const b = pts[j];
    if (!a || !b) continue;
    const r = j / last;
    ctx.strokeStyle = `rgba(255,176,86,${(0.08 + 0.72 * Math.pow(r, 1.5)).toFixed(3)})`;
    ctx.lineWidth = unit * (0.6 + 1.4 * r);
    ctx.shadowColor = "rgba(255,176,86,0.8)";
    ctx.shadowBlur = last - j < 6 ? 9 : 0;
    ctx.beginPath();
    ctx.moveTo(a[0] * w, a[1] * h);
    ctx.lineTo(b[0] * w, b[1] * h);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  const tip = pts[last];
  if (tip) {
    ctx.fillStyle = "#ffd9a8";
    ctx.beginPath();
    ctx.arc(tip[0] * w, tip[1] * h, unit * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Clubhead arc: backswing (cyan) and downswing (magenta) so an over-the-top
// loop — the downswing coming down wider/outside the backswing — is visible.
export function drawClubArc(
  ctx: CanvasRenderingContext2D,
  path: ({ x: number; y: number } | null)[],
  address: number,
  top: number,
  impact: number,
  w: number,
  h: number
): void {
  const unit = Math.max(2, Math.round(w / 230));
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const seg = (lo: number, hi: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = unit * 1.4;
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
    let prev: { x: number; y: number } | null = null;
    for (let i = lo; i <= hi; i++) {
      const p = path[i];
      if (p) {
        if (prev) {
          ctx.beginPath();
          ctx.moveTo(prev.x * w, prev.y * h);
          ctx.lineTo(p.x * w, p.y * h);
          ctx.stroke();
        }
        prev = p;
      }
    }
  };
  seg(address, top, "rgba(0,229,255,0.95)");      // backswing — cyan
  seg(top, impact, "rgba(255,0,200,0.95)");        // downswing — magenta
  ctx.shadowBlur = 0;
}

type Ln = { x1: number; y1: number; x2: number; y2: number };
type P2 = { x: number; y: number };

// Swing-plane reference lines: the IDEAL plane (dashed green, anchored at the ball)
// and your ACTUAL shaft at the top extended through the butt (solid purple — where
// 杆尾 points). A white dot marks the ball the butt should point back at.
export function drawPlaneLines(
  ctx: CanvasRenderingContext2D,
  ideal: Ln,
  topShaft: Ln,
  ball: P2,
  w: number,
  h: number
): void {
  const unit = Math.max(2, Math.round(w / 300));
  const stroke = (l: Ln) => {
    ctx.beginPath();
    ctx.moveTo(l.x1 * w, l.y1 * h);
    ctx.lineTo(l.x2 * w, l.y2 * h);
    ctx.stroke();
  };
  ctx.save();
  ctx.lineCap = "round";

  // ideal plane — dashed, accent green
  ctx.strokeStyle = "rgba(120,230,150,0.85)";
  ctx.lineWidth = unit;
  ctx.setLineDash([Math.max(7, w / 55), Math.max(5, w / 80)]);
  stroke(ideal);
  ctx.setLineDash([]);

  // your shaft at the top — solid, glowing purple
  ctx.strokeStyle = "rgba(190,90,255,0.95)";
  ctx.lineWidth = unit * 1.5;
  ctx.shadowColor = "rgba(190,90,255,0.7)";
  ctx.shadowBlur = 7;
  stroke(topShaft);
  ctx.shadowBlur = 0;

  // the ball — what the butt should point back at
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(ball.x * w, ball.y * h, unit * 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Spine line (cyan) + shoulder/hip lines (magenta) — the geometry the metrics use.
export function drawGeometry(ctx: CanvasRenderingContext2D, lm: LM[], w: number, h: number): void {
  const unit = Math.max(2, Math.round(w / 200));
  const shMid: [number, number] = [(lm[L_SH].x + lm[R_SH].x) / 2 * w, (lm[L_SH].y + lm[R_SH].y) / 2 * h];
  const hipMid: [number, number] = [(lm[L_HIP].x + lm[R_HIP].x) / 2 * w, (lm[L_HIP].y + lm[R_HIP].y) / 2 * h];
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(0,229,255,0.95)";
  ctx.lineWidth = unit * 1.5;
  ctx.beginPath();
  ctx.moveTo(hipMid[0], hipMid[1]);
  ctx.lineTo(shMid[0], shMid[1]);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255,0,200,0.9)";
  ctx.lineWidth = unit;
  for (const [i, j] of [[L_SH, R_SH], [L_HIP, R_HIP]] as [number, number][]) {
    ctx.beginPath();
    ctx.moveTo(lm[i].x * w, lm[i].y * h);
    ctx.lineTo(lm[j].x * w, lm[j].y * h);
    ctx.stroke();
  }
}
