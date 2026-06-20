// Swing-plane guide, the "where does 杆尾 (the butt of the club) point?" check —
// the TrackMan-style reference lines.
//
// We draw two lines on the down-the-line view:
//   • the IDEAL plane line — anchored at the ball (clubhead at address) and running
//     up along the address shaft angle: where the shaft should lie / point.
//   • your ACTUAL shaft at the top — the line through the clubhead and the hands,
//     extended down THROUGH THE BUTT. On plane, that extension points back at the
//     ball; outside it = steep / across the line (over-the-top tendency); inside =
//     laid off.
//
// Honest 2D limits hold (one camera reads the shaft line, not the clubface), so the
// magnitude is experimental and the caller shows it only for DTL clips. Pure +
// deterministic ⇒ unit-tested.
import { L_WRIST, R_WRIST, NOSE, L_ANK, R_ANK } from "./analysis";
import type { Frame, Phases } from "./analysis";
import type { ClubPoint } from "./club";

export type Pt = { x: number; y: number };
export type Line = { x1: number; y1: number; x2: number; y2: number };
export type PlaneVerdict = "on" | "out" | "in" | "na";

export type PlaneAnalysis = {
  ok: boolean;
  reason?: string;
  ball: Pt; // clubhead at address ≈ where the butt should point
  idealLine: Line; // address shaft plane, extended — the reference
  topShaft: Line; // actual shaft at the top, extended through the butt (杆尾)
  gapPct: number; // signed distance of the clubhead-at-top from the ideal plane, % body height; + = outside (steep), − = inside (laid off)
  verdict: PlaneVerdict;
};

export const PLANE_ON_THRESH = 6; // % of body height the butt line can miss the ball and still read "on plane"
const EXT = 1.4; // how far to extend each line past its two anchors (plane-direction units)

function bodyHeight(lm: NonNullable<Frame>): number {
  const ax = (lm[L_ANK].x + lm[R_ANK].x) / 2,
    ay = (lm[L_ANK].y + lm[R_ANK].y) / 2;
  return Math.hypot(lm[NOSE].x - ax, lm[NOSE].y - ay) || 0.1;
}

function gripOf(lm: NonNullable<Frame>): Pt {
  return { x: (lm[L_WRIST].x + lm[R_WRIST].x) / 2, y: (lm[L_WRIST].y + lm[R_WRIST].y) / 2 };
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

// Line through a→b, extended past both anchors so it reads as a full reference line.
function extend(a: Pt, b: Pt): Line {
  let dx = b.x - a.x,
    dy = b.y - a.y;
  const L = Math.hypot(dx, dy) || 1e-6;
  dx /= L;
  dy /= L;
  return { x1: a.x - dx * EXT, y1: a.y - dy * EXT, x2: b.x + dx * EXT, y2: b.y + dy * EXT };
}

export function analyzePlane(frames: Frame[], path: ClubPoint[], phases: Phases): PlaneAnalysis | null {
  const addr = nearestFrame(frames, phases.address);
  const topF = nearestFrame(frames, phases.top);
  if (!addr || !topF) return null;

  // Both ends of the shaft need a clubhead anchor (pose gives us the hands/grip).
  const ballPt = nearestTracked(path, phases.address, 8);
  const headTop = nearestTracked(path, phases.top, 12);
  if (!ballPt || !headTop) return null;

  const ball: Pt = { x: ballPt.x, y: ballPt.y };
  const Ct: Pt = { x: headTop.x, y: headTop.y };
  const gripA = gripOf(addr);
  const gripT = gripOf(topF);
  const scale = bodyHeight(addr);

  const idealLine = extend(ball, gripA); // ball → hands@address — the plane the shaft should lie on
  const topShaft = extend(Ct, gripT); // clubhead@top → hands@top, extended through the butt

  // How far is the clubhead at the top OFF the ideal plane line? Signed
  // perpendicular distance, normalized by body height. The ideal plane (ball →
  // hands@address) is a real line, so this is well-defined regardless of where the
  // body sits — and it's exactly the "is the club on plane at the top" read: when
  // the clubhead (and grip) sit on the line, the shaft IS the plane and the butt
  // points back at the ball. + = outside the plane (toward the ball/camera side,
  // the steep / over-the-top side), − = inside (laid off / shallow).
  let px = gripA.x - ball.x,
    py = gripA.y - ball.y;
  const pl = Math.hypot(px, py) || 1e-6;
  px /= pl;
  py /= pl;
  const sideOf = (q: Pt) => px * (q.y - ball.y) - py * (q.x - ball.x);
  const gapPct = (sideOf(Ct) / scale) * 100;

  const verdict: PlaneVerdict =
    Math.abs(gapPct) < PLANE_ON_THRESH ? "on" : gapPct > 0 ? "out" : "in";

  return { ok: true, ball, idealLine, topShaft, gapPct, verdict };
}
