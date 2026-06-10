"use client";

import { useEffect, useRef, useState } from "react";
import { analyzeSwing, PHASES, type Analysis, type PhaseName } from "@/lib/analysis";
import {
  createLandmarker,
  extractLandmarks,
  scanForSwings,
  captureFrame,
  type Extraction,
  type SwingWindow,
} from "@/lib/pose";
import { drawPose, drawGeometry } from "@/lib/draw";
import Player from "@/components/Player";
import SpeedChart from "@/components/SpeedChart";
import SequenceCard from "@/components/SequenceCard";
import ConsistencyCard from "@/components/ConsistencyCard";

type Stage = "idle" | "model" | "scanning" | "processing" | "done" | "error";
type Still = { name: PhaseName; time: number; url: string };
type SwingResult = {
  id: number;
  src: string;
  fileName: string;
  win: SwingWindow;
  extraction: Extraction;
  analysis: Analysis;
  stills: Still[];
};

const PHASE_LABEL: Record<PhaseName, string> = {
  address: "Address",
  top: "Top",
  impact: "Impact",
  finish: "Finish",
};

const fmtT = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export default function Page() {
  const procRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const landmarkerRef = useRef<Awaited<ReturnType<typeof createLandmarker>> | null>(null);
  const urlsRef = useRef<string[]>([]);

  const [stage, setStage] = useState<Stage>("idle");
  const [pct, setPct] = useState(0);
  const [busy, setBusy] = useState("");
  const [swings, setSwings] = useState<SwingResult[]>([]);
  const [sel, setSel] = useState(0);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [heightCm, setHeightCmState] = useState(175);
  const [seekSig, setSeekSig] = useState<{ t: number; n: number } | null>(null);

  useEffect(() => {
    const saved = Number(localStorage.getItem("swingcv-height"));
    if (saved >= 120 && saved <= 220) setHeightCmState(saved);
    if (window.location.hash === "#demo") loadDemo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setHeightCm(v: number) {
    setHeightCmState(v);
    try {
      localStorage.setItem("swingcv-height", String(v));
    } catch {}
  }

  function loadDemo() {
    const mk = (label: string) => {
      const c = document.createElement("canvas");
      c.width = 360;
      c.height = 640;
      const x = c.getContext("2d")!;
      const g = x.createLinearGradient(0, 0, 0, 640);
      g.addColorStop(0, "#1c2a1f");
      g.addColorStop(1, "#0a0e0a");
      x.fillStyle = g;
      x.fillRect(0, 0, 360, 640);
      x.strokeStyle = "rgba(95,211,106,0.5)";
      x.lineWidth = 3;
      x.beginPath();
      x.moveTo(180, 120);
      x.lineTo(180, 470);
      x.stroke();
      x.fillStyle = "#9be8a6";
      x.font = "600 18px sans-serif";
      x.fillText(label + " (demo)", 18, 40);
      return c.toDataURL();
    };
    const gauss = (t: number, c: number, s: number) => Math.exp(-(((t - c) / s) ** 2));
    const n = 96;
    const fps = 30;
    const t = Array.from({ length: n }, (_, i) => i / fps);
    const variants = [
      { tempo: 2.7, back: 0.83, down: 0.31, sway: 6, vert: 4, peak: 2.6 },
      { tempo: 3.1, back: 0.9, down: 0.29, sway: 9, vert: 5, peak: 2.45 },
      { tempo: 2.4, back: 0.78, down: 0.33, sway: 7, vert: 4, peak: 2.75 },
    ];
    const results: SwingResult[] = variants.map((d, k) => {
      const v = t.map((x) => d.peak * gauss(x, 1.63, 0.15) + 0.9 * gauss(x, 0.95, 0.35) + 0.4 * gauss(x, 2.0, 0.3) + 0.05);
      const analysis: Analysis = {
        phases: { address: 14, top: 39, impact: 49, finish: 66 },
        times: { address: 0.47, top: 1.3, impact: 1.63, finish: 2.2 },
        metrics: {
          view: "face-on",
          tempoRatio: d.tempo,
          backswingS: d.back,
          downswingS: d.down,
          headSwayPct: d.sway,
          headVertPct: d.vert,
          hipSwayBackPct: 9,
          hipSlideImpactPct: 15,
          spineAddrDeg: 48,
          spineTopDeg: 42,
          spineImpactDeg: 34,
          reverseSpineDeg: -6,
          secondaryTiltDeg: 14,
        },
        faults: [],
        notes: [],
        detectedPct: 100,
        fps,
        speed: { t, v, peak: d.peak + 0.05, peakT: 1.63, impact: d.peak - 0.1 },
        sequence: {
          t,
          pelvis: t.map((x) => 320 * gauss(x, 1.45, 0.16)),
          torso: t.map((x) => 470 * gauss(x, 1.53, 0.13)),
          hands: v,
          peaks: [
            { name: "pelvis", t: 1.45, msBeforeImpact: 180 },
            { name: "torso", t: 1.53, msBeforeImpact: 100 },
            { name: "hands", t: 1.61, msBeforeImpact: 20 },
          ],
          textbook: true,
        },
        xfactor: { topDeg: 42, peakDeg: 51, peakT: 1.42, stretchPct: 21 },
        quality: { ok: true },
      };
      return {
        id: k,
        src: "",
        fileName: "demo.mov",
        win: { start: 0, end: 3.2 },
        extraction: { frames: new Array(n).fill(null), times: t, fps, width: 360, height: 640 },
        analysis,
        stills: PHASES.map((nm, i) => ({ name: nm, time: [0.47, 1.3, 1.63, 2.2][i], url: mk(PHASE_LABEL[nm]) })),
      };
    });
    setSwings(results);
    setSel(0);
    setStage("done");
  }

  async function onFiles(files: File[]) {
    if (!files.length) return;
    try {
      setError(null);
      setSwings([]);
      setSkipped([]);
      setSel(0);
      for (const u of urlsRef.current) URL.revokeObjectURL(u);
      urlsRef.current = [];

      setStage("model");
      setBusy("Loading the pose model (first time only)…");
      if (!landmarkerRef.current) landmarkerRef.current = await createLandmarker();
      const lm = landmarkerRef.current;

      const video = procRef.current!;
      const results: SwingResult[] = [];
      const skips: string[] = [];

      for (const file of files) {
        if (results.length >= 10) {
          skips.push(`stopped at 10 swings — ${file.name} not analyzed`);
          break;
        }
        const url = URL.createObjectURL(file);
        urlsRef.current.push(url);
        video.src = url;
        video.muted = true;
        await new Promise<void>((res, rej) => {
          video.onloadedmetadata = () => res();
          video.onerror = () =>
            rej(new Error("Couldn't open this video. On iPhone: Settings → Camera → Formats → Most Compatible, then refilm."));
        });

        let windows: SwingWindow[];
        if (video.duration <= 8.5) {
          windows = [{ start: 0, end: video.duration }];
        } else {
          setStage("scanning");
          setPct(0);
          setBusy(`Scanning ${file.name} for swings…`);
          const scan = await scanForSwings(video, setPct);
          windows = scan.windows;
          if (scan.truncated) skips.push(`${file.name}: only the first ${Math.round(scan.scannedS / 60)} min scanned`);
          if (!windows.length) skips.push(`${file.name}: no swing-like motion found`);
        }

        for (const win of windows) {
          if (results.length >= 10) break;
          setStage("processing");
          setPct(0);
          setBusy(`Swing ${results.length + 1} — tracking your body…`);
          try {
            const extraction = await extractLandmarks(video, lm, setPct, { window: win });
            const analysis = analyzeSwing(extraction.frames, extraction.fps, extraction.times);
            if (!analysis.quality.ok) {
              skips.push(`${fmtT(win.start)} in ${file.name}: ${analysis.quality.reason}`);
              continue;
            }
            const tmp = document.createElement("canvas");
            const stills: Still[] = [];
            for (const name of PHASES) {
              const time = analysis.times[name];
              await captureFrame(video, time, tmp);
              const ctx = tmp.getContext("2d");
              const fr = extraction.frames[analysis.phases[name]] ?? null;
              if (ctx && fr) {
                drawPose(ctx, fr, tmp.width, tmp.height);
                drawGeometry(ctx, fr, tmp.width, tmp.height);
              }
              stills.push({ name, time, url: tmp.toDataURL("image/jpeg", 0.85) });
            }
            results.push({ id: results.length, src: url, fileName: file.name, win, extraction, analysis, stills });
          } catch (err) {
            skips.push(`${fmtT(win.start)} in ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }

      if (!results.length) {
        throw new Error(
          "No analyzable swing found. " +
            (skips.length ? `(${skips.join("; ")}) ` : "") +
            "Film face-on or down-the-line with your full body in frame, and leave a beat between swings."
        );
      }
      setSwings(results);
      setSkipped(skips);
      setSel(0);
      setStage("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage("error");
    }
  }

  function onInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    void onFiles(files);
  }

  const cur = swings[sel];
  const m = cur?.analysis.metrics;
  const idle = stage === "idle" || stage === "done" || stage === "error";

  return (
    <div className="wrap">
      <header className="app">
        <h1>
          SWING<span className="dot">·</span>CV
        </h1>
        <svg className="arc" viewBox="0 0 220 26" aria-hidden="true">
          <path d="M6 22 Q 110 -14 214 22" fill="none" stroke="url(#arcg)" strokeWidth="2.5" strokeLinecap="round" />
          <defs>
            <linearGradient id="arcg" x1="0" x2="1">
              <stop offset="0%" stopColor="rgba(255,176,86,0)" />
              <stop offset="55%" stopColor="#ffb056" />
              <stop offset="100%" stopColor="#4ce17e" />
            </linearGradient>
          </defs>
          <circle cx="214" cy="22" r="3" fill="#4ce17e" />
        </svg>
        <p>On-device swing lab — positions, tempo, speed &amp; sequence. Nothing uploads.</p>
      </header>

      <video ref={procRef} className="hidden" playsInline muted />
      <input ref={fileRef} type="file" accept="video/*" multiple hidden onChange={onInput} />

      {idle && (
        <div
          className={`card drop ${stage === "idle" ? "hero" : ""}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void onFiles(Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("video/")));
          }}
        >
          <div className="btn">🎥&ensp;{stage === "idle" ? "Pick or film a swing" : "Analyze more swings"}</div>
          <p className="hint">
            Face-on or down-the-line · full body in frame · steady phone.
            <br />
            <b>Several clips or one long range video both work</b> — each swing is found and analyzed separately.
          </p>
        </div>
      )}

      {error && (
        <div className="card">
          <div className="error">{error}</div>
        </div>
      )}

      {(stage === "model" || stage === "scanning" || stage === "processing") && (
        <div className="card status">
          <div className="spinner" />
          {stage !== "model" && <div className="pct num">{pct}%</div>}
          <div className="label">{busy}</div>
          {stage !== "model" && (
            <div className="bar">
              <div style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
      )}

      {stage === "done" && cur && m && (
        <div className="results">
          {swings.length > 1 && (
            <div className="swchips">
              {swings.map((s, i) => (
                <button key={s.id} className={i === sel ? "chip on" : "chip"} onClick={() => setSel(i)}>
                  <span className="num">#{i + 1}</span> · {fmtT(s.win.start)}
                </button>
              ))}
            </div>
          )}

          <div className="card playercard">
            {cur.src ? (
              <Player src={cur.src} win={cur.win} extraction={cur.extraction} analysis={cur.analysis} seekSignal={seekSig} />
            ) : (
              <div className="demobox">Demo mode — load a real clip to get the slow-mo player with skeleton &amp; hand tracer.</div>
            )}
          </div>

          <div className="frames">
            {cur.stills.map((s) => (
              <button
                className="frame"
                key={s.name}
                onClick={() => setSeekSig((p) => ({ t: s.time, n: (p?.n ?? 0) + 1 }))}
                title="jump the player here"
              >
                <img src={s.url} alt={PHASE_LABEL[s.name]} />
                <span className="tag">{PHASE_LABEL[s.name]}</span>
                <span className="t num">{s.time.toFixed(2)}s</span>
              </button>
            ))}
          </div>

          {cur.analysis.speed && (
            <>
              <div className="section-title">Hand speed</div>
              <div className="card">
                <SpeedChart analysis={cur.analysis} heightCm={heightCm} onHeightCm={setHeightCm} />
              </div>
            </>
          )}

          {cur.analysis.sequence && (
            <>
              <div className="section-title">Kinematic sequence · experimental</div>
              <div className="card">
                <SequenceCard analysis={cur.analysis} />
              </div>
            </>
          )}

          <div className="section-title">Reliable metrics</div>
          <div className="metrics">
            <div className="metric">
              <div className="k">Tempo</div>
              <div className="v num">
                {Number.isNaN(m.tempoRatio) ? "—" : m.tempoRatio.toFixed(1)} <small>: 1 · smooth ≈ 3:1</small>
              </div>
            </div>
            <div className="metric">
              <div className="k">Camera (auto)</div>
              <div className="v" style={{ fontSize: 16 }}>
                {m.view}
              </div>
            </div>
            <div className="metric">
              <div className="k">Head sway (lateral)</div>
              <div className="v num">
                {m.headSwayPct.toFixed(0)}
                <small>% of height</small>
              </div>
            </div>
            <div className="metric">
              <div className="k">Head move (vertical)</div>
              <div className="v num">
                {m.headVertPct.toFixed(0)}
                <small>% of height</small>
              </div>
            </div>
          </div>
          <p className="note" style={{ marginTop: 10 }}>
            Backswing {m.backswingS.toFixed(2)}s · downswing {m.downswingS.toFixed(2)}s · pose tracked in{" "}
            {cur.analysis.detectedPct.toFixed(0)}% of frames. Rough (view-sensitive): spine tilt{" "}
            {m.spineAddrDeg.toFixed(0)}° → {m.spineTopDeg.toFixed(0)}° → {m.spineImpactDeg.toFixed(0)}°.
          </p>

          <div className="section-title">Faults that actually cost strokes</div>
          {cur.analysis.faults.length > 0 ? (
            cur.analysis.faults.map((f) => (
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

          {cur.analysis.notes.length > 0 && (
            <>
              <div className="section-title">Worth checking (needs a clean down-the-line clip)</div>
              {cur.analysis.notes.map((n, i) => (
                <p className="note" key={i}>
                  • {n}
                </p>
              ))}
            </>
          )}

          {swings.length > 1 && (
            <>
              <div className="section-title">
                Consistency across {swings.length} swings — the metric that actually tracks skill
              </div>
              <div className="card">
                <ConsistencyCard analyses={swings.map((s) => s.analysis)} heightCm={heightCm} onSelect={setSel} />
              </div>
            </>
          )}

          <div className="section-title">What to actually work on</div>
          <div className="card">
            {cur.analysis.faults.length > 0 ? (
              <p className="reco">
                Your body is causing a destructive mishit. Priority: <b>{cur.analysis.faults[0].title}</b>. Build
                practice that fixes the <b>strike</b>, then re-film to confirm it transferred.
              </p>
            ) : (
              <p className="reco">
                Your swing&apos;s gross positions look fine — but that&apos;s not the same as &ldquo;no leak.&rdquo;
                Where amateurs actually lose strokes (Broadie / strokes-gained): <b>~2/3 of the scoring gap is the long
                game</b> outside 100 yds (approach most of all); only ~1/3 is inside 100, and putting is a small
                differentiator even for amateurs. Body pose can&apos;t see strike quality or dispersion — the real
                diagnosis needs ball-flight or on-course tracking. <b>Log a round, find your biggest leak.</b>
              </p>
            )}
          </div>

          {skipped.length > 0 && (
            <p className="note">Skipped: {skipped.join(" · ")}</p>
          )}

          <details className="cantsee">
            <summary>What this tool deliberately won&apos;t pretend to see</summary>
            <ul>
              <li>
                <b>Club face &amp; club path</b> — the cause of a slice/hook. One camera tracking your body can&apos;t
                measure them; that takes club tracking or a launch monitor.
              </li>
              <li>
                <b>True 3D angles</b> — depth here is a single-camera estimate. Rotation numbers are trends, not
                protractor readings.
              </li>
              <li>
                <b>Strike location &amp; ball flight</b> — the five impact factors that actually determine where the
                ball goes live on the club face, not in your joints.
              </li>
            </ul>
            <p>
              What 2D pose <b>is</b> validated for: key positions, tempo, head/hip motion, and — best of all —{" "}
              <b>how repeatable your own swing is</b> (the r = 0.801 finding used exactly this method). That&apos;s why
              the consistency panel exists.
            </p>
          </details>

          <p className="disclaimer">
            Runs entirely on your device — nothing is uploaded. 2D single-camera pose: reliable for tempo, head
            stability and key positions; rotation/speed numbers are honest estimates; it <b>can&apos;t diagnose a
            slice</b>.
          </p>
          <p className="footer">Swing·CV · on-device pose via MediaPipe · no upload · no account</p>
        </div>
      )}
    </div>
  );
}
