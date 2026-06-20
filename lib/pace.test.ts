import { describe, it, expect } from "vitest";
import {
  classifyPace,
  classifySpeed,
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
