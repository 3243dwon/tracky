import { describe, it, expect } from "vitest";
import { analyzePlane, PLANE_DEV_THRESH } from "./plane";
import type { ClubPoint } from "./club";
import { buildSwing } from "@/test/fixtures";

// Build a clubhead path with a known address anchor and downswing points placed a
// fixed perpendicular offset off the address shaft plane, so we can drive the
// deviation sign/magnitude deterministically (regardless of golf intuition).
function buildPath(frames: ReturnType<typeof buildSwing>["frames"], phases: { address: number; top: number; impact: number; finish: number }, offset: number): ClubPoint[] {
  const path: ClubPoint[] = new Array(frames.length).fill(null);
  const head = { x: 0.6, y: 0.85 }; // clubhead at address (out toward the ball, low)
  path[phases.address] = { x: head.x, y: head.y, conf: 1 };
  const a = frames[phases.address]!;
  const grip = { x: (a[15].x + a[16].x) / 2, y: (a[15].y + a[16].y) / 2 };
  let dx = grip.x - head.x,
    dy = grip.y - head.y;
  const L = Math.hypot(dx, dy) || 1;
  dx /= L;
  dy /= L;
  const nx = -dy,
    ny = dx; // unit perpendicular to the plane
  const base = { x: (grip.x + head.x) / 2, y: (grip.y + head.y) / 2 }; // a point ON the plane
  for (let i = phases.top; i <= phases.impact; i++) {
    path[i] = { x: base.x + offset * nx, y: base.y + offset * ny, conf: 1 };
  }
  return path;
}

const { frames, phases } = buildSwing({ view: "down-the-line" });

describe("analyzePlane", () => {
  it("returns null when no clubhead can be anchored at address", () => {
    const empty: ClubPoint[] = new Array(frames.length).fill(null);
    expect(analyzePlane(frames, empty, phases)).toBeNull();
  });

  it("reports a thin downswing trace as not-ok rather than guessing", () => {
    const path: ClubPoint[] = new Array(frames.length).fill(null);
    path[phases.address] = { x: 0.6, y: 0.85, conf: 1 }; // anchor only, no downswing points
    const r = analyzePlane(frames, path, phases)!;
    expect(r.ok).toBe(false);
    expect(r.verdict).toBe("na");
  });

  it("builds the plane stick through the grip and clubhead at address", () => {
    const r = analyzePlane(frames, buildPath(frames, phases, 0), phases)!;
    expect(r.ok).toBe(true);
    expect(r.head.x).toBeCloseTo(0.6, 5);
    expect(r.grip.x).toBeCloseTo(0.5, 5); // wrist midpoint of the fixture
    // grip and head both lie on the returned (extended) line
    const onLine = (px: number, py: number) =>
      Math.abs((r.line.x2 - r.line.x1) * (py - r.line.y1) - (r.line.y2 - r.line.y1) * (px - r.line.x1));
    expect(onLine(r.grip.x, r.grip.y)).toBeLessThan(1e-6);
    expect(onLine(r.head.x, r.head.y)).toBeLessThan(1e-6);
  });

  it("reads a downswing on the plane as on-plane", () => {
    const r = analyzePlane(frames, buildPath(frames, phases, 0), phases)!;
    expect(r.verdict).toBe("on");
    expect(Math.abs(r.devPct)).toBeLessThan(PLANE_DEV_THRESH);
  });

  it("reads opposite offsets as opposite sides (above vs below) with flipped sign", () => {
    const out = analyzePlane(frames, buildPath(frames, phases, 0.15), phases)!;
    const inn = analyzePlane(frames, buildPath(frames, phases, -0.15), phases)!;
    expect(out.ok && inn.ok).toBe(true);
    expect(out.verdict).not.toBe(inn.verdict);
    expect([out.verdict, inn.verdict].sort()).toEqual(["above", "below"]);
    expect(Math.sign(out.devPct)).toBe(-Math.sign(inn.devPct));
    expect(Math.abs(out.devPct)).toBeGreaterThan(PLANE_DEV_THRESH); // 0.15 of body height ≈ 20%
  });
});
