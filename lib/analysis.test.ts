import { describe, it, expect } from "vitest";
import {
  detectPhases,
  computeMetrics,
  flagFaults,
  watchNotes,
  computeSpeed,
  computeSequence,
  swingQuality,
  analyzeSwing,
  interpNaN,
  type Metrics,
} from "./analysis";
import { buildSwing, buildStill } from "@/test/fixtures";

function metrics(over: Partial<Metrics> = {}): Metrics {
  return {
    view: "face-on",
    tempoRatio: 3,
    backswingS: 0.75,
    downswingS: 0.25,
    headSwayPct: 5,
    headVertPct: 4,
    hipSwayBackPct: 8,
    hipSlideImpactPct: 6,
    spineAddrDeg: 30,
    spineTopDeg: 31,
    spineImpactDeg: 28,
    reverseSpineDeg: 1,
    secondaryTiltDeg: 2,
    ...over,
  };
}

describe("detectPhases", () => {
  it("recovers an ordered address → top → impact → finish", () => {
    const { frames } = buildSwing();
    const p = detectPhases(frames);
    expect(p.address).toBeLessThan(p.top);
    expect(p.top).toBeLessThan(p.impact);
    expect(p.impact).toBeLessThanOrEqual(p.finish);
    // top is the highest-hands frame; our fixture peaks near frame 24.
    expect(p.top).toBeGreaterThan(14);
    expect(p.top).toBeLessThan(30);
  });

  it("throws on a clip too short to hold a swing", () => {
    const { frames } = buildSwing({ phases: { address: 0, top: 2, impact: 3, finish: 4 }, n: 5 });
    expect(() => detectPhases(frames)).toThrow(/too short/i);
  });

  it("throws when the body was never tracked", () => {
    const frames = new Array(20).fill(null);
    expect(() => detectPhases(frames)).toThrow(/track/i);
  });
});

describe("computeMetrics", () => {
  it("reads a steady swing as steady and face-on", () => {
    const { frames, phases } = buildSwing();
    const m = computeMetrics(frames, phases, 30);
    expect(m.view).toBe("face-on");
    expect(m.headSwayPct).toBeLessThan(3);
    expect(m.headVertPct).toBeLessThan(3);
    expect(m.tempoRatio).toBeCloseTo(3, 0); // (24-6)/(30-24) = 3
  });

  it("measures head sway when the nose drifts sideways", () => {
    const { frames, phases } = buildSwing({ noseDriftX: 0.12 });
    const m = computeMetrics(frames, phases, 30);
    // 0.12 of a ~0.75 body height ≈ 16% — into the fault band.
    expect(m.headSwayPct).toBeGreaterThan(15);
  });

  it("measures vertical head movement when the nose lifts", () => {
    const { frames, phases } = buildSwing({ noseDriftY: 0.1 });
    const m = computeMetrics(frames, phases, 30);
    expect(m.headVertPct).toBeGreaterThan(12);
  });

  it("classifies a narrow-shouldered clip as down-the-line", () => {
    const { frames, phases } = buildSwing({ view: "down-the-line" });
    const m = computeMetrics(frames, phases, 30);
    expect(m.view).toBe("down-the-line");
  });

  it("returns NaN tempo when the downswing has zero duration", () => {
    const { frames } = buildSwing();
    const m = computeMetrics(frames, { address: 6, top: 24, impact: 24, finish: 40 }, 30);
    expect(Number.isNaN(m.tempoRatio)).toBe(true);
  });
});

describe("flagFaults", () => {
  it("stays silent on a clean swing", () => {
    expect(flagFaults(metrics())).toHaveLength(0);
  });

  it("fires lateral sway on excess head travel from any view", () => {
    const f = flagFaults(metrics({ headSwayPct: 18, view: "down-the-line" }));
    expect(f.map((x) => x.title).join()).toMatch(/sway/i);
  });

  it("gates the hip arm of the sway fault to face-on only", () => {
    // Big hip number, small head number: face-on fires, DTL does not.
    expect(flagFaults(metrics({ headSwayPct: 5, hipSwayBackPct: 25, view: "face-on" }))).toHaveLength(1);
    expect(flagFaults(metrics({ headSwayPct: 5, hipSwayBackPct: 25, view: "down-the-line" }))).toHaveLength(0);
  });

  it("fires the head lift fault above 12%", () => {
    expect(flagFaults(metrics({ headVertPct: 13 }))).toHaveLength(1);
    expect(flagFaults(metrics({ headVertPct: 12 }))).toHaveLength(0);
  });

  it("fires rushed transition below 1.8 but ignores NaN tempo", () => {
    expect(flagFaults(metrics({ tempoRatio: 1.5 }))).toHaveLength(1);
    expect(flagFaults(metrics({ tempoRatio: NaN }))).toHaveLength(0);
  });

  it("every fault carries the full bilingual shape", () => {
    const f = flagFaults(metrics({ headSwayPct: 30, headVertPct: 30, tempoRatio: 1.2 }));
    expect(f.length).toBe(3);
    for (const fault of f) {
      for (const k of ["title", "mishit", "detail", "fix", "focus"] as const) {
        expect(typeof fault[k]).toBe("string");
        expect(fault[k].length).toBeGreaterThan(0);
      }
      expect(fault.title).toContain("·"); // EN · ZH bilingual separator
    }
  });
});

describe("watchNotes", () => {
  it("is empty for a neutral spine", () => {
    expect(watchNotes(metrics())).toHaveLength(0);
  });
  it("notes a big secondary-tilt change", () => {
    expect(watchNotes(metrics({ secondaryTiltDeg: 20 }))).toHaveLength(1);
    expect(watchNotes(metrics({ secondaryTiltDeg: -20 }))).toHaveLength(1);
  });
  it("notes a possible reverse pivot", () => {
    expect(watchNotes(metrics({ reverseSpineDeg: 12 }))).toHaveLength(1);
  });
});

describe("computeSpeed", () => {
  it("produces a finite peak that lands inside the swing window", () => {
    const { frames, times, phases } = buildSwing();
    const s = computeSpeed(frames, times, phases)!;
    expect(s).not.toBeNull();
    expect(s.v).toHaveLength(frames.length);
    expect(Number.isFinite(s.peak)).toBe(true);
    expect(s.peak).toBeGreaterThan(0);
    expect(s.peakT).toBeGreaterThanOrEqual(times[phases.address]);
    expect(s.peakT).toBeLessThanOrEqual(times[phases.finish]);
  });

  it("bails out when times and frames disagree", () => {
    const { frames, phases } = buildSwing();
    expect(computeSpeed(frames, [0, 1, 2], phases)).toBeNull();
  });
});

describe("computeSequence", () => {
  it("returns nulls when there is no hand-speed series", () => {
    const { frames, times, phases } = buildSwing();
    expect(computeSequence(frames, times, phases, null)).toEqual({ sequence: null, xfactor: null });
  });

  it("returns nulls when landmarks carry no depth (z)", () => {
    // The fixture sets z = 0 everywhere, so rotation can't be read → null.
    const { frames, times, phases } = buildSwing();
    const speed = computeSpeed(frames, times, phases);
    const { sequence, xfactor } = computeSequence(frames, times, phases, speed);
    expect(sequence).toBeNull();
    expect(xfactor).toBeNull();
  });
});

describe("swingQuality", () => {
  it("accepts a real swing", () => {
    const { frames, phases } = buildSwing();
    const q = swingQuality(frames, phases, 30);
    expect(q.ok).toBe(true);
    expect(q.confidence).toBeDefined();
  });

  it("rejects a still clip where the hands never rose", () => {
    const { frames } = buildStill();
    // A still clip has no real top; detectPhases still returns indices, but the
    // hand-rise / tempo gates in swingQuality should reject it.
    const q = swingQuality(frames, { address: 0, top: 20, impact: 25, finish: 39 }, 30);
    expect(q.ok).toBe(false);
  });

  it("rejects a segment with patchy tracking", () => {
    const { frames, phases } = buildSwing();
    // Keep only every 4th frame (~26% detected) — under the 30% gate.
    for (let i = phases.address; i <= phases.finish; i += 1) if (i % 4 !== 0) frames[i] = null;
    const q = swingQuality(frames, phases, 30);
    expect(q.ok).toBe(false);
  });
});

describe("analyzeSwing (end to end)", () => {
  it("runs the whole pipeline on a clean swing with no faults", () => {
    const { frames, times, fps } = buildSwing();
    const a = analyzeSwing(frames, fps, times);
    expect(a.phases.address).toBeLessThan(a.phases.top);
    expect(a.phases.top).toBeLessThan(a.phases.impact);
    expect(a.faults).toHaveLength(0);
    expect(a.detectedPct).toBeCloseTo(100, 0);
    expect(a.speed).not.toBeNull();
    expect(a.quality.ok).toBe(true);
  });

  it("surfaces faults on a swaying, head-lifting swing", () => {
    const { frames, times, fps } = buildSwing({ noseDriftX: 0.16, noseDriftY: 0.14 });
    const a = analyzeSwing(frames, fps, times);
    expect(a.faults.length).toBeGreaterThan(0);
  });

  it("derives per-frame times from fps when none are given", () => {
    const { frames, fps } = buildSwing();
    const a = analyzeSwing(frames, fps);
    expect(a.times.address).toBeCloseTo(a.phases.address / fps, 5);
  });

  it("names the exact faults it fires (sway + head lift)", () => {
    const { frames, times, fps } = buildSwing({ noseDriftX: 0.2, noseDriftY: 0.18 });
    const titles = analyzeSwing(frames, fps, times).faults.map((f) => f.title).join(" ");
    expect(titles).toMatch(/sway/i);
    expect(titles).toMatch(/head lifts|dips/i);
  });

  it("reports detected% below 100 when frames are sparse", () => {
    const { frames, times, fps } = buildSwing();
    for (let i = 0; i < frames.length; i++) if (i % 5 !== 0) frames[i] = null; // keep ~20%
    const a = analyzeSwing(frames, fps, times);
    expect(a.detectedPct).toBeLessThan(40);
    expect(a.detectedPct).toBeGreaterThan(0);
  });
});

// --- The kinematic-sequence / x-factor path: only reachable with real depth. ---
describe("computeSequence (with depth)", () => {
  it("produces an ordered sequence and a real x-factor when the body coils", () => {
    const { frames, times, phases } = buildSwing({ depth: true });
    const speed = computeSpeed(frames, times, phases)!;
    const { sequence, xfactor } = computeSequence(frames, times, phases, speed);
    expect(sequence).not.toBeNull();
    expect(sequence!.peaks).toHaveLength(3);
    expect(sequence!.peaks.map((p) => p.name).sort()).toEqual(["hands", "pelvis", "torso"]);
    // hands deliver last in a real downswing
    expect(sequence!.peaks[sequence!.peaks.length - 1].name).toBe("hands");
    expect(typeof sequence!.textbook).toBe("boolean");
    expect(xfactor).not.toBeNull();
    expect(xfactor!.topDeg).toBeGreaterThan(12);
    expect(xfactor!.stretchPct).toBeGreaterThanOrEqual(0);
  });

  it("surfaces the sequence through the full analyzeSwing pipeline", () => {
    const { frames, times, fps } = buildSwing({ depth: true });
    const a = analyzeSwing(frames, fps, times);
    expect(a.sequence).not.toBeNull();
    expect(a.xfactor).not.toBeNull();
  });
});

describe("interpNaN", () => {
  it("linearly fills an interior gap between the bracketing known values", () => {
    expect(interpNaN([0, NaN, NaN, NaN, 4])).toEqual([0, 1, 2, 3, 4]);
  });
  it("forward-fills a leading gap and back-fills a trailing gap", () => {
    expect(interpNaN([NaN, NaN, 2, 4])).toEqual([2, 2, 2, 4]);
    expect(interpNaN([1, 2, NaN, NaN])).toEqual([1, 2, 2, 2]);
  });
  it("leaves a clean series untouched", () => {
    expect(interpNaN([1, 2, 3])).toEqual([1, 2, 3]);
  });
});

describe("flagFaults / watchNotes exact boundaries", () => {
  const m = (over: Partial<Metrics>): Metrics => ({
    view: "face-on", tempoRatio: 3, backswingS: 0.75, downswingS: 0.25,
    headSwayPct: 5, headVertPct: 4, hipSwayBackPct: 8, hipSlideImpactPct: 6,
    spineAddrDeg: 30, spineTopDeg: 31, spineImpactDeg: 28, reverseSpineDeg: 1, secondaryTiltDeg: 2,
    ...over,
  });
  it("sway fault fires just above 15, not at 15", () => {
    expect(flagFaults(m({ headSwayPct: 15 }))).toHaveLength(0);
    expect(flagFaults(m({ headSwayPct: 15.01 }))).toHaveLength(1);
  });
  it("head-lift fault fires just above 12, not at 12", () => {
    expect(flagFaults(m({ headVertPct: 12 }))).toHaveLength(0);
    expect(flagFaults(m({ headVertPct: 12.01 }))).toHaveLength(1);
  });
  it("rushed fault fires just below 1.8, not at 1.8", () => {
    expect(flagFaults(m({ tempoRatio: 1.8 }))).toHaveLength(0);
    expect(flagFaults(m({ tempoRatio: 1.79 }))).toHaveLength(1);
  });
  it("watchNotes fire just past their thresholds (15° / 10°)", () => {
    expect(watchNotes(m({ secondaryTiltDeg: 15 }))).toHaveLength(0);
    expect(watchNotes(m({ secondaryTiltDeg: 15.1 }))).toHaveLength(1);
    expect(watchNotes(m({ reverseSpineDeg: 10 }))).toHaveLength(0);
    expect(watchNotes(m({ reverseSpineDeg: 10.1 }))).toHaveLength(1);
  });
});

describe("swingQuality confidence + computeSpeed shape", () => {
  it("rates a clean tracking/rise/tempo swing as high confidence", () => {
    const { frames, phases } = buildSwing();
    expect(swingQuality(frames, phases, 30).confidence).toBe("high");
  });
  it("drops to low confidence when tracking is patchy but still a swing", () => {
    // Keep ~1/3 of frames: still a valid swing (det ≥ 30%) but under the 40%
    // high-confidence bar, so the UI hedges and withholds prescriptive drills.
    const { frames, phases } = buildSwing();
    for (let i = phases.address; i <= phases.finish; i++) if (i % 3 !== 0) frames[i] = null;
    const q = swingQuality(frames, phases, 30);
    expect(q.ok).toBe(true);
    expect(q.confidence).toBe("low");
  });
  it("computeSpeed peak exceeds the speed at impact", () => {
    const { frames, times, phases } = buildSwing();
    const s = computeSpeed(frames, times, phases)!;
    expect(s.v[phases.impact]).toBeLessThanOrEqual(s.peak);
  });
});

describe("detectPhases over wrist-tracking gaps", () => {
  it("still recovers ordered phases when a run of frames is untracked", () => {
    const { frames } = buildSwing();
    for (let i = 14; i <= 18; i++) frames[i] = null; // gap across the backswing
    const p = detectPhases(frames);
    expect(p.address).toBeLessThan(p.top);
    expect(p.top).toBeLessThan(p.impact);
    expect(p.impact).toBeLessThanOrEqual(p.finish);
  });
});
