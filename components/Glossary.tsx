"use client";

// A quiet, collapsed-by-default glossary so the jargon the analysis uses
// ("kinematic sequence", "X-factor", "over-the-top") is one tap from a plain
// bilingual definition — closing the onboarding gap without cluttering the read.

const TERMS: { en: string; zh: string; defEn: string; defZh: string }[] = [
  {
    en: "Tempo",
    zh: "节奏",
    defEn: "The ratio of backswing time to downswing time. Tour players sit near 3:1 almost regardless of how fast they swing — it's rhythm, not speed.",
    defZh: "上杆时间与下杆时间之比。无论挥速快慢，巡回赛球手几乎都在 3:1 附近——讲的是节奏，不是速度。",
  },
  {
    en: "Head sway / lift",
    zh: "头部晃动 / 起伏",
    defEn: "How much your head drifts sideways or up-and-down, as a % of body height. Your head is the centre of the swing's radius, so when it moves the low point moves — that's fat/thin contact.",
    defZh: "头部左右漂移或上下起伏的幅度，以占身高的百分比表示。头是挥杆半径的圆心，它一动，最低点就跟着动——也就是打肥/打薄。",
  },
  {
    en: "Kinematic sequence",
    zh: "动力链顺序",
    defEn: "The order the body fires in the downswing — pelvis, then torso, then hands. That sequence is how the clubhead nearly doubles its speed at the bottom.",
    defZh: "下杆时身体的发力顺序——先骨盆、再躯干、最后手。正是这个顺序让杆头在触球处速度几乎翻倍。",
  },
  {
    en: "X-factor",
    zh: "X 因子",
    defEn: "The separation between your shoulders and hips at the top. The stretch into the downswing (not the static number) is what the research ties to power.",
    defZh: "上杆顶点时肩与髋之间的扭转差。研究中与力量相关的是下杆瞬间的「拉伸」，而非静态的角度数字。",
  },
  {
    en: "Over-the-top",
    zh: "出杆过顶",
    defEn: "When the club starts down outside the ball and cuts across it (out-to-in). It's the engine behind the slice — though one camera can't read your clubface, only the path.",
    defZh: "下杆时杆头从球的外侧落下、再横切过球（外到内）。这是右曲球的根源——不过单摄像头只能读路径，读不到杆面。",
  },
  {
    en: "Hand speed (not club speed)",
    zh: "手部速度（不是杆头速度）",
    defEn: "We track your hands, not the clubhead, so the mph is an estimate of hand speed from body height — useful as a trend to repeat, not a launch-monitor number.",
    defZh: "我们追踪的是手，不是杆头，所以 mph 是用身高估算的手部速度——适合当作可重复的趋势看，而不是测速仪的精确读数。",
  },
  {
    en: "Repeatability",
    zh: "可重复性",
    defEn: "How tightly your numbers cluster swing-to-swing. Research ties consistency to lower scores more than any single position — so a tighter spread is the real win.",
    defZh: "你的各项数字在多次挥杆之间有多集中。研究表明一致性比任何单一姿势更能降低杆数——所以波动越小才是真正的进步。",
  },
];

export default function Glossary() {
  return (
    <details className="glossary">
      <summary>What do these terms mean? 这些术语是什么意思？</summary>
      <dl>
        {TERMS.map((t) => (
          <div className="gterm" key={t.en}>
            <dt>
              {t.en} <span className="zh">{t.zh}</span>
            </dt>
            <dd>
              {t.defEn}
              <br />
              <span className="zh">{t.defZh}</span>
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
