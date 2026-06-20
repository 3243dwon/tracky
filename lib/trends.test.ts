import { describe, it, expect } from "vitest";
import { peakMph, buildMetricTrend, repeatability, summarize, slopePerSwing, sortMetas } from "./trends";
import type { SavedMeta } from "./library";

const DAY = 86_400_000;
const BASE = 1_700_000_000_000;

// Minimal SavedMeta rows; createdAt defaults to one-per-day ascending by array
// order so callers can pass values "in chronological order" and not think about it.
function metas(rows: Array<Partial<SavedMeta>>): SavedMeta[] {
  return rows.map((r, i) => ({
    id: `s${i}`,
    schema: 1,
    createdAt: BASE + i * DAY,
    fileName: "swing.mp4",
    label: "",
    view: "face-on",
    heightCmAtSave: 178,
    tempoRatio: 3.0,
    backswingS: 0.75,
    downswingS: 0.25,
    peakBh: null,
    win: { start: 0, end: 1 },
    thumb: "",
    hasFrames: true,
    hasScrubs: false,
    sizeBytes: 0,
    ...r,
  }));
}
const tempos = (...vals: number[]) => metas(vals.map((tempoRatio) => ({ tempoRatio })));

describe("peakMph", () => {
  it("converts body-heights/sec with the SpeedChart formula", () => {
    expect(peakMph({ peakBh: 2.6, heightCmAtSave: 178 })).toBeCloseTo(2.6 * 1.78 * 0.89 * 2.23694, 4);
  });
  it("is null when there's no peak", () => {
    expect(peakMph({ peakBh: null, heightCmAtSave: 178 })).toBeNull();
    expect(peakMph({ peakBh: NaN, heightCmAtSave: 178 })).toBeNull();
  });
  it("is monotonic in peakBh at a fixed height", () => {
    const a = peakMph({ peakBh: 2.0, heightCmAtSave: 178 })!;
    const b = peakMph({ peakBh: 2.5, heightCmAtSave: 178 })!;
    expect(b).toBeGreaterThan(a);
  });
});

describe("buildMetricTrend", () => {
  it("orders points oldest → newest regardless of input order", () => {
    const shuffled = [
      { id: "b", createdAt: BASE + 2 * DAY, tempoRatio: 2.8 },
      { id: "a", createdAt: BASE, tempoRatio: 2.2 },
      { id: "c", createdAt: BASE + 4 * DAY, tempoRatio: 3.0 },
    ].map((r) => metas([r])[0]);
    const t = buildMetricTrend(shuffled, "tempo");
    expect(t.points.map((p) => p.value)).toEqual([2.2, 2.8, 3.0]);
    expect(t.latest).toBe(3.0);
  });

  it("drops rows with no value for that metric", () => {
    const rows = metas([{ tempoRatio: 2.5 }, { tempoRatio: NaN }, { tempoRatio: 3.1 }]);
    expect(buildMetricTrend(rows, "tempo").points).toHaveLength(2);
    // none of these rows have a peakBh → the speed series is empty
    expect(buildMetricTrend(rows, "speed").points).toHaveLength(0);
  });

  it("picks the tempo personal-best closest to 3:1", () => {
    const t = buildMetricTrend(tempos(2.1, 3.2, 4.5, 2.9), "tempo");
    expect(t.best).toBe(2.9);
  });

  it("picks the fastest hand speed as the personal best", () => {
    const rows = metas([{ peakBh: 2.0 }, { peakBh: 2.8 }, { peakBh: 2.4 }]);
    const s = buildMetricTrend(rows, "speed");
    expect(s.best).toBeCloseTo(peakMph({ peakBh: 2.8, heightCmAtSave: 178 })!, 6);
  });

  it("computes a positive slope for a rising series", () => {
    expect(buildMetricTrend(tempos(2.0, 2.3, 2.6, 2.9), "tempo").slope).toBeGreaterThan(0);
    expect(buildMetricTrend(tempos(3.0, 2.7, 2.4, 2.1), "tempo").slope).toBeLessThan(0);
  });

  it("reports spread (sd) and a scale-free cv", () => {
    const t = buildMetricTrend(tempos(3.0, 3.0, 3.0, 3.0), "tempo");
    expect(t.sd).toBe(0);
    expect(t.cv).toBe(0);
    expect(buildMetricTrend(tempos(2.0, 4.0), "tempo").sd).toBeGreaterThan(0);
  });

  it("returns n/a direction below the minimum sample", () => {
    expect(buildMetricTrend(tempos(2.0, 3.0), "tempo").dir).toBe("n/a");
  });

  it("reads tempo moving toward 3:1 as improving, away as declining", () => {
    expect(buildMetricTrend(tempos(2.2, 2.3, 2.6, 2.9, 3.0), "tempo").dir).toBe("improving");
    expect(buildMetricTrend(tempos(3.0, 2.9, 2.5, 2.2, 1.9), "tempo").dir).toBe("declining");
    expect(buildMetricTrend(tempos(3.1, 2.9, 2.9, 3.1), "tempo").dir).toBe("steady");
  });
});

describe("repeatability", () => {
  it("detects a tightening spread", () => {
    // same off-center mean (~2.6), spread collapses 0.4 → 0.1
    expect(repeatability([2.2, 3.0, 2.5, 2.7])).toBe("tightening");
  });
  it("detects a loosening spread", () => {
    expect(repeatability([2.5, 2.7, 2.2, 3.0])).toBe("loosening");
  });
  it("is steady when the spread holds", () => {
    expect(repeatability([3.0, 3.0, 3.0, 3.0])).toBe("steady");
  });
  it("won't call a trend below the minimum sample", () => {
    expect(repeatability([2.0, 3.0])).toBe("steady");
  });
});

describe("summarize headlines", () => {
  it("returns no headline and no trends for an empty library", () => {
    const s = summarize([]);
    expect(s.headline).toBeNull();
    expect(s.trends).toHaveLength(0);
    expect(s.nSwings).toBe(0);
  });

  it("nudges the user to film more before a trend exists", () => {
    const s = summarize(tempos(2.5, 2.6));
    expect(s.nSwings).toBe(2);
    expect(s.headline?.en).toMatch(/film 2 more/i);
    expect(s.headline?.zh).toMatch(/再拍 2 次/);
  });

  it("celebrates tempo trending toward 3:1", () => {
    const s = summarize(tempos(2.2, 2.3, 2.6, 2.9, 3.0));
    expect(s.headline?.en).toMatch(/settling toward a smooth 3:1/i);
  });

  it("celebrates tightening repeatability when the mean isn't improving", () => {
    const s = summarize(tempos(2.2, 3.0, 2.5, 2.7));
    expect(s.headline?.en).toMatch(/more repeatable/i);
  });

  it("flags rising hand speed when tempo is flat", () => {
    const rows = metas([
      { tempoRatio: 3.0, peakBh: 2.0 },
      { tempoRatio: 3.0, peakBh: 2.3 },
      { tempoRatio: 3.0, peakBh: 2.6 },
      { tempoRatio: 3.0, peakBh: 2.9 },
    ]);
    expect(summarize(rows).headline?.en).toMatch(/hand speed is trending up/i);
  });

  it("gently flags a tempo that has drifted away", () => {
    const s = summarize(tempos(3.0, 2.8, 2.4, 2.0));
    expect(s.headline?.en).toMatch(/drifted/i);
  });

  it("affirms a steady, repeatable player", () => {
    const s = summarize(tempos(3.1, 2.9, 2.9, 3.1));
    expect(s.headline?.en).toMatch(/steady across/i);
  });

  it("reports the span in days and only non-empty trends", () => {
    const s = summarize(tempos(2.5, 2.6, 2.7, 2.8));
    expect(s.spanDays).toBeCloseTo(3, 5); // 4 swings, one per day
    expect(s.trends.map((t) => t.key)).toEqual(["tempo"]); // no speed data
  });
});

describe("slopePerSwing", () => {
  it("is 0 for fewer than two points or a flat series", () => {
    expect(slopePerSwing([])).toBe(0);
    expect(slopePerSwing([5])).toBe(0);
    expect(slopePerSwing([3, 3, 3])).toBe(0);
  });
  it("signs match the trend direction", () => {
    expect(slopePerSwing([1, 2, 3, 4])).toBeGreaterThan(0);
    expect(slopePerSwing([4, 3, 2, 1])).toBeLessThan(0);
  });
  it("equals the exact least-squares slope on a clean line", () => {
    expect(slopePerSwing([0, 2, 4, 6])).toBeCloseTo(2, 9); // +2 per swing
  });
});

describe("direction edge cases (degenerate baselines)", () => {
  it("speed branch (more-is-better) reads improving / declining / steady", () => {
    const speed = (...bh: number[]) => metas(bh.map((peakBh) => ({ peakBh })));
    expect(buildMetricTrend(speed(2.0, 2.2, 2.5, 2.8), "speed").dir).toBe("improving");
    expect(buildMetricTrend(speed(2.8, 2.5, 2.2, 2.0), "speed").dir).toBe("declining");
    expect(buildMetricTrend(speed(2.4, 2.42, 2.39, 2.41), "speed").dir).toBe("steady");
  });
  it("a perfect first half + tiny drift reads steady, not declining", () => {
    expect(buildMetricTrend(tempos(3.0, 3.0, 3.02, 2.99), "tempo").dir).toBe("steady");
  });
  it("a perfect first half + a real drift still reads declining", () => {
    expect(buildMetricTrend(tempos(3.0, 3.0, 2.5, 2.3), "tempo").dir).toBe("declining");
  });
});

describe("repeatability edge cases (flat first half)", () => {
  it("flat first half + tiny second-half noise reads steady, not loosening", () => {
    expect(repeatability([3.0, 3.0, 3.01, 2.99])).toBe("steady");
  });
  it("flat first half + a real spread reads loosening", () => {
    expect(repeatability([3.0, 3.0, 2.0, 4.0])).toBe("loosening");
  });
});

describe("cv stays finite", () => {
  it("is a finite, non-NaN ratio for a normal series", () => {
    const t = buildMetricTrend(tempos(2.8, 3.0, 3.2, 3.0), "tempo");
    expect(Number.isFinite(t.cv)).toBe(true);
    expect(t.cv).toBeGreaterThan(0);
  });
});

describe("sortMetas", () => {
  const rows = metas([
    { id: "a", createdAt: BASE + 0 * DAY, tempoRatio: 3.4, peakBh: 2.0 },
    { id: "b", createdAt: BASE + 2 * DAY, tempoRatio: 2.0, peakBh: 2.8 },
    { id: "c", createdAt: BASE + 1 * DAY, tempoRatio: NaN, peakBh: null },
  ]);

  it("newest sorts by createdAt descending", () => {
    expect(sortMetas(rows, "newest").map((m) => m.id)).toEqual(["b", "c", "a"]);
  });
  it("fastest sorts by hand speed desc with unknown speed last", () => {
    expect(sortMetas(rows, "fast").map((m) => m.id)).toEqual(["b", "a", "c"]);
  });
  it("smoothest sorts by |tempo − 3| asc with NaN tempo last", () => {
    expect(sortMetas(rows, "smooth").map((m) => m.id)).toEqual(["a", "b", "c"]);
  });
  it("does not mutate the input and handles empty / single arrays", () => {
    const copy = [...rows];
    sortMetas(rows, "fast");
    expect(rows.map((m) => m.id)).toEqual(copy.map((m) => m.id));
    expect(sortMetas([], "newest")).toEqual([]);
    expect(sortMetas([rows[0]], "smooth")).toHaveLength(1);
  });
});
