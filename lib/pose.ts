// MediaPipe Pose Landmarker (web/WASM) loader + frame extraction + long-video scanning.
// Everything runs client-side in the browser; the video never leaves the device.
import { NOSE, L_HIP, R_HIP, L_ANK, R_ANK, type Frame, type LM } from "./analysis";

// Loaded dynamically so it never runs during SSR.
type Landmarker = {
  detectForVideo: (video: HTMLVideoElement, ts: number) => { landmarks: LM[][] };
  close: () => void;
};

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10/wasm";
const MODEL_FULL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task";
// ~3MB vs ~10MB, and 2-3x faster per-frame inference — used on phones, where both the
// download and the pose pass are the bottleneck. Desktop keeps the more accurate full model.
const MODEL_LITE =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";
const MODEL_CACHE = "tracky-model-v1";
const MODEL_BYTES_EST = 6_000_000; // only used if Content-Length is missing (lite ~5.8MB)

function onMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)) // iPadOS reports as Mac
  );
}

// Fetch the model, CACHE-FIRST. The Cache API persists across sessions far more reliably
// than the HTTP cache on iOS, so the ~10MB (or ~3MB lite) model downloads ONCE ever instead
// of on every cold visit. Streaming % progress on the first download (a bare 0% spinner is
// indistinguishable from the "stuck at 0%" hang users came to escape).
async function fetchModel(url: string, onProgress?: (p: number) => void): Promise<Uint8Array | null> {
  try {
    if (typeof caches !== "undefined") {
      const cache = await caches.open(MODEL_CACHE);
      const hit = await cache.match(url);
      if (hit) {
        onProgress?.(100);
        return new Uint8Array(await hit.arrayBuffer());
      }
    }
  } catch {
    /* cache unavailable (private mode etc.) — just fetch */
  }
  try {
    const resp = await fetch(url);
    if (!resp.ok || !resp.body) return null;
    const total = Number(resp.headers.get("content-length")) || 0;
    const reader = resp.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      onProgress?.(
        total > 0
          ? Math.min(99, Math.round((loaded / total) * 100))
          : Math.min(95, Math.round((loaded / MODEL_BYTES_EST) * 100))
      );
    }
    const buf = new Uint8Array(loaded);
    let off = 0;
    for (const c of chunks) {
      buf.set(c, off);
      off += c.length;
    }
    onProgress?.(100);
    try {
      if (typeof caches !== "undefined") {
        const cache = await caches.open(MODEL_CACHE);
        await cache.put(
          url,
          new Response(buf, { headers: { "Content-Type": "application/octet-stream", "Content-Length": String(buf.length) } })
        );
      }
    } catch {
      /* couldn't persist — fine, just slower next time */
    }
    return buf;
  } catch {
    return null; // network/CORS failure — caller falls back to MediaPipe's own URL load
  }
}

// numPoses: 2 so a single background person on a busy range doesn't crowd out the golfer
// (pickGolfer() below selects the right body). Lite model on phones (faster download + pass);
// only the fetch is fallible — createFromOptions runs once so a GPU/init failure propagates.
export async function createLandmarker(onProgress?: (pct: number) => void): Promise<Landmarker> {
  const vision = await import("@mediapipe/tasks-vision");
  const fileset = await vision.FilesetResolver.forVisionTasks(WASM);
  const url = onMobile() ? MODEL_LITE : MODEL_FULL;
  const buf = await fetchModel(url, onProgress);
  const lm = await vision.PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { ...(buf ? { modelAssetBuffer: buf } : { modelAssetPath: url }), delegate: "GPU" },
    runningMode: "VIDEO",
    numPoses: 2,
  });
  return lm as unknown as Landmarker;
}

// With numPoses > 1 MediaPipe can also return a background person. Selecting per-frame by
// size alone would FLICKER between two bodies (the golfer shrinks when they bend at address
// or compress at the top), which would splice two people's hand paths into a fake swing.
// So lock onto the same body across frames by nearest hip-centroid to the previous pick;
// only seed/re-acquire with the largest-vertical-extent pose (the full-body golfer).
function pickGolfer(poses: LM[][], prev: LM[] | null): LM[] {
  if (poses.length <= 1) return poses[0];
  const hipMid = (p: LM[]): [number, number] => [(p[L_HIP].x + p[R_HIP].x) / 2, (p[L_HIP].y + p[R_HIP].y) / 2];
  if (prev) {
    const [px, py] = hipMid(prev);
    let best = poses[0];
    let bestD = Infinity;
    for (const p of poses) {
      const [hx, hy] = hipMid(p);
      const d = Math.hypot(hx - px, hy - py);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (bestD < 0.2) return best; // same body as last frame (hips can't jump 0.2 between samples)
  }
  let best = poses[0];
  let bestH = -1;
  for (const p of poses) {
    const ay = (p[L_ANK].y + p[R_ANK].y) / 2;
    const h = Math.abs(ay - p[NOSE].y);
    if (h > bestH) {
      bestH = h;
      best = p;
    }
  }
  return best;
}

// Seek and resolve on the "seeked" event — but never hang. A single dropped
// "seeked" (common on iOS Safari / HEVC, especially right after metadata load)
// used to freeze the whole pipeline at 0%; the 1.5s timeout makes every await
// self-healing (a frame sampled slightly early is still usable — drawImage just
// reads whatever frame is currently presented; it never invents motion).
function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(to);
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    const onSeeked = () => finish();
    const to = setTimeout(finish, 1500);
    video.addEventListener("seeked", onSeeked);
    video.currentTime = Math.min(t, Math.max(0, video.duration - 0.001));
  });
}

export type ScrubFrame = { idx: number; url: string };
// Downscaled single-channel (luma) frames, one per sampled pose frame, for the
// clubhead motion tracker (lib/club.ts). Captured only when opts.motionWidth is
// set; freed by the caller once the club arc is computed.
export type MotionStack = { w: number; h: number; data: Uint8ClampedArray[] };
export type Extraction = {
  frames: Frame[];
  times: number[];
  fps: number;
  width: number;
  height: number;
  scrubs: ScrubFrame[];
  motion: MotionStack | null;
};
export type SwingWindow = { start: number; end: number };

// MediaPipe VIDEO mode needs strictly increasing timestamps for the lifetime of
// the landmarker — keep a module-level epoch so multiple windows/files stay monotonic.
let tsEpoch = 0;

// Sample a time window and run the landmarker on each frame. Frames are captured during
// PLAYBACK via requestVideoFrameCallback — the only method iOS Safari reliably decodes to
// canvas (seek-then-drawImage returns BLANK frames on iOS, which also made it crawl through
// hundreds of timed-out seeks). Seeking is the fallback only when rVFC is unavailable.
// `times` in the result are absolute video seconds.
export async function extractLandmarks(
  video: HTMLVideoElement,
  landmarker: Landmarker,
  onProgress: (pct: number) => void,
  opts: { sampleFps?: number; maxFrames?: number; window?: SwingWindow; scrubWidth?: number; motionWidth?: number } = {}
): Promise<Extraction> {
  const duration = video.duration;
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!duration || !isFinite(duration))
    throw new Error("Couldn't read the video. Try a different clip (or set iPhone camera to 'Most Compatible').");

  const sampleFps = opts.sampleFps ?? 30;
  const maxFrames = opts.maxFrames ?? 220;
  const start = Math.max(0, opts.window?.start ?? 0);
  const end = Math.min(duration, opts.window?.end ?? duration);
  const len = Math.max(0.3, end - start);

  let nSamples = Math.round(len * sampleFps);
  nSamples = Math.max(8, Math.min(maxFrames, nSamples));
  const targetStep = len / nSamples; // desired seconds between samples

  const epoch = tsEpoch;
  const frames: Frame[] = [];
  const times: number[] = [];
  const scrubs: ScrubFrame[] = [];
  let lastTs = epoch - 1;
  let prevGolfer: LM[] | null = null; // last frame's chosen body — keeps pickGolfer locked to it

  // Downscaled stills captured along the way power the scroll-scrub hero.
  let scrubCanvas: HTMLCanvasElement | null = null;
  const scrubEvery = opts.scrubWidth ? Math.max(1, Math.ceil(nSamples / 28)) : 0;
  if (opts.scrubWidth) {
    scrubCanvas = document.createElement("canvas");
    scrubCanvas.width = opts.scrubWidth;
    scrubCanvas.height = Math.round((opts.scrubWidth * height) / Math.max(1, width));
  }

  // Downscaled luma frames for the clubhead motion tracker.
  let motionCtx: CanvasRenderingContext2D | null = null;
  let motion: MotionStack | null = null;
  if (opts.motionWidth) {
    const mw = opts.motionWidth;
    const mh = Math.max(2, Math.round((mw * height) / Math.max(1, width)));
    const mc = document.createElement("canvas");
    mc.width = mw;
    mc.height = mh;
    motionCtx = mc.getContext("2d", { willReadFrequently: true });
    motion = { w: mw, h: mh, data: [] };
  }

  // Run pose + capture motion/scrub for the frame currently presented at absolute time t.
  const capture = (t: number) => {
    let ts = epoch + Math.round((t - start) * 1000);
    if (ts <= lastTs) ts = lastTs + 1;
    lastTs = ts;
    let res: { landmarks: LM[][] };
    try {
      res = landmarker.detectForVideo(video, ts);
    } catch {
      res = { landmarks: [] };
    }
    const golfer: Frame = res.landmarks && res.landmarks.length ? pickGolfer(res.landmarks, prevGolfer) : null;
    if (golfer) prevGolfer = golfer;
    const idx = frames.length;
    frames.push(golfer);
    times.push(t);
    if (motionCtx && motion) {
      motionCtx.drawImage(video, 0, 0, motion.w, motion.h);
      const rgba = motionCtx.getImageData(0, 0, motion.w, motion.h).data;
      const luma = new Uint8ClampedArray(motion.w * motion.h);
      for (let p = 0, q = 0; p < rgba.length; p += 4, q++) {
        luma[q] = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >> 8; // Rec.601 luma
      }
      motion.data.push(luma);
    }
    if (scrubCanvas && scrubEvery && idx % scrubEvery === 0) {
      const ctx = scrubCanvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0, scrubCanvas.width, scrubCanvas.height);
        scrubs.push({ idx, url: scrubCanvas.toDataURL("image/jpeg", 0.7) });
      }
    }
    onProgress(Math.max(0, Math.min(100, Math.round(((t - start) / len) * 100))));
  };

  const v = video as HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => void;
  };

  if (typeof v.requestVideoFrameCallback === "function") {
    // Play the window and grab presented frames — decodes reliably on iOS, runs ~real-time.
    await seekTo(video, start);
    video.muted = true;
    video.playbackRate = 1;
    try {
      await video.play();
    } catch {
      /* muted inline autoplay is allowed on iOS */
    }
    let lastSampleT = -Infinity;
    await new Promise<void>((resolve) => {
      let done = false;
      const STALL_MS = 8000;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(watchdog);
        resolve();
      };
      let watchdog = setTimeout(finish, STALL_MS);
      const loop = (_: number, meta: { mediaTime: number }) => {
        if (done) return;
        clearTimeout(watchdog);
        watchdog = setTimeout(finish, STALL_MS);
        const t = meta.mediaTime;
        if (t >= start - 0.05 && t - lastSampleT >= targetStep * 0.85) {
          lastSampleT = t;
          capture(Math.max(start, Math.min(end, t)));
        }
        if (t >= end || video.ended || frames.length >= maxFrames) {
          finish();
          return;
        }
        v.requestVideoFrameCallback!(loop);
      };
      v.requestVideoFrameCallback!(loop);
      video.addEventListener("ended", finish, { once: true });
      video.addEventListener("error", finish, { once: true });
    });
    video.pause();
    video.playbackRate = 1;
  } else {
    // No rVFC — fall back to seeking (older desktop browsers).
    for (let i = 0; i < nSamples; i++) {
      const t = start + i * targetStep;
      await seekTo(video, t);
      capture(t);
    }
  }

  // Effective fps from the actual sample spacing (phase/tempo math is frame-index based).
  const span = times.length > 1 ? times[times.length - 1] - times[0] : 0;
  const fps = span > 0 ? (times.length - 1) / span : nSamples / len;

  tsEpoch = lastTs + 1000;
  return { frames, times, fps, width, height, scrubs, motion };
}

// Capture a single frame (by absolute time) into a canvas for display. Grabs a presented
// frame during a brief play — seek-then-drawImage returns blank on iOS Safari.
export async function captureFrame(video: HTMLVideoElement, t: number, canvas: HTMLCanvasElement): Promise<void> {
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  await seekTo(video, t);
  const v = video as HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => void;
  };
  if (typeof v.requestVideoFrameCallback === "function") {
    video.muted = true;
    try {
      await video.play();
    } catch {
      /* muted inline autoplay is allowed */
    }
    await new Promise<void>((resolve) => {
      let done = false;
      const fin = () => {
        if (done) return;
        done = true;
        clearTimeout(wd);
        resolve();
      };
      const wd = setTimeout(fin, 2500);
      v.requestVideoFrameCallback!(() => {
        if (done) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        fin();
      });
    });
    video.pause();
  } else {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  }
}

function median(a: number[]): number {
  const s = [...a].sort((p, q) => p - q);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const SCAN_CAP_S = 180;
const FALLBACK_CAP_S = 54;

// Overlapping whole-clip windows for the dense pose fallback, used when the cheap
// motion scan finds nothing (busy range, small subject, slow-mo, or a flaky
// offscreen/HEVC decode). 10s windows stepped by 6s give a 4s overlap, so a real
// (≲4s) swing straddling a boundary is still fully contained in the adjacent
// window; bounded to 8 chunks / ~54s so a long clip can't explode the dense pass.
// The pose-based swingQuality gate adjudicates each chunk, so this never invents a
// swing — it just refuses to let the cheap scanner silently veto a clip the
// reliable pose pass could analyze. The caller de-dupes overlapping same-swing hits
// by impact time, so distinct swings in a long clip are each kept.
export function chunkWindows(duration: number, capS = FALLBACK_CAP_S): SwingWindow[] {
  const out: SwingWindow[] = [];
  const end = Math.min(duration, capS);
  for (let s = 0; s < end && out.length < 8; s += 6) {
    out.push({ start: s, end: Math.min(end, s + 10) });
  }
  return out.length ? out : [{ start: 0, end: Math.min(duration, 10) }];
}

// Did the decoded frames actually change over time? A dead decode (black/frozen —
// e.g. an iPhone HEVC clip the browser won't decode to canvas) yields a flat motion
// stack. Used to tell an honest "this clip didn't decode" apart from "no swing here".
export function motionVaried(motion: MotionStack | null): boolean {
  if (!motion || motion.data.length < 2) return true; // can't tell ⇒ assume it decoded
  const len = motion.w * motion.h;
  const n = motion.data.length;
  const stride = Math.max(1, Math.floor(n / 8));
  let maxMean = 0;
  for (let k = stride; k < n; k += stride) {
    const a = motion.data[k - stride];
    const b = motion.data[k];
    let s = 0, c = 0;
    for (let i = 0; i < len; i += 4) {
      s += Math.abs(b[i] - a[i]);
      c++;
    }
    const mean = c ? s / c : 0;
    if (mean > maxMean) maxMean = mean;
  }
  return maxMean > 0.5;
}

export type ScanResult = {
  windows: SwingWindow[];
  scannedS: number;
  truncated: boolean;
  decoded: boolean; // did the browser decode changing pixels? (false ⇒ likely a dead HEVC decode)
  fellBack: boolean; // true ⇒ windows are whole-clip chunks, not real motion detections
};

// Cheap first pass over a long video: downscaled pixel-diff motion energy
// (no pose model), played back fast via requestVideoFrameCallback when available,
// with a deterministic seek-based scan as a robust fallback. Returns candidate
// swing windows; the dense pose pass validates each one. Never returns an empty
// window list — a scan that finds nothing degrades to whole-clip chunks.
export async function scanForSwings(
  video: HTMLVideoElement,
  onProgress: (pct: number) => void
): Promise<ScanResult> {
  const duration = video.duration;
  const cap = Math.min(duration, SCAN_CAP_S);
  const truncated = duration > SCAN_CAP_S + 1;

  const w = 96;
  const h = Math.max(2, Math.round((w * video.videoHeight) / Math.max(1, video.videoWidth)));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { windows: chunkWindows(duration), scannedS: cap, truncated, decoded: false, fellBack: true };

  let prev: Uint8ClampedArray | null = null;
  let prevT = -1;
  const ts: number[] = [];
  const es: number[] = [];

  // Localized motion energy: per-pixel |Δluma| accumulated into a 4×4 tile grid,
  // and the energy is the MAX tile's mean (÷ dt). Taking the max tile — not the
  // whole-frame mean — keeps a small, fast-moving golfer from being averaged away
  // under a busy range background. That whole-frame dilution is the device-
  // independent reason real range clips read as "no motion".
  const TX = 4, TY = 4;
  const grab = (t: number) => {
    ctx.drawImage(video, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    if (prev && t > prevT + 0.01) {
      const sum = new Float64Array(TX * TY);
      const cnt = new Int32Array(TX * TY);
      for (let y = 0; y < h; y++) {
        const ty = Math.min(TY - 1, ((y * TY) / h) | 0);
        for (let x = 0; x < w; x++) {
          const p = (y * w + x) * 4;
          // Rec.601 luma over all channels (more robust than green-only).
          const lc = (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) >> 8;
          const lp = (prev[p] * 77 + prev[p + 1] * 150 + prev[p + 2] * 29) >> 8;
          const ti = ty * TX + Math.min(TX - 1, ((x * TX) / w) | 0);
          sum[ti] += Math.abs(lc - lp);
          cnt[ti]++;
        }
      }
      let maxTile = 0;
      for (let i = 0; i < sum.length; i++) {
        const m = cnt[i] ? sum[i] / cnt[i] : 0;
        if (m > maxTile) maxTile = m;
      }
      ts.push((prevT + t) / 2);
      es.push(maxTile / Math.max(0.05, t - prevT));
    }
    prev = d;
    prevT = t;
  };

  // Deterministic seek-based sampler. Forces a decode per step (works even when an
  // offscreen / HEVC video won't present frames for requestVideoFrameCallback), so
  // it's the robust fallback for the fast rVFC playback path below.
  const seekScan = async () => {
    prev = null;
    prevT = -1;
    ts.length = 0;
    es.length = 0;
    const step = 0.25;
    for (let t = 0; t < cap; t += step) {
      await seekTo(video, t);
      grab(t);
      onProgress(Math.min(100, Math.round((t / cap) * 100)));
    }
  };

  const v = video as HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => void;
  };

  if (typeof v.requestVideoFrameCallback === "function") {
    await seekTo(video, 0);
    video.muted = true;
    // Cap at 4× (was 8×): a high-bitrate HEVC decoder outrun by fast playback
    // presents too few frames to locate a ~0.4s swing.
    video.playbackRate = Math.min(4, Math.max(2, cap / 12));
    try {
      await video.play();
    } catch {
      /* muted autoplay should always be allowed */
    }
    let stalled = false;
    await new Promise<void>((resolve) => {
      let done = false;
      const STALL_MS = 3000;
      const finish = (didStall: boolean) => {
        if (done) return;
        done = true;
        if (didStall) stalled = true;
        clearTimeout(watchdog);
        resolve();
      };
      // A 3s gap between presented frames means playback stalled (offscreen
      // throttling / HEVC won't present) — fall through to the seek scan.
      let watchdog = setTimeout(() => finish(true), STALL_MS);
      const loop = (_: number, meta: { mediaTime: number }) => {
        if (done) return;
        clearTimeout(watchdog);
        watchdog = setTimeout(() => finish(true), STALL_MS);
        grab(meta.mediaTime);
        onProgress(Math.min(100, Math.round((meta.mediaTime / cap) * 100)));
        if (meta.mediaTime >= cap || video.ended) {
          finish(false);
          return;
        }
        v.requestVideoFrameCallback!(loop);
      };
      v.requestVideoFrameCallback!(loop);
      video.addEventListener("ended", () => finish(false), { once: true });
      video.addEventListener("error", () => finish(true), { once: true });
    });
    video.pause();
    video.playbackRate = 1;
    // Fall back to the deterministic seek scan when fast playback stalled and either
    // gave too few usable diffs (a duplicate-mediaTime HEVC stall still increments
    // `grabbed` but not `es`, so gate on es.length, not grabbed) or never covered most
    // of the clip. seekScan() fully resets state, so re-running it is safe/idempotent.
    if (stalled && (es.length < 5 || prevT < cap * 0.8)) await seekScan();
  } else {
    await seekScan();
  }

  const maxEs = es.length ? es.reduce((a, b) => Math.max(a, b), 0) : 0;
  const decoded = maxEs > 0.5; // any real pixel change ⇒ frames actually decoded

  if (es.length < 5) return { windows: chunkWindows(duration), scannedS: cap, truncated, decoded, fellBack: true };

  // Robust threshold: median + k·MAD, with floors so constant background motion doesn't drown it.
  // Floors loosened (0.25·med / 1.2 abs) so a small subject's swing clears them; the dense
  // pose pass + swingQuality remain the real arbiter, so extra candidates cost time, not false swings.
  const med = median(es);
  const mad = median(es.map((e) => Math.abs(e - med)));
  const thr = med + Math.max(3 * mad, 0.25 * med, 1.2);

  type Burst = { s: number; e: number; n: number; max: number };
  const bursts: Burst[] = [];
  let cur: Burst | null = null;
  for (let i = 0; i < es.length; i++) {
    if (es[i] >= thr) {
      if (cur && ts[i] - cur.e <= 0.5) {
        cur.e = ts[i];
        cur.n++;
        cur.max = Math.max(cur.max, es[i]);
      } else {
        if (cur) bursts.push(cur);
        cur = { s: ts[i], e: ts[i], n: 1, max: es[i] };
      }
    }
  }
  if (cur) bursts.push(cur);

  // Single-sample blips must be reasonably strong to count (the dense pass still validates everything).
  const strong = bursts.filter((b) => b.n >= 2 || b.max >= 1.5 * thr);

  // Expand to include the still address before and the finish hold after, then merge.
  const expanded = strong.map((b) => ({
    start: Math.max(0, b.s - 1.6),
    end: Math.min(duration, b.e + 1.8),
  }));
  const merged: SwingWindow[] = [];
  for (const wn of expanded) {
    const last = merged[merged.length - 1];
    if (last && wn.start - last.end < 0.6) last.end = Math.max(last.end, wn.end);
    else merged.push({ ...wn });
  }
  // Keep windows a sane length for the dense pass.
  const windows = merged.map((wn) => ({ start: wn.start, end: Math.min(wn.end, wn.start + 9) })).slice(0, 10);

  // The cheap scan is never allowed to veto the clip: if it found no burst, hand back
  // overlapping whole-clip chunks and let the reliable pose pass adjudicate them.
  if (!windows.length) return { windows: chunkWindows(duration), scannedS: cap, truncated, decoded, fellBack: true };

  return { windows, scannedS: cap, truncated, decoded, fellBack: false };
}
