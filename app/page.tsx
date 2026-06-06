"use client";

import { useEffect, useRef, useState } from "react";
import { analyzeSwing, PHASES, type Analysis, type PhaseName } from "@/lib/analysis";
import { createLandmarker, extractLandmarks, captureFrame } from "@/lib/pose";
import { drawPose, drawGeometry } from "@/lib/draw";

type Stage = "idle" | "model" | "processing" | "done" | "error";
type Still = { name: PhaseName; time: number; url: string };

const PHASE_LABEL: Record<PhaseName, string> = {
  address: "Address",
  top: "Top",
  impact: "Impact",
  finish: "Finish",
};

export default function Page() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const landmarkerRef = useRef<Awaited<ReturnType<typeof createLandmarker>> | null>(null);

  const [stage, setStage] = useState<Stage>("idle");
  const [pct, setPct] = useState(0);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [stills, setStills] = useState<Still[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Preview the results layout without a real video: visit the page with #demo
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === "#demo") loadDemo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadDemo() {
    const mk = (label: string) => {
      const c = document.createElement("canvas");
      c.width = 360; c.height = 640;
      const x = c.getContext("2d")!;
      const g = x.createLinearGradient(0, 0, 0, 640);
      g.addColorStop(0, "#1c2a1f"); g.addColorStop(1, "#0a0e0a");
      x.fillStyle = g; x.fillRect(0, 0, 360, 640);
      x.strokeStyle = "rgba(95,211,106,0.5)"; x.lineWidth = 3;
      x.beginPath(); x.moveTo(180, 120); x.lineTo(180, 470); x.stroke();
      x.fillStyle = "#9be8a6"; x.font = "600 18px sans-serif"; x.fillText(label + " (demo)", 18, 40);
      return c.toDataURL();
    };
    setStills(PHASES.map((n, i) => ({ name: n, time: [0.47, 1.3, 1.62, 2.2][i], url: mk(PHASE_LABEL[n]) })));
    setAnalysis({
      phases: { address: 0, top: 0, impact: 0, finish: 0 },
      times: { address: 0.47, top: 1.3, impact: 1.62, finish: 2.2 },
      metrics: { view: "down-the-line", tempoRatio: 2.7, backswingS: 0.83, downswingS: 0.31, headSwayPct: 6, headVertPct: 4, hipSwayBackPct: 9, hipSlideImpactPct: 15, spineAddrDeg: 48, spineTopDeg: 42, spineImpactDeg: 34, reverseSpineDeg: -6, secondaryTiltDeg: 14 },
      faults: [], notes: [], detectedPct: 100, fps: 30,
    });
    setStage("done");
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      setError(null);
      setAnalysis(null);
      setStills([]);
      const video = videoRef.current!;
      const url = URL.createObjectURL(file);
      video.src = url;
      video.muted = true;
      await new Promise<void>((res, rej) => {
        video.onloadedmetadata = () => res();
        video.onerror = () =>
          rej(new Error("Couldn't open this video. On iPhone: Settings → Camera → Formats → Most Compatible, then refilm."));
      });

      setStage("model");
      if (!landmarkerRef.current) landmarkerRef.current = await createLandmarker();

      setStage("processing");
      setPct(0);
      const { frames, fps } = await extractLandmarks(video, landmarkerRef.current, setPct);
      const a = analyzeSwing(frames, fps);

      const tmp = document.createElement("canvas");
      const next: Still[] = [];
      for (const name of PHASES) {
        const t = a.times[name];
        await captureFrame(video, t, tmp);
        const ctx = tmp.getContext("2d");
        const fr = frames[a.phases[name]] ?? null;
        if (ctx && fr) {
          drawPose(ctx, fr, tmp.width, tmp.height);
          drawGeometry(ctx, fr, tmp.width, tmp.height);
        }
        next.push({ name, time: t, url: tmp.toDataURL("image/jpeg", 0.85) });
      }
      URL.revokeObjectURL(url);

      setAnalysis(a);
      setStills(next);
      setStage("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage("error");
    }
  }

  const m = analysis?.metrics;

  return (
    <div className="wrap">
      <header className="app">
        <h1>Swing<span className="dot">·</span>CV</h1>
        <p>On-device golf swing analysis — your video never leaves this device.</p>
      </header>

      <video ref={videoRef} className="hidden" playsInline muted />
      <input ref={fileRef} type="file" accept="video/*" hidden onChange={onFile} />

      {(stage === "idle" || stage === "done" || stage === "error") && (
        <div className="card">
          <button className="btn" onClick={() => fileRef.current?.click()}>
            {stage === "idle" ? "🎥  Pick or film a swing" : "🎥  Analyze another swing"}
          </button>
          <p className="hint">
            Face-on or down-the-line · full body in frame · steady phone · 2–5 seconds.
          </p>
        </div>
      )}

      {error && (
        <div className="card">
          <div className="error">{error}</div>
        </div>
      )}

      {(stage === "model" || stage === "processing") && (
        <div className="card status">
          <div className="spinner" />
          {stage === "model" ? (
            <div className="label">Loading the pose model (first time only)…</div>
          ) : (
            <>
              <div className="pct">{pct}%</div>
              <div className="label">Tracking your body through the swing…</div>
              <div className="bar">
                <div style={{ width: `${pct}%` }} />
              </div>
            </>
          )}
        </div>
      )}

      {stage === "done" && analysis && m && (
        <div className="results">
          <div className="frames">
            {stills.map((s) => (
              <div className="frame" key={s.name}>
                <img src={s.url} alt={PHASE_LABEL[s.name]} />
                <span className="tag">{PHASE_LABEL[s.name]}</span>
                <span className="t">{s.time.toFixed(2)}s</span>
              </div>
            ))}
          </div>

          <div className="section-title">Reliable metrics</div>
          <div className="metrics">
            <div className="metric">
              <div className="k">Tempo</div>
              <div className="v">
                {Number.isNaN(m.tempoRatio) ? "—" : m.tempoRatio.toFixed(1)} <small>: 1 · smooth ≈ 3:1</small>
              </div>
            </div>
            <div className="metric">
              <div className="k">Camera (auto)</div>
              <div className="v" style={{ fontSize: 16 }}>{m.view}</div>
            </div>
            <div className="metric">
              <div className="k">Head sway (lateral)</div>
              <div className="v">{m.headSwayPct.toFixed(0)}<small>% of height</small></div>
            </div>
            <div className="metric">
              <div className="k">Head move (vertical)</div>
              <div className="v">{m.headVertPct.toFixed(0)}<small>% of height</small></div>
            </div>
          </div>
          <p className="note" style={{ marginTop: 10 }}>
            Backswing {m.backswingS.toFixed(2)}s · downswing {m.downswingS.toFixed(2)}s · pose tracked in {analysis.detectedPct.toFixed(0)}% of frames.
            Rough (view-sensitive): spine tilt {m.spineAddrDeg.toFixed(0)}° → {m.spineTopDeg.toFixed(0)}° → {m.spineImpactDeg.toFixed(0)}°.
          </p>

          <div className="section-title">Faults that actually cost strokes</div>
          {analysis.faults.length > 0 ? (
            analysis.faults.map((f) => (
              <div className="flag" key={f.title}>
                <div className="icon">!</div>
                <div className="body">
                  <div className="t">{f.title}</div>
                  <div className="d">→ causes {f.mishit}</div>
                  <div className="d">{f.detail}</div>
                </div>
              </div>
            ))
          ) : (
            <div className="flag good">
              <div className="icon">✓</div>
              <div className="body">
                <div className="t">None the camera can see</div>
                <div className="d">Strike-wise, the swing looks sound.</div>
              </div>
            </div>
          )}

          {analysis.notes.length > 0 && (
            <>
              <div className="section-title">Worth checking (needs a clean down-the-line clip)</div>
              {analysis.notes.map((n, i) => (
                <p className="note" key={i}>• {n}</p>
              ))}
            </>
          )}

          <div className="section-title">What to actually work on</div>
          <div className="card">
            {analysis.faults.length > 0 ? (
              <p className="reco">
                Your body is causing a destructive mishit. Priority: <b>{analysis.faults[0].title}</b>.
                Build practice that fixes the <b>strike</b>, then re-film to confirm it transferred.
              </p>
            ) : (
              <p className="reco">
                Your swing&apos;s gross positions look fine — but that&apos;s not the same as &ldquo;no leak.&rdquo;
                Where amateurs actually lose strokes (Broadie / strokes-gained): <b>~2/3 of the scoring gap is the long game</b> outside
                100 yds (approach most of all); only ~1/3 is inside 100 (short game + putting), and putting is a small
                differentiator even for amateurs. Body pose can&apos;t see strike quality or shot dispersion — the real
                diagnosis needs ball-flight / launch or on-course tracking. <b>Log a round, find your biggest leak.</b>
              </p>
            )}
          </div>

          <p className="disclaimer">
            Runs entirely on your device — nothing is uploaded. This is 2D single-camera pose: reliable for tempo,
            head stability and the key positions; spine / rotation numbers are approximate; it <b>can&apos;t diagnose a
            slice</b> (that needs club tracking or a launch monitor).
          </p>
          <p className="footer">Swing·CV · on-device pose via MediaPipe · no upload</p>
        </div>
      )}
    </div>
  );
}
