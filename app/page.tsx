"use client";

import { useEffect, useRef, useState } from "react";
import { analyzeSwing, PHASES, type Analysis, type PhaseName } from "@/lib/analysis";
import {
  createLandmarker,
  extractLandmarks,
  scanForSwings,
  chunkWindows,
  motionVaried,
  captureFrame,
  type Extraction,
  type SwingWindow,
} from "@/lib/pose";
import { analyzeClub, type ClubAnalysis } from "@/lib/club";
import { readMetrics, type Grade } from "@/lib/grade";
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

function GradeBadge({ g, rough }: { g: Grade | null; rough?: boolean }) {
  if (!g) return null;
  return (
    <span className={`grade ${g.level}`}>
      {g.en} {g.zh}
      {rough ? " · rough 粗略" : ""}
    </span>
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
      setPct(0);
      setBusy("Downloading the pose model — first time only (~10 MB), instant after.");
      if (!landmarkerRef.current) landmarkerRef.current = await createLandmarker(setPct);
      const lm = landmarkerRef.current;

      const video = procRef.current!;
      const results: SwingResult[] = [];
      const skips: string[] = [];
      const decodeFailedFiles: string[] = []; // files whose frames never decoded (likely HEVC)

      for (const file of files) {
        if (results.length >= 10) {
          skips.push(`stopped at 10 swings — ${file.name} not analyzed`);
          break;
        }
        // Per-file decode/coverage tracking: a clip is only flagged as a dead decode
        // if we never saw a trackable human AND the frames never changed — that tells
        // an HEVC/codec failure apart from a clip that decoded fine but had no swing.
        let fileHadPose = false;
        let fileHadMotion = false;
        let fileProduced = false;
        const acceptedImpacts: number[] = []; // absolute impact times kept (fallback de-dupe)
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
        // Short clips skip the cheap scanner entirely and go straight to the reliable
        // pose pass (11s ≈ 20fps at the 220-frame budget — plenty for tempo/phases).
        let fallbackMode = false;
        if (video.duration <= 11) {
          windows = [{ start: 0, end: video.duration }];
        } else {
          setStage("scanning");
          setPct(0);
          setBusy(`Scanning ${file.name} for swings…`);
          const scan = await scanForSwings(video, setPct);
          windows = scan.windows;
          fallbackMode = scan.fellBack;
          // Safety net: a long clip is NEVER rejected just because the cheap motion
          // pre-filter found nothing. scanForSwings already degrades to whole-clip
          // chunks, but guard here too so this path can't regress if that contract
          // changes — the dense pose pass + swingQuality (lib/analysis.ts) gate out
          // non-swings, so coarse fallback windows can't surface a false swing.
          if (!windows.length) {
            windows = chunkWindows(video.duration);
            fallbackMode = true;
          }
          if (scan.truncated) skips.push(`${file.name}: only the first ${Math.round(scan.scannedS / 60)} min scanned`);
          if (fallbackMode)
            skips.push(
              `${file.name}: motion scan inconclusive — deep-checking the clip` +
                (video.duration > 54 ? " (first ~54s)" : "")
            );
        }

        for (const win of windows) {
          if (results.length >= 10) break;
          setStage("processing");
          setPct(0);
          setBusy(`Swing ${results.length + 1} — tracking your body…`);
          try {
            const extraction = await extractLandmarks(video, lm, setPct, { window: win, scrubWidth: 480, motionWidth: 160 });
            if (extraction.frames.some(Boolean)) fileHadPose = true;
            if (motionVaried(extraction.motion)) fileHadMotion = true;
            const analysis = analyzeSwing(extraction.frames, extraction.fps, extraction.times);
            if (!analysis.quality.ok) {
              skips.push(`${fmtT(win.start)} in ${file.name}: ${analysis.quality.reason}`);
              continue;
            }
            // In fallback mode the windows are overlapping whole-clip chunks, so one
            // real swing can surface from two adjacent chunks — drop the duplicate by
            // impact-time proximity, but KEEP genuinely distinct swings (a multi-swing
            // range session must not collapse to one). Real scans (fellBack=false) keep
            // every window untouched.
            if (fallbackMode && acceptedImpacts.some((t) => Math.abs(t - analysis.times.impact) < 1.5)) {
              extraction.motion = null;
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
            acceptedImpacts.push(analysis.times.impact);
            fileProduced = true;
          } catch (err) {
            skips.push(`${fmtT(win.start)} in ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        // No swing AND we never saw a human or any frame-to-frame change ⇒ the browser
        // didn't actually decode this clip (e.g. HEVC). Flag it so the user gets the
        // codec fix, not a misleading "no swing found". (Covers short clips too, which
        // skip the scanner.) A clip with a visible person standing still has poses, so
        // it won't be mislabelled here.
        if (!fileProduced && !fileHadPose && !fileHadMotion) decodeFailedFiles.push(file.name);
      }

      if (!results.length) {
        if (decodeFailedFiles.length) {
          const which = decodeFailedFiles.length === 1 ? decodeFailedFiles[0] : `${decodeFailedFiles.length} clips`;
          throw new Error(
            `This didn't decode in your browser (${which} — the frames came through blank). ` +
              "On iPhone: Settings → Camera → Formats → Most Compatible, then refilm — " +
              "or convert the clip to H.264/MP4 and try again."
          );
        }
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
  // A window that only squeaked past the loosened quality gate — hedge the read and
  // drop the prescriptive drills/plan so a marginal track can't pose as a confident diagnosis.
  const lowConf = cur?.analysis.quality.confidence === "low";
  // Good/okay/needs-work ratings + a data-driven suggestive read of the metrics.
  const mread = m ? readMetrics(m, cur.analysis.speed) : null;
  const idle = stage === "idle" || stage === "done" || stage === "error";
  const showMain = overlay === "none";

  return (
    <div className="wrap">
      <header className="app">
        <h1>
          TRACK<span className="dot">·</span>Y
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

      <video ref={procRef} className="procvid" playsInline muted preload="auto" />
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
          {stage === "idle" && (
            <button
              className="chip"
              style={{ marginTop: 4 }}
              onClick={(e) => {
                e.stopPropagation();
                loadDemo();
              }}
            >
              ▶ See a demo first 先看个示例
            </button>
          )}
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

          <p className="footer">Tracky · on-device pose via MediaPipe · no upload · no account</p>
        </div>
      )}

      {showMain && (stage === "model" || stage === "scanning" || stage === "processing") && (
        <div className="card status">
          <div className="spinner" />
          {pct > 0 && <div className="pct num">{pct}%</div>}
          <div className="label">{busy}</div>
          {pct > 0 && (
            <div className="bar">
              <div style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
      )}

      {showMain && stage === "done" && cur && m && (
        <div className="results">
          {lowConf && (
            <div
              className="card"
              style={{ borderColor: "rgba(255,176,86,0.5)", background: "rgba(255,176,86,0.06)" }}
            >
              <div className="label" style={{ color: "#ffb056" }}>
                ⚠ Low-confidence track · 低可信度
              </div>
              <p className="note" style={{ margin: "6px 0 0" }}>
                The camera didn&apos;t get a clean enough swing to be sure — tracking was patchy or the hand path was
                faint. Treat the numbers below as rough, and re-film with your <b>full body in frame</b>, a steady
                phone, face-on or down-the-line for a real read. (Drills are held back until the read is clean.)
                <br />
                镜头没拍到足够干净的挥杆，无法确定——可能是追踪不稳，或手部轨迹太弱。下面的数字请当作粗略参考，
                建议<b>全身入镜</b>、手机稳定、正面或后方视角重拍一次，才能得到可靠结果。（读数干净前，先不给具体练习。）
              </p>
            </div>
          )}
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
              <div className="section-title">Hand speed 手部速度</div>
              <div className="card">
                <SpeedChart analysis={cur.analysis} heightCm={heightCm} onHeightCm={setHeightCm} />
              </div>
            </Reveal>
          )}

          {cur.analysis.sequence && (
            <Reveal>
              <div className="section-title">Kinematic sequence 动力链顺序 · experimental</div>
              <div className="card">
                <SequenceCard analysis={cur.analysis} />
              </div>
            </Reveal>
          )}

          {club && club.coveragePct > 0 && (
            <Reveal>
              <div className="section-title">Clubhead path 杆头轨迹 · experimental</div>
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
            <div className="section-title">Reliable metrics 可靠的数据</div>
            {mread && (
              <p className="note" style={{ marginTop: -2 }}>
                {mread.leadEn}
                <br />
                {mread.leadZh}
              </p>
            )}
            <div className="metrics">
              <div className="metric">
                <div className="k">Tempo 节奏</div>
                <div className="v num">
                  {Number.isNaN(m.tempoRatio) ? "—" : <CountUp value={m.tempoRatio} decimals={1} />}{" "}
                  <small>: 1 · smooth ≈ 3:1（流畅约 3:1）</small>
                </div>
                <GradeBadge g={mread?.tempo ?? null} />
              </div>
              <div className="metric">
                <div className="k">Camera (auto) 拍摄视角</div>
                <div className="v" style={{ fontSize: 16 }}>
                  {m.view}
                </div>
              </div>
              <div className="metric">
                <div className="k">Head sway (lateral) 头部横向晃动</div>
                <div className="v num">
                  <CountUp value={m.headSwayPct} />
                  <small>% of height（占身高）</small>
                </div>
                <GradeBadge g={mread?.sway ?? null} />
              </div>
              <div className="metric">
                <div className="k">Head move (vertical) 头部上下移动</div>
                <div className="v num">
                  <CountUp value={m.headVertPct} />
                  <small>% of height（占身高）</small>
                </div>
                <GradeBadge g={mread?.vert ?? null} />
              </div>
            </div>
          </Reveal>
          <p className="note" style={{ marginTop: 10 }}>
            Backswing {m.backswingS.toFixed(2)}s · downswing {m.downswingS.toFixed(2)}s · pose tracked in{" "}
            {cur.analysis.detectedPct.toFixed(0)}% of frames. Rough (view-sensitive): spine tilt{" "}
            {m.spineAddrDeg.toFixed(0)}° → {m.spineTopDeg.toFixed(0)}° → {m.spineImpactDeg.toFixed(0)}°.
            <br />
            上杆 {m.backswingS.toFixed(2)}s · 下杆 {m.downswingS.toFixed(2)}s · 在 {cur.analysis.detectedPct.toFixed(0)}%
            的帧里追踪到了身体。脊柱角度（受视角影响，仅供参考）：{m.spineAddrDeg.toFixed(0)}° →{" "}
            {m.spineTopDeg.toFixed(0)}° → {m.spineImpactDeg.toFixed(0)}°。
          </p>

          <Reveal>
            <div className="section-title">Faults that actually cost strokes 真正让你丢杆的问题</div>
            {allFaults.length > 0 ? (
              <>
                <p className="note" style={{ marginTop: -2 }}>
                  Filtered to <b>destructive mishits</b>, not cosmetic positions — amateurs lose strokes to bad contact,
                  not to an unpretty backswing. 只筛<b>破坏性失误</b>，不挑姿势好不好看——业余丢杆是因为触球差，不是因为
                  上杆不漂亮。
                </p>
                {allFaults.map((f) => (
                <div className="flag" key={f.title}>
                  <div className="icon">!</div>
                  <div className="body">
                    <div className="t">{f.title}</div>
                    <div className="d">→ {f.mishit}</div>
                    <div className="d">{f.detail}</div>
                    {f.fix && !lowConf && (
                      <div className="d" style={{ marginTop: 6 }}>
                        <b style={{ color: "#5fd36a" }}>Try this · 这样练：</b> {f.fix}
                      </div>
                    )}
                  </div>
                </div>
                ))}
              </>
            ) : (
              <div className="flag good">
                <div className="icon">✓</div>
                <div className="body">
                  <div className="t">None the camera can see 镜头能看到的问题：没有</div>
                  <div className="d">Strike-wise, the swing looks sound. 就触球而言，这个挥杆看起来很扎实。</div>
                </div>
              </div>
            )}
          </Reveal>

          {cur.analysis.notes.length > 0 && (
            <>
              <div className="section-title">Worth checking 值得留意（需要一段清晰的后方视角 DTL）</div>
              {cur.analysis.notes.map((n, i) => (
                <p className="note" key={i}>
                  • {n}
                </p>
              ))}
            </>
          )}

          {swings.length > 1 &&
            (() => {
              // Only clean (non-low-confidence) swings anchor the r=0.801 skill verdict —
              // folding a shaky read into the mean/SD would contradict the hedge banner.
              const reliable = swings.map((s, i) => ({ a: s.analysis, i })).filter((x) => x.a.quality.confidence !== "low");
              const excluded = swings.length - reliable.length;
              return (
                <Reveal>
                  <div className="section-title">
                    Consistency across {reliable.length} swings 这 {reliable.length} 次挥杆的稳定性 — the metric that
                    actually tracks skill（最能反映水平的指标）
                  </div>
                  <div className="card">
                    {reliable.length > 1 ? (
                      <>
                        <ConsistencyCard
                          analyses={reliable.map((x) => x.a)}
                          heightCm={heightCm}
                          onSelect={(j) => setSel(reliable[j].i)}
                        />
                        {excluded > 0 && (
                          <p className="note">
                            {excluded} low-confidence swing{excluded > 1 ? "s" : ""} left out of this spread. 已排除{" "}
                            {excluded} 个低可信度挥杆。
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="note">
                        Not enough clean swings yet — film 3+ good clips (full body, steady) for a meaningful
                        consistency read. 干净的挥杆还不够——再拍 3 个以上清晰的（全身、稳定）才能算出有意义的稳定性。
                      </p>
                    )}
                  </div>
                </Reveal>
              );
            })()}

          <Reveal>
          <div className="section-title">What to actually work on 接下来该练什么</div>
          <div className="card">
            {lowConf ? (
              <p className="reco">
                Re-film first. This track wasn&apos;t clean enough to prescribe practice against — a plan built on a
                shaky read just wastes range time. Get one good clip (full body, steady, face-on or down-the-line) and
                the drills come back automatically.
                <br />
                <br />
                先重拍。这段追踪还不够干净，不足以据此安排练习——基于不可靠读数的计划只会浪费练习场时间。先拍一段干净的
                （全身入镜、稳定、正面或后方视角），具体练习就会自动回来。
              </p>
            ) : topFault ? (
              <div className="reco">
                <b>Your one priority: {topFault.title}.</b> One focus per session — spreading thin is the #1 reason
                range time never shows up on the course. Your drill is in the card above; here&apos;s the ~20-minute
                block that makes it <em>stick</em>:
                <br />
                <br />
                • <b>Groove it — blocked, ~10 balls.</b> Same club, slow, until the new feel runs by itself. (Blocked
                reps ingrain a feel fast — but stop there; they flatter you and fade.)
                <br />
                • <b>Make it stick — random, ~15 balls.</b> Keep the feel, but change club and target <em>every
                ball</em>. It feels messier — that&apos;s the point: random practice is what survives the first tee.
                <br />
                • <b>Pressure test.</b> One target, one rule (e.g. 10 balls — count the clean strikes, or how many start
                on line). Write the number down; that&apos;s your session score to beat next time.
                <br />
                • <b>Re-check.</b> Re-film one swing. The win is your flagged number dropping and contact firming up —
                <em>not</em> a prettier-looking position (skill is repeating <b>your</b> motion, r = 0.801, not copying
                a model).
                <br />
                <br />
                <b>你的唯一重点：{topFault.title}。</b>一次只练一个——练得太散，是练习场的功夫上不了球场的头号原因。具体
                动作在上面的卡片里；下面这个约 20 分钟的流程能让它<em>真正留住</em>：
                <br />
                • <b>打进去——分块，约 10 球。</b>同一支杆、放慢，直到新感觉能自动出来。（分块练习上手快——但到此为止，它
                会让你自我感觉良好、然后很快消退。）
                <br />
                • <b>让它留住——随机，约 15 球。</b>保持感觉，但<em>每一球</em>都换杆、换目标。会觉得更乱——这正是关键：
                随机练习才扛得住第一洞的紧张。
                <br />
                • <b>压力测试。</b>一个目标、一条规则（比如 10 球，数干净触球数、或有几球起飞方向对）。把数字记下来，就是
                你下次要超越的成绩。
                <br />
                • <b>复查。</b>重拍一个挥杆。进步是你被标记的那个数字下降、触球变扎实——<em>不是</em>某个更好看的姿势
                （水平是重复<b>你自己</b>的动作，r = 0.801，不是去贴模板）。
              </div>
            ) : (
              <div className="reco">
                <b>No destructive fault the camera can see</b> — but this isn&apos;t a generic verdict. {mread?.focusEn}
                <br />
                <br />
                <b>Two moves either way:</b>
                <br />
                • <b>Now, in this tool.</b> Film <b>3+ swings</b> and let the consistency panel surface your wobbliest
                number — then tighten <em>that</em> one with random practice and re-film. Repeating your own motion
                (r = 0.801) is the honest skill marker, not matching a model.
                <br />
                • <b>This week, on the course.</b> Log a round — <b>~2/3 of the amateur gap is the long game</b> outside
                100 yds, <b>approach above all</b> — the highest-leverage place to spend practice — and it lives in
                strike quality and dispersion this camera can&apos;t see. Find your biggest <em>on-course</em> leak,
                then build a focused, science-based practice session around it — aimed at where the strokes actually
                go, not where it&apos;s fun to bash balls.
                <br />
                <br />
                <b>镜头看不到任何破坏性失误</b>——但这不是一句套话。{mread?.focusZh}
                <br />
                <br />
                <b>无论如何，两个动作：</b>
                <br />
                • <b>现在，在这个工具里。</b>拍 <b>3 次以上挥杆</b>，让稳定性面板找出你波动最大的那个数字——然后用随机练习
                把<em>那一个</em>练稳，再重拍。重复你自己的动作（r = 0.801）才是诚实的水平标尺，而不是贴模板。
                <br />
                • <b>这周，在球场上。</b>记录一轮——<b>业余约 2/3 的差距来自 100 码外的长杆</b>，<b>尤其是进攻杆</b>
                ——练习回报最高的地方——而它藏在这个镜头看不到的触球质量和落点离散度里。找出你<em>下场时</em>最大的
                漏洞，再围绕它安排一节有针对性、讲科学的练习——瞄准真正丢杆的地方，而不是哪儿打着爽就练哪儿。
              </div>
            )}
          </div>
          </Reveal>

          {skipped.length > 0 && (
            <p className="note">Skipped: {skipped.join(" · ")}</p>
          )}

          <details className="cantsee">
            <summary>What this tool deliberately won&apos;t pretend to see 这个工具刻意不假装能看到的东西</summary>
            <ul>
              <li>
                <b>Club face 杆面</b> — the other half of why a ball curves. The experimental clubhead tracer follows
                the head&apos;s <b>path</b> from motion and can flag an over-the-top loop, but it <b>can&apos;t see the
                face angle</b> — so it can&apos;t separate a slice from a pull. That still takes a launch monitor.
                <br />
                杆面是球弯曲的另一半原因。实验性的杆头追踪只能从运动里看<b>轨迹</b>、标记过顶动作，但<b>看不到杆面角度
                </b>，所以分不清右曲（slice）和拉球（pull）——这仍然需要弹道测量仪。
              </li>
              <li>
                <b>True 3D angles 真正的三维角度</b> — depth here is a single-camera estimate. Rotation numbers are
                trends, not protractor readings.
                <br />
                这里的深度是单摄像头估算，旋转数字只是趋势，不是量角器读数。
              </li>
              <li>
                <b>Strike location &amp; ball flight 触球位置与球路</b> — the five impact factors that actually
                determine where the ball goes live on the club face, not in your joints.
                <br />
                真正决定球往哪走的五个触球要素发生在杆面上，不在你的关节里。
              </li>
            </ul>
            <p>
              What 2D pose <b>is</b> validated for: key positions, tempo, head/hip motion, and — best of all —{" "}
              <b>how repeatable your own swing is</b> (the r = 0.801 finding used exactly this method). That&apos;s why
              the consistency panel exists.
              <br />
              二维姿态<b>真正</b>被验证有效的部分：关键位置、节奏、头/髋的移动，以及最重要的——<b>你自己挥杆的可重复性
              </b>（r = 0.801 的研究用的正是这套方法）。这也是稳定性面板存在的原因。
            </p>
          </details>

          <p className="disclaimer">
            Runs entirely on your device — nothing is uploaded. 2D single-camera pose: reliable for tempo, head
            stability and key positions; rotation/speed and the clubhead tracer are honest estimates; it{" "}
            <b>can&apos;t see the clubface</b>, so it flags an over-the-top path but can&apos;t separate a slice from a
            pull.
            <br />
            全程在你的设备上运行，不上传任何东西。二维单摄像头姿态：节奏、头部稳定性和关键位置可靠；旋转/速度和杆头
            追踪是诚实的估算；它<b>看不到杆面</b>，所以能标记过顶轨迹，但无法区分右曲和拉球。
          </p>
          <p className="footer">Tracky · on-device pose via MediaPipe · no upload · no account</p>
        </div>
      )}
    </div>
  );
}
