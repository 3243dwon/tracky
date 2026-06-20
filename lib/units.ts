// Canonical hand-speed unit conversion — the single source of truth shared by
// the live SpeedChart, the trends engine, and the pace card, so the number can
// never silently drift between "what you see now" and "your saved history".
//
// Our normalization unit is nose-to-ankle ≈ 0.89 × standing height, and
// 1 m/s = 2.23694 mph.
export const M_PER_BH = 0.89;
export const MPH_PER_MS = 2.23694;

export function bhToMph(vBh: number, heightCm: number): number {
  return vBh * (heightCm / 100) * M_PER_BH * MPH_PER_MS;
}
