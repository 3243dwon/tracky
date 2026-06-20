import { describe, it, expect } from "vitest";
import { analyzePlane, PLANE_ON_THRESH } from "./plane";
import type { ClubPoint } from "./club";
import { buildSwing } from "@/test/fixtures";

const { frames, phases } = buildSwing({ view: "down-the-line" });
const BALL = { x: 0.5, y: 0.85 }; // clubhead at address ≈ the ball, low and centered

// A path with the clubhead anchored at address (ball) and at the top. The top
// clubhead x decides whether the shaft, extended through the butt, points at the
// ball (on) or misses it to one side.
function buildPath(topHeadX: number): ClubPoint[] {
  const path: ClubPoint[] = new Array(frames.length).fill(null);
  path[phases.address] = { x: BALL.x, y: BALL.y, conf: 1 };
  path[phases.top] = { x: topHeadX, y: 0.15, conf: 1 }; // clubhead high at the top
  return path;
}

describe("analyzePlane (shaft / 杆尾 lines)", () => {
  it("returns null without clubhead anchors at address and top", () => {
    const empty: ClubPoint[] = new Array(frames.length).fill(null);
    expect(analyzePlane(frames, empty, phases)).toBeNull();
    const addrOnly: ClubPoint[] = new Array(frames.length).fill(null);
    addrOnly[phases.address] = { x: 0.5, y: 0.85, conf: 1 };
    expect(analyzePlane(frames, addrOnly, phases)).toBeNull(); // no top anchor
  });

  it("builds the ideal plane line through the ball and the address grip", () => {
    const r = analyzePlane(frames, buildPath(0.5), phases)!;
    expect(r.ok).toBe(true);
    expect(r.ball.x).toBeCloseTo(0.5, 5);
    // ball + address grip both lie on the ideal line
    const onLine = (l: typeof r.idealLine, px: number, py: number) =>
      Math.abs((l.x2 - l.x1) * (py - l.y1) - (l.y2 - l.y1) * (px - l.x1));
    const gripA = { x: 0.5, y: frames[phases.address]![15].y }; // wrist-mid x is 0.5 in the fixture
    expect(onLine(r.idealLine, r.ball.x, r.ball.y)).toBeLessThan(1e-6);
    expect(onLine(r.idealLine, gripA.x, (frames[phases.address]![15].y + frames[phases.address]![16].y) / 2)).toBeLessThan(1e-6);
  });

  it("reads on-plane when the butt line points straight back at the ball", () => {
    // clubhead@top, grip@top and the ball are all on x≈0.5 → the shaft extended
    // passes through the ball.
    const r = analyzePlane(frames, buildPath(0.5), phases)!;
    expect(r.verdict).toBe("on");
    expect(Math.abs(r.gapPct)).toBeLessThan(PLANE_ON_THRESH);
  });

  it("flags outside vs inside the plane on opposite misses, with a flipped sign", () => {
    const oneSide = analyzePlane(frames, buildPath(0.66), phases)!; // clubhead one side of the plane
    const otherSide = analyzePlane(frames, buildPath(0.34), phases)!; // ...and the other
    expect(oneSide.ok && otherSide.ok).toBe(true);
    expect(oneSide.verdict).not.toBe(otherSide.verdict);
    expect([oneSide.verdict, otherSide.verdict].sort()).toEqual(["in", "out"]);
    expect(Math.sign(oneSide.gapPct)).toBe(-Math.sign(otherSide.gapPct));
    expect(Math.abs(oneSide.gapPct)).toBeGreaterThan(PLANE_ON_THRESH);
  });
});
