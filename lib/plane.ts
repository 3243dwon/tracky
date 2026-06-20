// Swing-plane guide: the "sticks pointing where the swing should be".
//
// We take the ADDRESS SHAFT PLANE — the line through the hands (grip) and the
// clubhead at setup — and extend it as the reference stick the downswing should
// return on. Then we measure how far the traced clubhead path runs OFF that line
// through the downswing: + = the over-the-top side (outside/above the plane,
// the slice/pull path), − = dropped under/inside.
//
// Honest 2D limits, same as the rest of the app: one camera can't see the
// clubface, and this is a down-the-line concept — the caller only shows it for
// DTL clips, and the magnitude is experimental (we cross-reference the club
// loop read in the UI). Pure + deterministic so it's unit-tested.
import { L_WRIST, R_WRIST, L_HIP, R_HIP, NOSE, L_ANK, R_ANK } from "./analysis";
import type { Frame, Phases } from "./analysis";
import type { ClubPoint } from "./club";

export type PlanePoint = { x: number; y: number };
export type PlaneVerdict = "on" | "above" | "below" | "na";
export type PlaneLine = { x1: number; y1: number; x2: number; y2: number };

export type PlaneAnalysis = {
  ok: boolean;
  reason?: string;
  grip: PlanePoint; // hands at address
  head: PlanePoint; // clubhead at address — the ball end of the stick
  line: PlaneLine; // the extended reference stick, normalized [0..1]
  devPct: number; // mean signed downswing deviation vs plane (% body height); + = above/over-the-top
  maxDevPct: number; // worst single deviation (signed)
  verdict: PlaneVerdict;
};

export const PLANE_DEV_THRESH = 4; // % of body height to call above / below vs on-plane
const EXT = 1.3; // how far to extend the stick past grip / clubhead, in plane-direction units

function bodyHeight(lm: NonNullable<Frame>): number {
  const ax = (lm[L_ANK].x + lm[R_ANK].x) / 2,
    ay = (lm[L_ANK].y + lm[R_ANK].y) / 2;
  return Math.hypot(lm[NOSE].x - ax, lm[NOSE].y - ay) || 0.1;
}

function nearestFrame(frames: Frame[], i: number): NonNullable<Frame> | null {
  if (frames[i]) return frames[i]!;
  for (let d = 1; d < frames.length; d++) {
    if (frames[i - d]) return frames[i - d]!;
    if (frames[i + d]) return frames[i + d]!;
  }
  return null;
}

function nearestTracked(path: ClubPoint[], i: number, radius: number): ClubPoint {
  for (let d = 0; d <= radius; d++) {
    const a = path[i + d];
    if (a && a.conf > 0.05) return a;
    const b = path[i - d];
    if (b && b.conf > 0.05) return b;
  }
  return null;
}

export function analyzePlane(frames: Frame[], path: ClubPoint[], phases: Phases): PlaneAnalysis | null {
  const addr = nearestFrame(frames, phases.address);
  if (!addr) return null;
  const grip: PlanePoint = {
    x: (addr[L_WRIST].x + addr[R_WRIST].x) / 2,
    y: (addr[L_WRIST].y + addr[R_WRIST].y) / 2,
  };
  // The plane needs a clubhead anchor at (or near) address; without a club trace
  // there's nothing to draw the stick from.
  const headPt = nearestTracked(path, phases.address, 8) ?? nearestTracked(path, phases.top, 12);
  if (!headPt) return null;
  const head: PlanePoint = { x: headPt.x, y: headPt.y };

  const scale = bodyHeight(addr);
  let dx = grip.x - head.x,
    dy = grip.y - head.y;
  const len = Math.hypot(dx, dy) || 1e-6;
  dx /= len;
  dy /= len;
  const line: PlaneLine = {
    x1: head.x - dx * EXT,
    y1: head.y - dy * EXT,
    x2: grip.x + dx * EXT,
    y2: grip.y + dy * EXT,
  };

  // Signed perpendicular distance of a point from the plane line (unit dir ⇒ |·| = distance).
  const cross = (px: number, py: number) => dx * (py - head.y) - dy * (px - head.x);
  // Calibrate the sign so the body (hips) is the "under/inside" side, hence
  // the opposite side reads positive = over-the-top / above the plane.
  const hipX = (addr[L_HIP].x + addr[R_HIP].x) / 2,
    hipY = (addr[L_HIP].y + addr[R_HIP].y) / 2;
  const bodySign = Math.sign(cross(hipX, hipY)) || 1;

  const devs: number[] = [];
  for (let i = phases.top; i <= phases.impact; i++) {
    const p = path[i];
    if (p && p.conf > 0.05) devs.push((-bodySign * cross(p.x, p.y)) / scale * 100);
  }
  if (devs.length < 2)
    return { ok: false, reason: "club trace too thin on the downswing", grip, head, line, devPct: NaN, maxDevPct: NaN, verdict: "na" };

  const devPct = devs.reduce((s, v) => s + v, 0) / devs.length;
  const maxDevPct = devs.reduce((m, v) => (Math.abs(v) > Math.abs(m) ? v : m), 0);
  const verdict: PlaneVerdict = devPct > PLANE_DEV_THRESH ? "above" : devPct < -PLANE_DEV_THRESH ? "below" : "on";
  return { ok: true, grip, head, line, devPct, maxDevPct, verdict };
}
