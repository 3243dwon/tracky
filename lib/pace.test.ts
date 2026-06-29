import { describe, it, expect } from "vitest";
import {
  classifyPace,
  classifySpeed,
  clubSpeedBand,
  handSpeedBandMph,
  readPace,
  PACE_TEMPO_LO,
  PACE_TEMPO_HI,
  HS_BAND_LO_BH,
  HS_BAND_HI_BH,
} from "./pace";
import { analyzeSwing, type Analysis } from "./analysis";
import { bhToMph } from "./units";
import { buildSwing } from "@/test/fixtures";

// A real Analysis to drive readPace; individual tests override fields by spread.
function baseline(): Analysis {
  const { frames, times, fps } = buildSwing();
  return analyzeSwing(frames, fps, times);
}

describe("classifyPace", () => {
  it("buckets tempo into too quick / on pace / too slow", () => {
    expect(classifyPace(2.0)).toBe("quick");
    expect(classifyPace(3.0)).toBe("onpace");
    expect(classifyPace(4.2)).toBe("slow");
  });
  it("treats the band edges as on-pace (inclusive)", () => {
    expect(classifyPace(PACE_TEMPO_LO)).toBe("onpace");
    expect(classifyPace(PACE_TEMPO_HI)).toBe("onpace");
    expect(classifyPace(PACE_TEMPO_LO - 0.01)).toBe("quick");
    expect(classifyPace(PACE_TEMPO_HI + 0.01)).toBe("slow");
  });
  it("is n/a for a non-finite tempo", () => {
    expect(classifyPace(NaN)).toBe("na");
    expect(classifyPace(Infinity)).toBe("na");
  });
});

describe("classifySpeed", () => {
  it("buckets peak hand speed vs the typical band", () => {
    expect(classifySpeed(1.5)).toBe("low");
    expect(classifySpeed(2.2)).toBe("typical");
    expect(classifySpeed(3.0)).toBe("high");
  });
  it("band edges are typical (inclusive)", () => {
    expect(classifySpeed(HS_BAND_LO_BH)).toBe("typical");
    expect(classifySpeed(HS_BAND_HI_BH)).toBe("typical");
  });
  it("is n/a for missing speed", () => {
    expect(classifySpeed(null)).toBe("na");
    expect(classifySpeed(undefined)).toBe("na");
    expect(classifySpeed(NaN)).toBe("na");
  });
});

describe("handSpeedBandMph", () => {
  it("returns an ordered band that scales with height", () => {
    const b = handSpeedBandMph(178);
    expect(b.lo).toBeLessThan(b.hi);
    expect(b.lo).toBeCloseTo(bhToMph(HS_BAND_LO_BH, 178), 6);
    expect(handSpeedBandMph(190).hi).toBeGreaterThan(handSpeedBandMph(160).hi);
  });
  it("a driver band sits higher than a wedge band at the same height", () => {
    expect(handSpeedBandMph(178, "driver").hi).toBeGreaterThan(handSpeedBandMph(178, "wedge").hi);
  });
});

describe("clubSpeedBand", () => {
  it("unset / null = the club-neutral band (today's behavior)", () => {
    expect(clubSpeedBand(null)).toEqual({ lo: HS_BAND_LO_BH, hi: HS_BAND_HI_BH });
    expect(clubSpeedBand(undefined)).toEqual({ lo: HS_BAND_LO_BH, hi: HS_BAND_HI_BH });
    expect(clubSpeedBand("iron")).toEqual({ lo: HS_BAND_LO_BH, hi: HS_BAND_HI_BH });
  });
  it("driver > iron > wedge on both edges", () => {
    const d = clubSpeedBand("driver"), i = clubSpeedBand("iron"), w = clubSpeedBand("wedge");
    expect(d.lo).toBeGreaterThan(i.lo);
    expect(i.lo).toBeGreaterThan(w.lo);
    expect(d.hi).toBeGreaterThan(i.hi);
    expect(i.hi).toBeGreaterThan(w.hi);
  });
  it("putt has no meaningful speed band", () => {
    const p = clubSpeedBand("putt");
    expect(Number.isFinite(p.lo)).toBe(false);
  });
});

describe("classifySpeed with a club", () => {
  it("the same speed reads differently per club band", () => {
    // 2.5 bh/s: inside the driver band (2.2–3.0) but above the wedge band (1.5–2.1).
    expect(classifySpeed(2.5, "driver")).toBe("typical");
    expect(classifySpeed(2.5, "wedge")).toBe("high");
    expect(classifySpeed(2.5)).toBe("typical"); // neutral 1.9–2.6
  });
  it("putt yields n/a (speed isn't a putting read)", () => {
    expect(classifySpeed(2.0, "putt")).toBe("na");
  });
});

describe("readPace", () => {
  it("reads an on-pace swing and fills the speed band", () => {
    const r = readPace(baseline(), 178);
    expect(r.pace).toBe("onpace"); // fixture tempo ≈ 3:1
    expect(r.totalSwingS).toBeGreaterThan(0);
    expect(r.bandLoMph).toBeLessThan(r.bandHiMph);
    expect(r.peakMph).not.toBeNull();
    expect(["low", "typical", "high"]).toContain(r.speed);
  });

  it("flags a rushed swing as too quick", () => {
    const a = baseline();
    const r = readPace({ ...a, metrics: { ...a.metrics, tempoRatio: 1.6 } }, 178);
    expect(r.pace).toBe("quick");
  });

  it("handles a swing with no speed series", () => {
    const a = baseline();
    const r = readPace({ ...a, speed: null }, 178);
    expect(r.peakMph).toBeNull();
    expect(r.speed).toBe("na");
  });

  it("survives a NaN tempo without throwing", () => {
    const a = baseline();
    const r = readPace({ ...a, metrics: { ...a.metrics, tempoRatio: NaN } }, 178);
    expect(r.pace).toBe("na");
    expect(Number.isNaN(r.tempo)).toBe(true);
  });
});
