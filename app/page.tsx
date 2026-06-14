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
import { analyzeClub, type ClubAnalysis } from "@/lib/club";
import {
  SCHEMA,
  saveSwing,
  getPayload,
  getEstimate,
  requestPersist,
  encodeFramesXY,
  decodeFramesXY,
  estimatePayloadBytes,
  type SavedMeta,
  type SavedPayload,
} from "@/lib/library";
import { drawPose, drawGeometry } from "@/lib/draw";
import Player from "@/components/Player";
import ClubCard from "@/components/ClubCard";
import Library from "@/components/Library";
import ComparePanel from "@/components/ComparePanel";
import SpeedChart from "@/components/SpeedChart";
import SequenceCard from "@/components/SequenceCard";
import ConsistencyCard from "@/components/ConsistencyCard";
import ScrubHero from "@/components/ScrubHero";
import GhostHero from "@/components/GhostHero";
import Thread from "@/components/Thread";
import Reveal from "@/components/Reveal";
import CountUp from "@/components/CountUp";

function Chars({ text, from = 0 }: { text: string; from?: number }) {
  let i = from;
  return (
    <>
      {text.split(" ").map((w, wi) => (
        <span className="w" key={wi}>
          {Array.from(w).map((ch, ci) => (
            <span className="ch" style={{ "--i": i++ } as React.CSSProperties} key={ci}>
              {ch}
            </span>
          ))}{" "}
        </span>
      ))}
    </>
  );
}

type Stage = "idle" | "model" | "scanning" | "processing" | "done" | "error";
type Still = { name: PhaseName; time: number; url: string };
type SwingResult = {
  id: string;
  src: string;
  fileName: string;
  win: SwingWindow;
  extraction: Extraction;
  analysis: Analysis;
  club: ClubAnalysis | null;
  stills: Still[];
  saved?: boolean; // already in the library this session
};

type CompareData = {
  a: { analysis: Analysis; stills: Still[]; meta: SavedMeta };
  b: { analysis: Analysis; stills: Still[]; meta: SavedMeta };
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
  const [overlay, setOverlay] = useState<"none" | "library" | "compare">("none");
  const [compare, setCompare] = useState<CompareData | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(0);
  const [saving, setSaving] = useState(false);
  const persistAsked = useRef(false);

  function flash(m: string) {
    setToast(m);
    window.setTimeout(() => setToast((t) => (t === m ? null : t)), 4000);
  }

  useEffect(() => {
    const saved = Number(localStorage.getItem("swingcv-height"));
    if (saved >= 120 && saved <= 220) setHeightCmState(saved);
    if (window.location.hash === "#demo") loadDemo();
    if (window.location.hash === "#library") setOverlay("library");
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
        id: crypto.randomUUID(),
        src: "",
        fileName: "demo.mov",
        win: { start: 0, end: 3.2 },
        extraction: { frames: new Array(n).fill(null), times: t, fps, width: 360, height: 640, scrubs: [], motion: null },
        analysis,
        club: null,
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
            const extraction = await extractLandmarks(video, lm, setPct, { window: win, scrubWidth: 480, motionWidth: 160 });
            const analysis = analyzeSwing(extraction.frames, extraction.fps, extraction.times);
            if (!analysis.quality.ok) {
              skips.push(`${fmtT(win.start)} in ${file.name}: ${analysis.quality.reason}`);
              continue;
            }
            // Clubhead arc (v3.5) from the motion frames, then free that buffer.
            const club = analyzeClub(extraction.motion, extraction.frames, analysis.phases);
            extraction.motion = null;
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
            results.push({ id: crypto.randomUUID(), src: url, fileName: file.name, win, extraction, analysis, club, stills });
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

  // Persist the current analysis to the on-device library (derived data only —
  // no raw video; see lib/library.ts).
  async function handleSave(r: SwingResult) {
    if (saving || r.saved) return; // guard against a double-click double-write
    setSaving(true);
    try {
      const a = r.analysis;
      const payload: SavedPayload = {
        id: r.id,
        schema: SCHEMA,
        analysis: a,
        club: r.club,
        stills: r.stills,
        scrubs: r.extraction.scrubs,
        frames: encodeFramesXY(r.extraction.frames),
        times: r.extraction.times,
        fps: r.extraction.fps,
        width: r.extraction.width,
        height: r.extraction.height,
      };
      const impact = r.stills.find((s) => s.name === "impact")?.url ?? r.stills[0]?.url ?? "";
      const meta: SavedMeta = {
        id: r.id,
        schema: SCHEMA,
        createdAt: Date.now(),
        fileName: r.fileName,
        label: r.fileName.replace(/\.[^.]+$/, ""),
        view: a.metrics.view,
        heightCmAtSave: heightCm,
        tempoRatio: a.metrics.tempoRatio,
        backswingS: a.metrics.backswingS,
        downswingS: a.metrics.downswingS,
        peakBh: a.speed ? a.speed.peak : null,
        win: r.win,
        thumb: impact,
        hasFrames: true,
        hasScrubs: r.extraction.scrubs.length > 0,
        sizeBytes: estimatePayloadBytes(payload),
      };
      const est = await getEstimate();
      if (est && est.quota > 0 && est.usage / est.quota > 0.9)
        flash("Heads up: storage is nearly full — export or delete swings in the library.");
      await saveSwing(meta, payload);
      if (!persistAsked.current) {
        persistAsked.current = true;
        void requestPersist();
      }
      setSwings((list) => list.map((s) => (s.id === r.id ? { ...s, saved: true } : s)));
      setSavedTick((t) => t + 1);
      flash("Saved to your library (on this device). Open Library to compare.");
    } catch (e) {
      const quota = (e as { quota?: boolean })?.quota;
      flash(quota ? "Storage full — delete a swing or export some from the library." : "Couldn't save this swing.");
    } finally {
      setSaving(false);
    }
  }

  // Reopen a saved swing: rebuild the Extraction (decode the slim frames + restore
  // the scrub stills) so the full results view — including the scroll-scrub hero —
  // comes back. The raw <video> can't return (not stored), so its slot shows the
  // demobox; everything else renders from the saved derived data.
  async function handleReopen(m: SavedMeta) {
    const p = await getPayload(m.id);
    if (!p) {
      flash("This swing can't be opened (saved in an older format) — delete it from the library.");
      return;
    }
    const extraction: Extraction = {
      frames: decodeFramesXY(p.frames),
      times: p.times,
      fps: p.fps,
      width: p.width,
      height: p.height,
      scrubs: p.scrubs,
      motion: null,
    };
    const r: SwingResult = {
      id: m.id,
      src: "",
      fileName: m.fileName,
      win: m.win,
      extraction,
      analysis: p.analysis,
      club: p.club,
      stills: p.stills,
      saved: true,
    };
    setSwings([r]);
    setSel(0);
    setSkipped([]);
    setError(null);
    setStage("done");
    setOverlay("none");
    window.scrollTo({ top: 0 });
  }

  async function handleCompare(am: SavedMeta, bm: SavedMeta) {
    const [pa, pb] = await Promise.all([getPayload(am.id), getPayload(bm.id)]);
    if (!pa || !pb) {
      flash("One of these swings can't be opened — try another.");
      return;
    }
    setCompare({
      a: { analysis: pa.analysis, stills: pa.stills, meta: am },
      b: { analysis: pb.analysis, stills: pb.stills, meta: bm },
    });
    setOverlay("compare");
    window.scrollTo({ top: 0 });
  }

  const cur = swings[sel];
  const m = cur?.analysis.metrics;
  const club = cur?.club ?? null;
  // Body faults (pose) + the clubhead fault (motion), shown as one list.
  const allFaults = cur ? [...cur.analysis.faults, ...(club?.fault ? [club.fault] : [])] : [];
  const topFault = allFaults[0];
  const idle = stage === "idle" || stage === "done" || stage === "error";
  const showMain = overlay === "none";

  return (
    <div className="wrap">
      <header className="app">
        <h1>
          SWING<span className="dot">·</span>CV
        </h1>
        <svg className="arc" viewBox="0 0 220 26" aria-hidden="true">
          <path
            className="arcdraw"
            d="M6 22 Q 110 -14 214 22"
            fill="none"
            stroke="url(#arcg)"
            strokeWidth="2.5"
            strokeLinecap="round"
            pathLength={100}
          />
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
        <div className="hudrow" aria-hidden="true">
          <span className="hud">ON-DEVICE</span>
          <span className="hud">POSE · 33 PTS</span>
          <span className="hud">NO UPLOAD</span>
        </div>
        <button className="libbtn" onClick={() => setOverlay("library")} title="Your saved swings">
          📁 Library
        </button>
      </header>

      <video ref={procRef} className="hidden" playsInline muted />
      <input ref={fileRef} type="file" accept="video/*" multiple hidden onChange={onInput} />

      {toast && <div className="toast">{toast}</div>}

      {overlay === "library" && (
        <Library key={savedTick} onReopen={handleReopen} onCompare={handleCompare} onClose={() => setOverlay("none")} />
      )}
      {overlay === "compare" && compare && (
        <ComparePanel a={compare.a} b={compare.b} onClose={() => setOverlay("library")} />
      )}

      {showMain && idle && (
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

      {showMain && error && (
        <div className="card">
          <div className="error">{error}</div>
        </div>
      )}

      {showMain && stage === "idle" && (
        <div className="landing">
          <Thread />
          <Reveal>
            <h2 className="landinghead">
              <Chars text="See your swing like a" />
              <span className="hl">
                <Chars text="broadcast." from={24} />
              </span>
            </h2>
          </Reveal>
          <p className="landingsub">
            Skeleton, hand tracer, tempo, speed and sequence — extracted from a phone clip, in your browser.
          </p>

          <GhostHero />

          <div className="marquee" aria-hidden="true">
            <div className="mq">
              {[0, 1].map((k) => (
                <span key={k}>
                  ON-DEVICE ◇ NO UPLOAD ◇ TEMPO ◇ HAND SPEED ◇ KINEMATIC SEQUENCE ◇ TRACER ◇ CONSISTENCY ◇ STROKES-GAINED ◇&nbsp;
                </span>
              ))}
            </div>
          </div>

          <section className="bigstats">
            <Reveal>
              <div className="bigstat" data-th>
                <div className="bignum">~2/3</div>
                <p>
                  of the amateur scoring gap is the <b>long game</b> — approach above all. Putting separates
                  surprisingly little. This tool tells you when your swing isn&apos;t the real leak. (Broadie,
                  strokes-gained)
                </p>
              </div>
            </Reveal>
            <Reveal delay={70}>
              <div className="bigstat" data-th>
                <div className="bignum">r = 0.801</div>
                <p>
                  skill tracks how well you repeat <b>your own</b> swing — not how closely you copy a model. Measured
                  with the same 2D pose method this app uses. Film 3+ swings and it measures exactly that.
                </p>
              </div>
            </Reveal>
            <Reveal delay={140}>
              <div className="bigstat" data-th>
                <div className="bignum">0</div>
                <p>
                  uploads. The pose model runs <b>inside your browser</b> — your video never leaves the device. No
                  account, no tracking, no cloud.
                </p>
              </div>
            </Reveal>
          </section>

          <Reveal>
            <div className="section-title">What you get from one clip</div>
            <div className="featrow" data-th>
              <div className="featcard">
                <svg viewBox="0 0 120 70" aria-hidden="true">
                  <path className="minidraw" d="M14 60 C30 56 38 30 52 18 C60 11 70 12 78 22 C88 35 98 52 108 56" fill="none" stroke="#ffb056" strokeWidth="2.5" strokeLinecap="round" pathLength={100} />
                  <circle cx="52" cy="18" r="3.5" fill="#ffb056" />
                </svg>
                <div className="t">Slow-mo + tracer</div>
                <div className="d">Skeleton and hand path drawn over your video. 0.25×, frame-step, jump to impact.</div>
              </div>
              <div className="featcard">
                <svg viewBox="0 0 120 70" aria-hidden="true">
                  <path className="minidraw" d="M12 58 C36 54 48 24 62 16" fill="none" stroke="#62d6ff" strokeWidth="2.5" strokeLinecap="round" pathLength={100} />
                  <path className="minidraw d2" d="M28 60 C52 56 66 28 80 19" fill="none" stroke="#4ce17e" strokeWidth="2.5" strokeLinecap="round" pathLength={100} />
                  <path className="minidraw d3" d="M44 62 C70 58 86 32 100 22" fill="none" stroke="#ffb056" strokeWidth="2.5" strokeLinecap="round" pathLength={100} />
                </svg>
                <div className="t">Speed &amp; sequence</div>
                <div className="d">Hand-speed curve in ~mph and the pelvis → torso → hands firing order, honestly labeled.</div>
              </div>
              <div className="featcard">
                <svg viewBox="0 0 120 70" aria-hidden="true">
                  <rect x="14" y="40" width="18" height="20" rx="2" fill="rgba(76,225,126,0.55)" />
                  <rect x="40" y="30" width="18" height="30" rx="2" fill="rgba(76,225,126,0.75)" />
                  <rect x="66" y="36" width="18" height="24" rx="2" fill="rgba(76,225,126,0.65)" />
                  <rect x="92" y="14" width="18" height="46" rx="2" fill="#ffb056" />
                </svg>
                <div className="t">Consistency</div>
                <div className="d">Film several swings — or one long range video — and see which number wobbles most.</div>
              </div>
            </div>
          </Reveal>

          <Reveal>
            <blockquote className="manifesto" data-th>
              It will not invent a flaw to sound smart. It will not grade you against a &ldquo;perfect swing&rdquo; that
              doesn&apos;t exist. It cannot see your club face — <em>and it says so.</em> What it measures, it measures
              honestly.
            </blockquote>
          </Reveal>

          <Reveal>
            <div className="cta2" data-th>
              <button className="btn" onClick={() => fileRef.current?.click()}>
                🎥&ensp;Analyze your swing
              </button>
              <p className="hint">2–5 second clip · or a full range session — it finds every swing.</p>
            </div>
          </Reveal>

          <p className="footer">Swing·CV · on-device pose via MediaPipe · no upload · no account</p>
        </div>
      )}

      {showMain && (stage === "model" || stage === "scanning" || stage === "processing") && (
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

      {showMain && stage === "done" && cur && m && (
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

          <div className="savebar">
            {cur.src ? (
              <button className="chip save" onClick={() => handleSave(cur)} disabled={!!cur.saved || saving}>
                {cur.saved ? "✓ Saved to library" : saving ? "Saving…" : "💾 Save swing"}
              </button>
            ) : (
              <span className="note" style={{ margin: 0 }}>
                Reopened from your library — scroll the hero to scrub with the skeleton (the raw video isn&apos;t stored).
              </span>
            )}
            <button className="chip" onClick={() => setOverlay("library")}>
              📁 Library
            </button>
          </div>

          <ScrubHero key={cur.id} extraction={cur.extraction} analysis={cur.analysis} />

          <Reveal>
            <div className="card playercard">
              {cur.src ? (
                <Player src={cur.src} win={cur.win} extraction={cur.extraction} analysis={cur.analysis} seekSignal={seekSig} />
              ) : (
                <div className="demobox">Demo mode — load a real clip to get the slow-mo player with skeleton &amp; hand tracer.</div>
              )}
            </div>
          </Reveal>

          <Reveal delay={80}>
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
          </Reveal>

          {cur.analysis.speed && (
            <Reveal>
              <div className="section-title">Hand speed</div>
              <div className="card">
                <SpeedChart analysis={cur.analysis} heightCm={heightCm} onHeightCm={setHeightCm} />
              </div>
            </Reveal>
          )}

          {cur.analysis.sequence && (
            <Reveal>
              <div className="section-title">Kinematic sequence · experimental</div>
              <div className="card">
                <SequenceCard analysis={cur.analysis} />
              </div>
            </Reveal>
          )}

          {club && club.coveragePct > 0 && (
            <Reveal>
              <div className="section-title">Clubhead path · experimental</div>
              <div className="card">
                <ClubCard
                  club={club}
                  phases={cur.analysis.phases}
                  impactUrl={cur.stills.find((s) => s.name === "impact")?.url ?? cur.stills[0].url}
                  width={cur.extraction.width}
                  height={cur.extraction.height}
                />
              </div>
            </Reveal>
          )}

          <Reveal>
            <div className="section-title">Reliable metrics</div>
            <div className="metrics">
              <div className="metric">
                <div className="k">Tempo</div>
                <div className="v num">
                  {Number.isNaN(m.tempoRatio) ? "—" : <CountUp value={m.tempoRatio} decimals={1} />}{" "}
                  <small>: 1 · smooth ≈ 3:1</small>
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
                  <CountUp value={m.headSwayPct} />
                  <small>% of height</small>
                </div>
              </div>
              <div className="metric">
                <div className="k">Head move (vertical)</div>
                <div className="v num">
                  <CountUp value={m.headVertPct} />
                  <small>% of height</small>
                </div>
              </div>
            </div>
          </Reveal>
          <p className="note" style={{ marginTop: 10 }}>
            Backswing {m.backswingS.toFixed(2)}s · downswing {m.downswingS.toFixed(2)}s · pose tracked in{" "}
            {cur.analysis.detectedPct.toFixed(0)}% of frames. Rough (view-sensitive): spine tilt{" "}
            {m.spineAddrDeg.toFixed(0)}° → {m.spineTopDeg.toFixed(0)}° → {m.spineImpactDeg.toFixed(0)}°.
          </p>

          <Reveal>
            <div className="section-title">Faults that actually cost strokes</div>
            {allFaults.length > 0 ? (
              allFaults.map((f) => (
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
          </Reveal>

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
            <Reveal>
              <div className="section-title">
                Consistency across {swings.length} swings — the metric that actually tracks skill
              </div>
              <div className="card">
                <ConsistencyCard analyses={swings.map((s) => s.analysis)} heightCm={heightCm} onSelect={setSel} />
              </div>
            </Reveal>
          )}

          <Reveal>
          <div className="section-title">What to actually work on</div>
          <div className="card">
            {topFault ? (
              topFault.focus === "slice / swing path" ? (
                <p className="reco">
                  Priority: <b>{topFault.title}</b>. The clubhead is coming down across the ball. Groove an{" "}
                  <b>in-to-out path</b> — set a headcover (or towel) just outside the ball and miss it on the way
                  down, feeling the club drop behind you in transition. Re-film and watch the magenta downswing arc
                  move <b>inside</b> the cyan backswing.
                </p>
              ) : (
                <p className="reco">
                  Your body is causing a destructive mishit. Priority: <b>{topFault.title}</b>. Build practice that
                  fixes the <b>strike</b>, then re-film to confirm it transferred.
                </p>
              )
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
          </Reveal>

          {skipped.length > 0 && (
            <p className="note">Skipped: {skipped.join(" · ")}</p>
          )}

          <details className="cantsee">
            <summary>What this tool deliberately won&apos;t pretend to see</summary>
            <ul>
              <li>
                <b>Club face</b> — the other half of why a ball curves. The experimental clubhead tracer follows the
                head&apos;s <b>path</b> from motion and can flag an over-the-top loop, but it <b>can&apos;t see the
                face angle</b> — so it can&apos;t separate a slice from a pull. That still takes a launch monitor.
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
            stability and key positions; rotation/speed and the clubhead tracer are honest estimates; it{" "}
            <b>can&apos;t see the clubface</b>, so it flags an over-the-top path but can&apos;t separate a slice from a
            pull.
          </p>
          <p className="footer">Swing·CV · on-device pose via MediaPipe · no upload · no account</p>
        </div>
      )}
    </div>
  );
}
