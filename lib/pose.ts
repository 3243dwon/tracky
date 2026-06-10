// MediaPipe Pose Landmarker (web/WASM) loader + frame extraction + long-video scanning.
// Everything runs client-side in the browser; the video never leaves the device.
import type { Frame, LM } from "./analysis";

// Loaded dynamically so it never runs during SSR.
type Landmarker = {
  detectForVideo: (video: HTMLVideoElement, ts: number) => { landmarks: LM[][] };
  close: () => void;
};

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10/wasm";
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task";

export async function createLandmarker(): Promise<Landmarker> {
  const vision = await import("@mediapipe/tasks-vision");
  const fileset = await vision.FilesetResolver.forVisionTasks(WASM);
  const lm = await vision.PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL, delegate: "GPU" },
    runningMode: "VIDEO",
    numPoses: 1,
  });
  return lm as unknown as Landmarker;
}

function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    video.addEventListener("seeked", onSeeked);
    video.currentTime = Math.min(t, Math.max(0, video.duration - 0.001));
  });
}

export type Extraction = { frames: Frame[]; times: number[]; fps: number; width: number; height: number };
export type SwingWindow = { start: number; end: number };

// MediaPipe VIDEO mode needs strictly increasing timestamps for the lifetime of
// the landmarker — keep a module-level epoch so multiple windows/files stay monotonic.
let tsEpoch = 0;

// Seek through a time window at ~sampleFps and run the landmarker on each frame.
// `times` in the result are absolute video seconds.
export async function extractLandmarks(
  video: HTMLVideoElement,
  landmarker: Landmarker,
  onProgress: (pct: number) => void,
  opts: { sampleFps?: number; maxFrames?: number; window?: SwingWindow } = {}
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
  const step = len / nSamples;
  const fps = 1 / step;

  const epoch = tsEpoch;
  const frames: Frame[] = [];
  const times: number[] = [];
  let lastTs = epoch - 1;

  for (let i = 0; i < nSamples; i++) {
    const t = start + i * step;
    await seekTo(video, t);
    let ts = epoch + Math.round((t - start) * 1000);
    if (ts <= lastTs) ts = lastTs + 1;
    lastTs = ts;
    let res: { landmarks: LM[][] };
    try {
      res = landmarker.detectForVideo(video, ts);
    } catch {
      res = { landmarks: [] };
    }
    frames.push(res.landmarks && res.landmarks.length ? res.landmarks[0] : null);
    times.push(t);
    onProgress(Math.round(((i + 1) / nSamples) * 100));
  }

  tsEpoch = lastTs + 1000;
  return { frames, times, fps, width, height };
}

// Capture a single frame (by absolute time) into a canvas for display.
export async function captureFrame(video: HTMLVideoElement, t: number, canvas: HTMLCanvasElement): Promise<void> {
  await seekTo(video, t);
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
}

function median(a: number[]): number {
  const s = [...a].sort((p, q) => p - q);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const SCAN_CAP_S = 180;

// Cheap first pass over a long video: downscaled pixel-diff motion energy
// (no pose model), played back fast via requestVideoFrameCallback when available.
// Returns candidate swing windows; the dense pose pass validates each one.
export async function scanForSwings(
  video: HTMLVideoElement,
  onProgress: (pct: number) => void
): Promise<{ windows: SwingWindow[]; scannedS: number; truncated: boolean }> {
  const duration = video.duration;
  const cap = Math.min(duration, SCAN_CAP_S);
  const truncated = duration > SCAN_CAP_S + 1;

  const w = 96;
  const h = Math.max(2, Math.round((w * video.videoHeight) / Math.max(1, video.videoWidth)));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { windows: [{ start: 0, end: Math.min(duration, 8) }], scannedS: cap, truncated };

  let prev: Uint8ClampedArray | null = null;
  let prevT = -1;
  const ts: number[] = [];
  const es: number[] = [];

  const grab = (t: number) => {
    ctx.drawImage(video, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    if (prev && t > prevT + 0.01) {
      let s = 0;
      let cnt = 0;
      for (let i = 1; i < d.length; i += 8) {
        s += Math.abs(d[i] - prev[i]); // green channel, every other pixel
        cnt++;
      }
      ts.push((prevT + t) / 2);
      es.push(s / cnt / Math.max(0.05, t - prevT));
    }
    prev = d;
    prevT = t;
  };

  const v = video as HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => void;
  };

  if (typeof v.requestVideoFrameCallback === "function") {
    await seekTo(video, 0);
    video.muted = true;
    video.playbackRate = Math.min(8, Math.max(2, cap / 12));
    try {
      await video.play();
    } catch {
      /* muted autoplay should always be allowed */
    }
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          clearTimeout(watchdog);
          resolve();
        }
      };
      let watchdog = setTimeout(finish, 10000);
      const loop = (_: number, meta: { mediaTime: number }) => {
        if (done) return;
        clearTimeout(watchdog);
        watchdog = setTimeout(finish, 10000);
        grab(meta.mediaTime);
        onProgress(Math.min(100, Math.round((meta.mediaTime / cap) * 100)));
        if (meta.mediaTime >= cap || video.ended) {
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
    const step = 0.25;
    for (let t = 0; t < cap; t += step) {
      await seekTo(video, t);
      grab(t);
      onProgress(Math.min(100, Math.round((t / cap) * 100)));
    }
  }

  if (es.length < 5) return { windows: [{ start: 0, end: Math.min(duration, 8) }], scannedS: cap, truncated };

  // Robust threshold: median + k·MAD, with floors so constant background motion doesn't drown it.
  const med = median(es);
  const mad = median(es.map((e) => Math.abs(e - med)));
  const thr = med + Math.max(4 * mad, 0.6 * med, 1.5);

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

  // Single-sample blips must be strong to count (the dense pass still validates everything).
  const strong = bursts.filter((b) => b.n >= 2 || b.max >= 2 * thr);

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

  return { windows, scannedS: cap, truncated };
}
