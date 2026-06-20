import { describe, it, expect } from "vitest";
import { analyzeClubPath, clubFault, analyzeClub, type ClubAnalysis, type ClubPoint } from "./club";
import { buildSwing } from "@/test/fixtures";

// Build a clubhead path over the address→impact window. Backswing rises up the
// trail side close to the body; the downswing either comes down WIDER (over the
// top) or tucks INSIDE (on plane).
function makePath(mode: "ott" | "inside") {
  const { frames, phases } = buildSwing();
  const { address, top, impact } = phases;
  const path: ClubPoint[] = new Array(frames.length).fill(null);
  for (let i = address; i <= top; i++) {
    const u = (i - address) / (top - address); // 0 = low, 1 = top
    path[i] = { x: 0.54, y: 0.75 - 0.5 * u, conf: 1 };
  }
  for (let i = top; i <= impact; i++) {
    const u = (i - top) / (impact - top); // 0 = top, 1 = low (impact)
    const x = mode === "ott" ? 0.54 + 0.24 * u : 0.54 - 0.06 * u;
    path[i] = { x, y: 0.25 + 0.5 * u, conf: 1 };
  }
  return { path, frames, phases };
}

function clubAnalysis(over: Partial<ClubAnalysis> = {}): ClubAnalysis {
  return {
    path: [],
    coveragePct: 80,
    quality: 0.7,
    meanTurnDeg: 20,
    loopPct: 0,
    peakSpeedPct: 5,
    nBack: 5,
    nDown: 5,
    fault: null,
    ...over,
  };
}

describe("analyzeClubPath", () => {
  it("flags an over-the-top downswing as a wider, outside path", () => {
    const { path, frames, phases } = makePath("ott");
    const a = analyzeClubPath(path, frames, phases);
    expect(a.loopPct).toBeGreaterThan(8); // the synthetic OTT path clears the gate with margin
    expect(a.coveragePct).toBeGreaterThan(45);
    expect(a.quality).toBeGreaterThan(0.4);
    expect(a.fault).not.toBeNull();
    expect(a.fault!.title).toMatch(/over.the.top/i);
  });

  it("stays quiet on an on-plane downswing that tucks inside", () => {
    const { path, frames, phases } = makePath("inside");
    const a = analyzeClubPath(path, frames, phases);
    expect(a.loopPct).toBeLessThan(3); // clearly the negative/inside side of the boundary
    expect(a.fault).toBeNull();
  });

  it("reports coverage and a bounded quality score", () => {
    const { path, frames, phases } = makePath("ott");
    const a = analyzeClubPath(path, frames, phases);
    expect(a.quality).toBeGreaterThanOrEqual(0);
    expect(a.quality).toBeLessThanOrEqual(1);
    expect(a.coveragePct).toBeLessThanOrEqual(100);
  });
});

describe("clubFault gating", () => {
  it("fires only with a real loop, enough coverage, and a clean trace", () => {
    expect(clubFault(clubAnalysis({ loopPct: 10, coveragePct: 60, quality: 0.7 }))).not.toBeNull();
  });

  it("won't invent a fault from a noisy or sparse trace", () => {
    expect(clubFault(clubAnalysis({ loopPct: 10, coveragePct: 30, quality: 0.7 }))).toBeNull(); // too little coverage
    expect(clubFault(clubAnalysis({ loopPct: 10, coveragePct: 60, quality: 0.2 }))).toBeNull(); // too noisy
    expect(clubFault(clubAnalysis({ loopPct: 3, coveragePct: 60, quality: 0.7 }))).toBeNull(); // loop too small
    expect(clubFault(clubAnalysis({ loopPct: NaN, coveragePct: 60, quality: 0.7 }))).toBeNull(); // untracked
  });

  it("the club fault is bilingual and well-formed when it fires", () => {
    const f = clubFault(clubAnalysis({ loopPct: 12, coveragePct: 70, quality: 0.8 }))!;
    expect(f.title).toContain("·");
    expect(f.fix.length).toBeGreaterThan(0);
    expect(f.focus).toMatch(/slice|path/i);
  });

  it("uses strict > on every gate (equal-to-threshold does not fire)", () => {
    // loop / coverage / quality thresholds are 6 / 45 / 0.4.
    expect(clubFault(clubAnalysis({ loopPct: 6.0, coveragePct: 50, quality: 0.5 }))).toBeNull();
    expect(clubFault(clubAnalysis({ loopPct: 6.01, coveragePct: 50, quality: 0.5 }))).not.toBeNull();
    expect(clubFault(clubAnalysis({ loopPct: 10, coveragePct: 45.0, quality: 0.5 }))).toBeNull();
    expect(clubFault(clubAnalysis({ loopPct: 10, coveragePct: 45.01, quality: 0.5 }))).not.toBeNull();
    expect(clubFault(clubAnalysis({ loopPct: 10, coveragePct: 50, quality: 0.4 }))).toBeNull();
    expect(clubFault(clubAnalysis({ loopPct: 10, coveragePct: 50, quality: 0.41 }))).not.toBeNull();
  });
});

describe("analyzeClub guards", () => {
  const { frames, phases } = buildSwing();
  it("returns null when there is no motion data", () => {
    expect(analyzeClub(null, frames, phases)).toBeNull();
  });
  it("returns null when there are too few motion frames to trust", () => {
    expect(analyzeClub({ w: 8, h: 8, data: [new Uint8ClampedArray(64)] }, frames, phases)).toBeNull();
  });
});
