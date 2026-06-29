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
export const HS_BAND_LO_BH = 1.9; // body-heights/sec — "typical" lower edge (club-neutral / unset)
export const HS_BAND_HI_BH = 2.6; // — upper edge (matches gradeHandSpeed)

// Which club was swung. null = unset/"auto" → the club-neutral band above, i.e.
// exactly today's behavior. A longer club is swung faster (hands too), so the
// "typical" hand-speed band shifts with it — this only moves the SPEED band, not
// the tempo grade (tour rhythm is ~3:1 almost regardless of club).
export type Club = "driver" | "iron" | "wedge" | "putt";

const CLUB_BAND: Record<Club, { lo: number; hi: number }> = {
  driver: { lo: 2.2, hi: 3.0 },
  iron: { lo: HS_BAND_LO_BH, hi: HS_BAND_HI_BH }, // the neutral band is iron-ish
  wedge: { lo: 1.5, hi: 2.1 },
  putt: { lo: NaN, hi: NaN }, // hand speed isn't a meaningful putting read
};

// The typical hand-speed band (body-heights/sec) for a club; the neutral band
// when unset. Single source of truth — gradeHandSpeed + classifySpeed both use it.
export function clubSpeedBand(club: Club | null | undefined): { lo: number; hi: number } {
  return club ? CLUB_BAND[club] : { lo: HS_BAND_LO_BH, hi: HS_BAND_HI_BH };
}

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

export function handSpeedBandMph(heightCm: number, club?: Club | null): { lo: number; hi: number } {
  const b = clubSpeedBand(club);
  return { lo: bhToMph(b.lo, heightCm), hi: bhToMph(b.hi, heightCm) };
}

export function classifySpeed(peakBh: number | null | undefined, club?: Club | null): SpeedBand {
  if (peakBh == null || !Number.isFinite(peakBh)) return "na";
  const b = clubSpeedBand(club);
  if (!Number.isFinite(b.lo) || !Number.isFinite(b.hi)) return "na"; // e.g. putt — no band
  if (peakBh < b.lo) return "low";
  if (peakBh > b.hi) return "high";
  return "typical";
}

export function readPace(a: Analysis, heightCm: number, club?: Club | null): PaceRead {
  const tempo = a.metrics.tempoRatio;
  const band = handSpeedBandMph(heightCm, club);
  const peakBh = a.speed?.peak ?? null;
  return {
    tempo,
    pace: classifyPace(tempo),
    totalSwingS: a.metrics.backswingS + a.metrics.downswingS,
    peakMph: peakBh != null && Number.isFinite(peakBh) ? bhToMph(peakBh, heightCm) : null,
    bandLoMph: band.lo,
    bandHiMph: band.hi,
    speed: classifySpeed(peakBh, club),
  };
}
