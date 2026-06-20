// Swing Library — on-device persistence for past analyses (IndexedDB).
//
// The raw video can't be saved (it's an ephemeral object URL, and storing the
// Blob is heavy + gets evicted), so we persist the DERIVED analysis: the full
// Analysis + ClubAnalysis, the 4 phase stills, the scrub stills, and a SLIM
// x/y-only landmark-frame array. That's everything needed to re-render the whole
// results view — including the scroll-scrub hero — without re-running MediaPipe.
//
// Two object stores in one DB so a card never shows without its data:
//   meta    — KB-scale rows for the library grid + compare list (loads instant)
//   payload — the heavy per-swing record (loaded lazily on open/compare)
// Both are written in a SINGLE transaction so an abort rolls back both.
//
// Everything stored is strings / numbers / typed-arrays — NO Blob — which is the
// reliable path on iOS Safari. Nothing leaves the device.
import type { Analysis, Frame, LM, PhaseName } from "./analysis";
import type { ClubAnalysis } from "./club";

export const SCHEMA = 1;
const DB_NAME = "swingcv";
const DB_VERSION = 1;
const N_LM = 33; // MediaPipe Pose landmark count

export type Still = { name: PhaseName; time: number; url: string };
export type ScrubFrame = { idx: number; url: string };

// Slim landmark frames: x,y per of 33 landmarks, flat. NaN = a missing frame.
export type EncodedFrames = { enc: "f32xy"; n: number; data: Float32Array };

export type SavedMeta = {
  id: string;
  schema: number;
  createdAt: number;
  fileName: string;
  label: string;
  view: Analysis["metrics"]["view"];
  heightCmAtSave: number;
  tempoRatio: number;
  backswingS: number;
  downswingS: number;
  peakBh: number | null; // body-heights/sec; mph is derived live from height
  win: { start: number; end: number };
  thumb: string; // impact-still dataURL — the grid thumbnail
  hasFrames: boolean;
  hasScrubs: boolean;
  sizeBytes: number;
};

export type SavedPayload = {
  id: string;
  schema: number;
  analysis: Analysis;
  club: ClubAnalysis | null;
  stills: Still[];
  scrubs: ScrubFrame[];
  frames: EncodedFrames;
  times: number[];
  fps: number;
  width: number;
  height: number;
};

// ---------- frame codec (the round-trip-tested core) ----------

export function encodeFramesXY(frames: Frame[]): EncodedFrames {
  const n = frames.length;
  const data = new Float32Array(n * N_LM * 2);
  for (let i = 0; i < n; i++) {
    const f = frames[i];
    for (let j = 0; j < N_LM; j++) {
      const o = (i * N_LM + j) * 2;
      if (f && f[j]) {
        data[o] = f[j].x;
        data[o + 1] = f[j].y;
      } else {
        data[o] = NaN;
        data[o + 1] = NaN;
      }
    }
  }
  return { enc: "f32xy", n, data };
}

// Rebuild a DENSE 33-element {x,y} array per frame (null where the whole frame
// was missing). draw.ts/ScrubHero/club.ts index lm[0..32].x/.y, so density matters.
export function decodeFramesXY(e: EncodedFrames): Frame[] {
  const data = e.data instanceof Float32Array ? e.data : Float32Array.from(e.data as ArrayLike<number>);
  const out: Frame[] = [];
  for (let i = 0; i < e.n; i++) {
    let allNaN = true;
    const lm: LM[] = new Array(N_LM);
    for (let j = 0; j < N_LM; j++) {
      const o = (i * N_LM + j) * 2;
      const x = data[o];
      const y = data[o + 1];
      // A landmark is valid only if BOTH coords are present. encode always writes
      // x/y together, so a half-NaN pair only comes from a corrupt/hand-edited
      // file — sanitize it to fully-missing rather than emit {x:NaN, y:123} that
      // a downstream draw/club reader would index as a real (NaN) point.
      if (Number.isNaN(x) || Number.isNaN(y)) {
        lm[j] = { x: NaN, y: NaN };
      } else {
        allNaN = false;
        lm[j] = { x, y };
      }
    }
    out.push(allNaN ? null : lm);
  }
  return out;
}

// ---------- IndexedDB plumbing ----------

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable in this browser."));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("meta")) {
        const meta = db.createObjectStore("meta", { keyPath: "id" });
        meta.createIndex("createdAt", "createdAt");
      }
      if (!db.objectStoreNames.contains("payload")) {
        db.createObjectStore("payload", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open the swing library."));
  });
  // Don't cache a rejected open (transient: storage pressure, blocked DB,
  // private browsing) — clearing it lets the next call retry instead of
  // wedging the library for the rest of the session.
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

// Atomic write: meta + payload in one transaction. A QuotaExceededError (or any
// failure) aborts BOTH, so we never leave an orphaned card. Rejects with a
// quota-tagged error the caller can show.
export async function saveSwing(meta: SavedMeta, payload: SavedPayload): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["meta", "payload"], "readwrite");
    let quota = false;
    tx.oncomplete = () => resolve();
    tx.onabort = () => {
      const err = tx.error;
      if (quota || (err && err.name === "QuotaExceededError"))
        reject(Object.assign(new Error("Storage full."), { quota: true }));
      else reject(err ?? new Error("Could not save the swing."));
    };
    try {
      tx.objectStore("meta").put(meta);
      tx.objectStore("payload").put(payload);
    } catch (e) {
      if (e instanceof DOMException && e.name === "QuotaExceededError") quota = true;
      try {
        tx.abort();
      } catch {
        /* already aborting */
      }
    }
  });
}

export async function listMeta(): Promise<SavedMeta[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const out: SavedMeta[] = [];
    const idx = db.transaction("meta", "readonly").objectStore("meta").index("createdAt");
    const cur = idx.openCursor(null, "prev"); // newest first
    cur.onsuccess = () => {
      const c = cur.result;
      if (c) {
        out.push(c.value as SavedMeta);
        c.continue();
      } else resolve(out);
    };
    cur.onerror = () => reject(cur.error);
  });
}

// Tolerant: a missing or unreadable/old-schema record returns null (caller shows
// "this swing can't be opened") rather than throwing.
export async function getPayload(id: string): Promise<SavedPayload | null> {
  const db = await openDB();
  return new Promise((resolve) => {
    const req = db.transaction("payload", "readonly").objectStore("payload").get(id);
    req.onsuccess = () => {
      const v = req.result as SavedPayload | undefined;
      const fr = v?.frames;
      if (!v || v.schema !== SCHEMA || !fr || fr.enc !== "f32xy" || typeof fr.n !== "number" || !fr.data)
        resolve(null);
      else resolve(v);
    };
    req.onerror = () => resolve(null);
  });
}

export async function deleteSwing(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["meta", "payload"], "readwrite");
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.objectStore("meta").delete(id);
    tx.objectStore("payload").delete(id);
  });
}

export async function getEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  try {
    const e = await navigator.storage.estimate();
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
  } catch {
    return null;
  }
}

// Ask the browser to keep our data (resist eviction). Advisory — usually denied
// on iOS for a non-installed site; we surface the result so the UI can be honest.
export async function requestPersist(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

// ---------- portable .swing export / import (survives iOS eviction) ----------

type SwingFile = {
  format: "swing-cv";
  schema: number;
  meta: SavedMeta;
  payload: Omit<SavedPayload, "frames"> & { frames: { enc: "f32xy"; n: number; data: number[] } };
};

export function toSwingFile(meta: SavedMeta, payload: SavedPayload): SwingFile {
  return {
    format: "swing-cv",
    schema: SCHEMA,
    meta,
    payload: { ...payload, frames: { enc: "f32xy", n: payload.frames.n, data: Array.from(payload.frames.data) } },
  };
}

export function fromSwingFile(file: unknown): { meta: SavedMeta; payload: SavedPayload } | null {
  const f = file as Partial<SwingFile> | null;
  if (!f || f.format !== "swing-cv" || !f.meta || !f.payload) return null;
  const { frames: fr, ...rest } = f.payload as SwingFile["payload"];
  if (!fr || !Array.isArray(fr.data) || typeof fr.n !== "number" || fr.data.length !== fr.n * N_LM * 2) return null;
  // Fail closed on a corrupt / hand-edited file rather than crashing the
  // results/compare view downstream on a missing field.
  const p = rest as Partial<SavedPayload>;
  if (
    !p.analysis ||
    !p.analysis.metrics ||
    !Array.isArray(p.stills) ||
    !Array.isArray(p.scrubs) ||
    !Array.isArray(p.times) ||
    typeof p.fps !== "number" ||
    typeof p.width !== "number" ||
    typeof p.height !== "number"
  )
    return null;
  // Every scrub must index into the frame range (ScrubHero reads frames[scrub.idx]).
  if (p.scrubs.some((s) => typeof s?.idx !== "number" || s.idx < 0 || s.idx >= fr.n)) return null;
  // JSON has no NaN: encodeFramesXY's NaN missing-frame sentinels were serialized
  // as null, so restore them here — otherwise null coerces to 0 and a missing
  // frame would decode as a real (0,0) skeleton instead of null.
  const data = Float32Array.from(fr.data as (number | null)[], (v) => (v === null ? NaN : (v as number)));
  return {
    meta: f.meta,
    payload: { ...rest, frames: { enc: "f32xy", n: fr.n, data } },
  };
}

// Rough byte size of a payload (for the meta.sizeBytes hint + quota math).
export function estimatePayloadBytes(payload: SavedPayload): number {
  let n = payload.frames.data.byteLength;
  for (const s of payload.stills) n += s.url.length;
  for (const s of payload.scrubs) n += s.url.length;
  // analysis time-series are the other non-trivial chunk
  n += JSON.stringify(payload.analysis).length + (payload.club ? JSON.stringify(payload.club).length : 0);
  return n;
}
