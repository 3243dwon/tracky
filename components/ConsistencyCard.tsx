"use client";

import type { Analysis } from "@/lib/analysis";
import { bhToMph } from "./SpeedChart";

type Row = {
  label: string;
  unit: string;
  digits: number;
  get: (a: Analysis) => number;
};

function mean(a: number[]): number {
  return a.reduce((s, v) => s + v, 0) / a.length;
}
function sd(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1));
}

export default function ConsistencyCard({
  analyses,
  heightCm,
  onSelect,
}: {
  analyses: Analysis[];
  heightCm: number;
  onSelect: (i: number) => void;
}) {
  if (analyses.length < 2) return null;

  const rows: Row[] = [
    { label: "Tempo 节奏", unit: ":1", digits: 1, get: (a) => a.metrics.tempoRatio },
    { label: "Backswing 上杆", unit: "s", digits: 2, get: (a) => a.metrics.backswingS },
    { label: "Downswing 下杆", unit: "s", digits: 2, get: (a) => a.metrics.downswingS },
    { label: "Head sway 头部横向", unit: "%", digits: 0, get: (a) => a.metrics.headSwayPct },
    { label: "Head vertical 头部上下", unit: "%", digits: 0, get: (a) => a.metrics.headVertPct },
    { label: "Hip sway (back) 髋部后移", unit: "%", digits: 0, get: (a) => a.metrics.hipSwayBackPct },
    { label: "Peak hand speed 手部峰值速度", unit: "mph", digits: 0, get: (a) => (a.speed ? bhToMph(a.speed.peak, heightCm) : NaN) },
  ];

  const table = rows
    .map((r) => {
      const vals = analyses.map((a) => r.get(a));
      if (vals.some((v) => Number.isNaN(v))) return null;
      const m = mean(vals);
      const s = sd(vals);
      const cv = Math.abs(m) > 0.15 ? s / Math.abs(m) : 0;
      return { ...r, vals, m, s, cv };
    })
    .filter(Boolean) as (Row & { vals: number[]; m: number; s: number; cv: number })[];

  if (!table.length) return null;
  const worst = table.reduce((b, r) => (r.cv > b.cv ? r : b), table[0]);
  const enough = analyses.length >= 3;

  return (
    <div>
      <div className="tablewrap">
        <table className="ctable">
          <thead>
            <tr>
              <th></th>
              {analyses.map((_, i) => (
                <th key={i}>
                  <button className="swlink num" onClick={() => onSelect(i)}>
                    #{i + 1}
                  </button>
                </th>
              ))}
              <th className="meancol">mean ± SD</th>
            </tr>
          </thead>
          <tbody>
            {table.map((r) => (
              <tr key={r.label} className={enough && r === worst && r.cv > 0.08 ? "worst" : ""}>
                <td>{r.label}</td>
                {r.vals.map((v, i) => (
                  <td key={i} className="num">
                    {v.toFixed(r.digits)}
                  </td>
                ))}
                <td className="num meancol">
                  {r.m.toFixed(r.digits)} ± {r.s.toFixed(Math.max(1, r.digits))}
                  <small> {r.unit}</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {enough ? (
        worst.cv > 0.08 ? (
          <p className="reco">
            Across {analyses.length} swings, <b>{worst.label.toLowerCase()}</b> varies the most (±
            {(worst.cv * 100).toFixed(0)}%). The research is blunt here: skill correlates with how well you repeat{" "}
            <b>your own</b> motion (r = 0.801, measured with the same 2D pose method as this app) — not with matching
            any model swing. Tightening your most variable number is the highest-evidence thing this tool can point at.
            <br />
            <br />
            在这 {analyses.length} 次挥杆里，<b>{worst.label.toLowerCase()}</b> 波动最大（±
            {(worst.cv * 100).toFixed(0)}%）。研究讲得很直白：水平高低取决于你<b>重复自己</b>动作的能力（r = 0.801，
            用的正是本应用这套二维姿态方法），而不是去贴合某个标准挥杆。把你波动最大的那个数字练稳，是这个工具能给出
            的、证据最强的建议。
          </p>
        ) : (
          <p className="reco">
            Your swings repeat tightly across all of these numbers — that repeatability is exactly what separates
            skill levels in the research (r = 0.801). The remaining variation likely lives where this camera can&apos;t
            see: club delivery and strike.
            <br />
            <br />
            你这几次挥杆在所有这些数字上都重复得很紧——这种可重复性正是研究里区分水平高低的关键（r = 0.801）。剩下的
            波动多半藏在这个镜头看不到的地方：杆头的递送和触球。
          </p>
        )
      ) : (
        <p className="note">
          Film at least 3 swings for a meaningful spread (SD) — two is just a difference. 至少拍 3 次挥杆才能算出有意义的
          离散度（标准差）——只有两次的话就只是一个差值而已。
        </p>
      )}
    </div>
  );
}
