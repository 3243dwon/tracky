// "Am I swinging too fast or too slow?" — a recommended-pace + hand-speed-band
// read that sits under the speed section.
//
// Two honest pieces:
//  1. PACE (rhythm): driven by TEMPO, not absolute clock time — tempo is a ratio
//     so it survives slow-mo capture (120/240fps) where the raw seconds balloon.
//     too quick < 2.5  ·  on pace 2.5–3.6  ·  too slow > 3.6  (mirrors gradeTempo's
//     "good" band). Total swing time is shown only as rough context with a caveat.
//  2. SPEED BAND: where your peak hand speed falls vs a typical range for your
//     height. The band edges are the same body-heights/sec thresholds gradeHandSpeed
//     uses (typical 1.9–2.6 bh/s), converted to mph — so the two never disagree.
import type { Analysis } from "./analysis";
import { bhToMph } from "./units";

export const PACE_TEMPO_LO = 2.5;
export const PACE_TEMPO_HI = 3.6;
export const HS_BAND_LO_BH = 1.9; // body-heights/sec — "typical" lower edge
export const HS_BAND_HI_BH = 2.6; // — upper edge (matches gradeHandSpeed)

export type PaceVerdict = "quick" | "onpace" | "slow" | "na";
export type SpeedBand = "low" | "typical" | "high" | "na";

export type PaceRead = {
  tempo: number;
  pace: PaceVerdict;
  totalSwingS: number; // back + down — rough, slow-mo inflates it
  peakMph: number | null;
  bandLoMph: number;
  bandHiMph: number;
  speed: SpeedBand;
};

export function classifyPace(tempo: number): PaceVerdict {
  if (!Number.isFinite(tempo)) return "na";
  if (tempo < PACE_TEMPO_LO) return "quick";
  if (tempo > PACE_TEMPO_HI) return "slow";
  return "onpace";
}

export function handSpeedBandMph(heightCm: number): { lo: number; hi: number } {
  return { lo: bhToMph(HS_BAND_LO_BH, heightCm), hi: bhToMph(HS_BAND_HI_BH, heightCm) };
}

export function classifySpeed(peakBh: number | null | undefined): SpeedBand {
  if (peakBh == null || !Number.isFinite(peakBh)) return "na";
  if (peakBh < HS_BAND_LO_BH) return "low";
  if (peakBh > HS_BAND_HI_BH) return "high";
  return "typical";
}

export function readPace(a: Analysis, heightCm: number): PaceRead {
  const tempo = a.metrics.tempoRatio;
  const band = handSpeedBandMph(heightCm);
  const peakBh = a.speed?.peak ?? null;
  return {
    tempo,
    pace: classifyPace(tempo),
    totalSwingS: a.metrics.backswingS + a.metrics.downswingS,
    peakMph: peakBh != null && Number.isFinite(peakBh) ? bhToMph(peakBh, heightCm) : null,
    bandLoMph: band.lo,
    bandHiMph: band.hi,
    speed: classifySpeed(peakBh),
  };
}
