"use client";

import type { Analysis } from "@/lib/analysis";
import { readPace, PACE_TEMPO_LO, PACE_TEMPO_HI } from "@/lib/pace";

// "Too fast or too slow?" — a pace verdict (from tempo, so slow-mo can't fool it)
// plus where your hand speed falls vs a typical range for your height.

const PACE: Record<string, { en: string; zh: string; cls: string } | null> = {
  quick: { en: "too quick", zh: "偏快", cls: "ok" },
  onpace: { en: "on pace", zh: "刚好", cls: "good" },
  slow: { en: "too slow", zh: "偏慢", cls: "ok" },
  na: null,
};
const SPEED: Record<string, { en: string; zh: string; cls: string } | null> = {
  low: { en: "below typical", zh: "低于常见", cls: "ok" },
  typical: { en: "typical", zh: "常见区间", cls: "good" },
  high: { en: "above typical", zh: "高于常见", cls: "good" },
  na: null,
};

export default function PaceCard({ analysis, heightCm }: { analysis: Analysis; heightCm: number }) {
  const r = readPace(analysis, heightCm);
  const pace = PACE[r.pace];
  const speed = SPEED[r.speed];

  return (
    <div>
      <div className="statrow">
        <div className="stat">
          <div className="k">Swing pace 挥杆节奏</div>
          <div className="v num">{Number.isNaN(r.tempo) ? "—" : `${r.tempo.toFixed(1)}:1`}</div>
          {pace && <span className={`grade ${pace.cls}`}>{pace.en} {pace.zh}</span>}
        </div>
        <div className="stat">
          <div className="k">Recommended 推荐区间</div>
          <div className="v num">
            {PACE_TEMPO_LO}–{PACE_TEMPO_HI}
            <small> : 1</small>
          </div>
        </div>
        <div className="stat">
          <div className="k">Whole swing 整次挥杆</div>
          <div className="v num">
            ~{r.totalSwingS.toFixed(2)}
            <small> s · rough 粗略</small>
          </div>
        </div>
      </div>

      <div className="statrow" style={{ marginTop: 10 }}>
        <div className="stat">
          <div className="k">Peak hand speed 手部峰值</div>
          <div className="v num">
            {r.peakMph != null ? `~${Math.round(r.peakMph)}` : "—"}
            <small> mph</small>
          </div>
          {speed && <span className={`grade ${speed.cls}`}>{speed.en} {speed.zh}</span>}
        </div>
        <div className="stat">
          <div className="k">Typical for your height 你身高的常见区间</div>
          <div className="v num">
            ~{Math.round(r.bandLoMph)}–{Math.round(r.bandHiMph)}
            <small> mph</small>
          </div>
        </div>
      </div>

      <p className="note">
        Pace comes from your <b>tempo ratio</b>, which holds up even on slow-mo clips — the whole-swing seconds are rough
        (slow-mo stretches them). The band is a typical hand-speed range for your height, not a target: repeating{" "}
        <b>your own</b> number matters more than hitting someone else&apos;s.
        <br />
        节奏是用你的<b>节奏比</b>判断的，慢动作视频也准——整次挥杆的秒数只是粗略值（慢动作会拉长）。速度区间是按你身高
        估的常见手速范围，不是目标：把<b>自己</b>的数字重复出来，比追别人的更重要。
      </p>
    </div>
  );
}
