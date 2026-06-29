"use client";

import { useState } from "react";
import type { Analysis, PhaseName } from "@/lib/analysis";
import { PHASES } from "@/lib/analysis";
import type { SavedMeta, Still } from "@/lib/library";
import { bhToMph } from "./SpeedChart";

// Side-by-side compare of two SAVED swings — phase-locked stills + an A|B|Δ
// table. Honest by construction: rows that two clips can't fairly compare
// (view-sensitive ones when the camera angle differs) are HIDDEN behind a
// banner, and mph uses each swing's own filmed height, never a global value.

const PHASE_LABEL: Record<PhaseName, string> = {
  address: "Address",
  top: "Top",
  impact: "Impact",
  finish: "Finish",
};

type Side = { analysis: Analysis; stills: Still[]; meta: SavedMeta };

type Row = {
  label: string;
  unit: string;
  digits: number;
  viewSensitive: boolean; // hidden when the two clips were filmed from different views
  get: (s: Side) => number;
};

const ROWS: Row[] = [
  { label: "Tempo", unit: ":1", digits: 1, viewSensitive: false, get: (s) => s.analysis.metrics.tempoRatio },
  { label: "Backswing", unit: "s", digits: 2, viewSensitive: false, get: (s) => s.analysis.metrics.backswingS },
  { label: "Downswing", unit: "s", digits: 2, viewSensitive: false, get: (s) => s.analysis.metrics.downswingS },
  { label: "Peak hand speed", unit: "mph", digits: 0, viewSensitive: false, get: (s) => (s.analysis.speed ? bhToMph(s.analysis.speed.peak, s.meta.heightCmAtSave) : NaN) },
  { label: "Head sway", unit: "%", digits: 0, viewSensitive: true, get: (s) => s.analysis.metrics.headSwayPct },
  { label: "Head vertical", unit: "%", digits: 0, viewSensitive: true, get: (s) => s.analysis.metrics.headVertPct },
  { label: "Hip sway (back)", unit: "%", digits: 0, viewSensitive: true, get: (s) => s.analysis.metrics.hipSwayBackPct },
];

export default function ComparePanel({ a, b, onClose }: { a: Side; b: Side; onClose: () => void }) {
  const [phase, setPhase] = useState<PhaseName>("impact");
  const sides: [Side, Side] = [a, b];

  const viewMismatch = a.meta.view !== b.meta.view;
  const heightMismatch = a.meta.heightCmAtSave !== b.meta.heightCmAtSave;
  // Only a mismatch when BOTH sides tagged a club and they differ — an untagged
  // (older / unset) swing doesn't trigger a false warning.
  const clubMismatch = !!a.meta.clubAtSave && !!b.meta.clubAtSave && a.meta.clubAtSave !== b.meta.clubAtSave;

  const stillFor = (s: Side) => s.stills.find((x) => x.name === phase)?.url ?? s.stills[0]?.url;
  const label = (s: Side) => s.meta.label || s.meta.fileName;

  // Build the visible rows; drop view-sensitive ones on a view mismatch.
  const rows = ROWS.filter((r) => !(r.viewSensitive && viewMismatch))
    .map((r) => {
      const va = r.get(a);
      const vb = r.get(b);
      if (Number.isNaN(va) || Number.isNaN(vb)) return null;
      return { ...r, va, vb, delta: vb - va };
    })
    .filter(Boolean) as (Row & { va: number; vb: number; delta: number })[];

  // Highlight the biggest relative change.
  let biggest = -1;
  let biggestRel = 0;
  rows.forEach((r, i) => {
    const rel = Math.abs(r.va) > 0.15 ? Math.abs(r.delta) / Math.abs(r.va) : 0;
    if (rel > biggestRel) {
      biggestRel = rel;
      biggest = i;
    }
  });

  return (
    <div className="results">
      <div className="cmptop">
        <div className="section-title" style={{ marginTop: 0 }}>
          Compare · {label(a)} vs {label(b)}
        </div>
        <button className="chip" onClick={onClose}>
          ✕ Close
        </button>
      </div>

      <div className="seg cmpseg" role="tablist">
        {PHASES.map((p) => (
          <button key={p} className={p === phase ? "on" : ""} onClick={() => setPhase(p)}>
            {PHASE_LABEL[p]}
          </button>
        ))}
      </div>

      <div className="cmpcols">
        {sides.map((s, i) => (
          <figure className="cmpcol" key={i}>
            {stillFor(s) ? <img src={stillFor(s)} alt={`${label(s)} ${phase}`} /> : <div className="demobox">no still</div>}
            <figcaption>
              <b>{label(s)}</b>
              <span className="num"> · {s.meta.view}</span>
            </figcaption>
          </figure>
        ))}
      </div>

      {viewMismatch && (
        <p className="note cmpwarn">
          ⚠ Filmed from different angles ({a.meta.view} vs {b.meta.view}) — only tempo &amp; timing are fairly
          comparable, so view-sensitive numbers (sway, spine) are hidden.
        </p>
      )}

      <div className="tablewrap">
        <table className="ctable">
          <thead>
            <tr>
              <th></th>
              <th className="num">A</th>
              <th className="num">B</th>
              <th className="num">Δ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const better = i === biggest && biggestRel > 0.05;
              const sign = r.delta >= 0 ? "+" : "";
              return (
                <tr key={r.label} className={better ? "worst" : ""}>
                  <td>
                    {r.label}
                    {r.label === "Peak hand speed" && (heightMismatch || clubMismatch) ? " ⚠" : ""}
                  </td>
                  <td className="num">{r.va.toFixed(r.digits)}</td>
                  <td className="num">{r.vb.toFixed(r.digits)}</td>
                  <td className="num" style={{ color: Math.abs(r.delta) < 0.05 ? "var(--muted)" : "var(--data)" }}>
                    {sign}
                    {r.delta.toFixed(r.digits)}
                    <small> {r.unit}</small>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {heightMismatch && (
        <p className="note">
          ⚠ The two swings were filmed at different heights ({a.meta.heightCmAtSave} vs {b.meta.heightCmAtSave} cm), so
          the mph comparison is approximate — speed is scaled from height.
        </p>
      )}
      {clubMismatch && (
        <p className="note">
          ⚠ These were tagged different clubs ({a.meta.clubAtSave} vs {b.meta.clubAtSave}) — a longer club is swung
          faster, so the hand-speed comparison isn&apos;t apples-to-apples. 这两杆标的是不同球杆，长杆挥得更快，手速不能直接比。
        </p>
      )}
      <p className="note">
        Δ = B − A. Compared from stills + saved metrics on this device — nothing uploaded. The clubface still can&apos;t
        be seen, so curve (slice vs pull) isn&apos;t in here.
      </p>
    </div>
  );
}
