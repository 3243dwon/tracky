import { describe, it, expect } from "vitest";
import { gradeTempo, gradeSway, gradeVert, gradeHandSpeed, readMetrics } from "./grade";
import type { Metrics, SpeedAnalysis } from "./analysis";

// A baseline "all steady" metrics object; individual tests override one field.
function metrics(over: Partial<Metrics> = {}): Metrics {
  return {
    view: "face-on",
    tempoRatio: 3.0,
    backswingS: 0.75,
    downswingS: 0.25,
    headSwayPct: 5,
    headVertPct: 4,
    hipSwayBackPct: 8,
    hipSlideImpactPct: 6,
    spineAddrDeg: 30,
    spineTopDeg: 32,
    spineImpactDeg: 28,
    reverseSpineDeg: 2,
    secondaryTiltDeg: 2,
    ...over,
  };
}

describe("gradeTempo", () => {
  it("rejects non-finite tempo (no downswing)", () => {
    expect(gradeTempo(NaN)).toBeNull();
    expect(gradeTempo(Infinity)).toBeNull();
  });

  it("grades the smooth band as good", () => {
    expect(gradeTempo(3.0)?.level).toBe("good");
    expect(gradeTempo(2.5)?.level).toBe("good"); // inclusive lower edge
    expect(gradeTempo(3.6)?.level).toBe("good"); // inclusive upper edge
  });

  it("grades a touch quick / slow as ok", () => {
    expect(gradeTempo(2.0)).toMatchObject({ level: "ok", en: "a touch quick" });
    expect(gradeTempo(2.49)?.level).toBe("ok");
    expect(gradeTempo(3.61)).toMatchObject({ level: "ok", en: "a touch slow" });
    expect(gradeTempo(4.5)?.level).toBe("ok");
  });

  it("grades rushed / very slow as work", () => {
    expect(gradeTempo(1.99)).toMatchObject({ level: "work", en: "rushed" });
    expect(gradeTempo(1.2)?.level).toBe("work");
    expect(gradeTempo(4.51)).toMatchObject({ level: "work", en: "very slow" });
  });

  it("always carries bilingual copy", () => {
    for (const t of [1.5, 2.2, 3.0, 4.0, 5.0]) {
      const g = gradeTempo(t)!;
      expect(g.en.length).toBeGreaterThan(0);
      expect(g.zh.length).toBeGreaterThan(0);
    }
  });
});

describe("gradeSway / gradeVert", () => {
  it("sway bands at 10 and 15", () => {
    expect(gradeSway(9.9).level).toBe("good");
    expect(gradeSway(10).level).toBe("ok");
    expect(gradeSway(15).level).toBe("ok");
    expect(gradeSway(15.1).level).toBe("work");
  });

  it("vert bands at 8 and 12", () => {
    expect(gradeVert(7.9).level).toBe("good");
    expect(gradeVert(8).level).toBe("ok");
    expect(gradeVert(12).level).toBe("ok");
    expect(gradeVert(12.1).level).toBe("work");
  });

  it("grade thresholds line up with the fault gates in analysis.ts", () => {
    // flagFaults fires sway at >15 and vert at >12; the grade must read "work"
    // exactly where the fault fires, never contradicting the badge.
    expect(gradeSway(15.0001).level).toBe("work");
    expect(gradeVert(12.0001).level).toBe("work");
  });
});

describe("gradeHandSpeed", () => {
  it("returns null for missing / non-finite speed", () => {
    expect(gradeHandSpeed(null)).toBeNull();
    expect(gradeHandSpeed(undefined)).toBeNull();
    expect(gradeHandSpeed(0)).toBeNull();
    expect(gradeHandSpeed(NaN)).toBeNull();
  });

  it("never grades hand speed as work (soft orientation only)", () => {
    for (const bh of [0.5, 1.0, 1.9, 2.6, 4.0]) {
      const g = gradeHandSpeed(bh);
      if (g) expect(g.level).not.toBe("work");
    }
  });

  it("bands at 1.9 and 2.6 body-heights/sec", () => {
    expect(gradeHandSpeed(1.5)?.en).toBe("developing");
    expect(gradeHandSpeed(1.9)?.en).toBe("solid");
    expect(gradeHandSpeed(2.6)?.en).toBe("quick");
  });
});

describe("readMetrics", () => {
  const speed: SpeedAnalysis = { t: [0, 1], v: [0, 2], peak: 2.7, peakT: 0.5, impact: 2.5 };

  it("flags allGood when tempo/sway/vert are all good", () => {
    const r = readMetrics(metrics(), speed);
    expect(r.allGood).toBe(true);
    expect(r.leadEn).toContain("steady");
    expect(r.focusEn).toContain("repeating");
  });

  it("picks the worst metric as the focus", () => {
    // sway pushed into "work" should win over an ok-ish vert.
    const r = readMetrics(metrics({ headSwayPct: 20, headVertPct: 9 }), speed);
    expect(r.allGood).toBe(false);
    expect(r.worstKey).toBe("sway");
    expect(r.focusEn.toLowerCase()).toContain("head");
  });

  it("treats a rushed tempo as the worst when it is", () => {
    const r = readMetrics(metrics({ tempoRatio: 1.5 }), speed);
    expect(r.worstKey).toBe("tempo");
    expect(r.leadEn).toContain("tempo");
  });

  it("survives a NaN tempo (drops tempo from ranking, never crashes)", () => {
    const r = readMetrics(metrics({ tempoRatio: NaN, headSwayPct: 20 }), null);
    expect(r.tempo).toBeNull();
    expect(r.hand).toBeNull();
    expect(r.worstKey).toBe("sway");
  });

  it("always returns bilingual lead + focus copy", () => {
    for (const over of [{}, { headSwayPct: 25 }, { tempoRatio: 1.4 }, { headVertPct: 20 }]) {
      const r = readMetrics(metrics(over), speed);
      expect(r.leadEn.length).toBeGreaterThan(0);
      expect(r.leadZh.length).toBeGreaterThan(0);
      expect(r.focusEn.length).toBeGreaterThan(0);
      expect(r.focusZh.length).toBeGreaterThan(0);
    }
  });
});
