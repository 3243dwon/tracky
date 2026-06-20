import { describe, it, expect } from "vitest";
import {
  encodeFramesXY,
  decodeFramesXY,
  toSwingFile,
  fromSwingFile,
  estimatePayloadBytes,
  SCHEMA,
  type SavedMeta,
  type SavedPayload,
} from "./library";
import { analyzeSwing, type Frame } from "./analysis";
import { buildSwing } from "@/test/fixtures";

function fixturePayload(): { meta: SavedMeta; payload: SavedPayload; frames: Frame[] } {
  const { frames, times, fps } = buildSwing();
  // Punch a couple of holes so the missing-frame (NaN) path is exercised.
  frames[3] = null;
  frames[7] = null;
  const analysis = analyzeSwing(frames, fps, times);
  const enc = encodeFramesXY(frames);
  const payload: SavedPayload = {
    id: "swing-1",
    schema: SCHEMA,
    analysis,
    club: null,
    stills: [{ name: "impact", time: 1, url: "data:image/png;base64,AAAA" }],
    scrubs: [
      { idx: 6, url: "data:image/png;base64,BBBB" },
      { idx: 24, url: "data:image/png;base64,CCCC" },
    ],
    frames: enc,
    times,
    fps,
    width: 360,
    height: 640,
  };
  const meta: SavedMeta = {
    id: "swing-1",
    schema: SCHEMA,
    createdAt: 1_700_000_000_000,
    fileName: "swing.mp4",
    label: "7 iron",
    view: analysis.metrics.view,
    heightCmAtSave: 175,
    tempoRatio: analysis.metrics.tempoRatio,
    backswingS: analysis.metrics.backswingS,
    downswingS: analysis.metrics.downswingS,
    peakBh: analysis.speed?.peak ?? null,
    win: { start: 0, end: times[times.length - 1] },
    thumb: "data:image/png;base64,DDDD",
    hasFrames: true,
    hasScrubs: true,
    sizeBytes: 0,
  };
  return { meta, payload, frames };
}

describe("frame codec", () => {
  it("round-trips x/y and preserves missing frames as null", () => {
    const { frames } = buildSwing();
    frames[3] = null;
    frames[7] = null;
    const out = decodeFramesXY(encodeFramesXY(frames));
    expect(out).toHaveLength(frames.length);
    expect(out[3]).toBeNull();
    expect(out[7]).toBeNull();
    // a populated frame keeps its joints (Float32 precision)
    expect(out[10]![15].x).toBeCloseTo(frames[10]![15].x, 5);
    expect(out[10]![15].y).toBeCloseTo(frames[10]![15].y, 5);
  });

  it("decodes from a plain number[] (post-JSON) as well as a Float32Array", () => {
    const { frames } = buildSwing();
    const enc = encodeFramesXY(frames);
    const asPlain = { ...enc, data: Array.from(enc.data) as unknown as Float32Array };
    const out = decodeFramesXY(asPlain);
    expect(out[12]![0].x).toBeCloseTo(frames[12]![0].x, 5);
  });
});

describe(".swing export / import", () => {
  it("survives a JSON round-trip including NaN missing-frame sentinels", () => {
    const { meta, payload, frames } = fixturePayload();
    // Exactly what download → re-upload does: stringify, parse, rehydrate.
    const onDisk = JSON.parse(JSON.stringify(toSwingFile(meta, payload)));
    const restored = fromSwingFile(onDisk);
    expect(restored).not.toBeNull();
    const dec = decodeFramesXY(restored!.payload.frames);
    expect(dec[3]).toBeNull(); // null survived JSON (NaN → null → NaN → null frame)
    expect(dec[7]).toBeNull();
    expect(dec[10]![16].y).toBeCloseTo(frames[10]![16].y, 4); // a real joint round-tripped
    expect(restored!.meta.label).toBe("7 iron");
    expect(restored!.payload.analysis.metrics.view).toBe(payload.analysis.metrics.view);
  });

  it("rejects a file that isn't a swing export", () => {
    expect(fromSwingFile(null)).toBeNull();
    expect(fromSwingFile({ format: "something-else" })).toBeNull();
    expect(fromSwingFile({ format: "swing-cv", meta: {} })).toBeNull(); // no payload
  });

  it("rejects a frame buffer whose length doesn't match its declared count", () => {
    const { meta, payload } = fixturePayload();
    const file = toSwingFile(meta, payload);
    (file.payload.frames.data as number[]).pop(); // corrupt length
    expect(fromSwingFile(JSON.parse(JSON.stringify(file)))).toBeNull();
  });

  it("rejects a scrub that points outside the frame range", () => {
    const { meta, payload } = fixturePayload();
    const file = toSwingFile(meta, payload);
    file.payload.scrubs = [{ idx: 99999, url: "x" }];
    expect(fromSwingFile(JSON.parse(JSON.stringify(file)))).toBeNull();
  });

  it("rejects a payload missing its analysis", () => {
    const { meta, payload } = fixturePayload();
    const file = toSwingFile(meta, payload);
    // @ts-expect-error deliberately corrupt
    delete file.payload.analysis;
    expect(fromSwingFile(JSON.parse(JSON.stringify(file)))).toBeNull();
  });
});

// Every fail-closed branch of fromSwingFile — a corrupt/hand-edited field must
// return null, never a half-built payload that crashes the results view later.
describe("fromSwingFile rejects every malformed field", () => {
  type Corrupt = (file: ReturnType<typeof toSwingFile>) => void;
  const cases: [string, Corrupt][] = [
    ["frames.data not an array", (f) => ((f.payload.frames as { data: unknown }).data = {})],
    ["frames.n not a number", (f) => ((f.payload.frames as { n: unknown }).n = "123")],
    ["frames length mismatch", (f) => (f.payload.frames.data as number[]).pop()],
    ["analysis missing", (f) => delete (f.payload as { analysis?: unknown }).analysis],
    ["analysis.metrics missing", (f) => delete (f.payload.analysis as { metrics?: unknown }).metrics],
    ["stills not an array", (f) => ((f.payload as { stills: unknown }).stills = null)],
    ["scrubs not an array", (f) => ((f.payload as { scrubs: unknown }).scrubs = { 0: { idx: 0, url: "x" } })],
    ["times not an array", (f) => ((f.payload as { times: unknown }).times = {})],
    ["fps not a number", (f) => ((f.payload as { fps: unknown }).fps = "60")],
    ["width not a number", (f) => ((f.payload as { width: unknown }).width = null)],
    ["height not a number", (f) => ((f.payload as { height: unknown }).height = undefined)],
    ["scrub idx out of range", (f) => (f.payload.scrubs = [{ idx: 99999, url: "x" }])],
    ["scrub idx negative", (f) => (f.payload.scrubs = [{ idx: -1, url: "x" }])],
  ];
  for (const [name, corrupt] of cases) {
    it(`rejects: ${name}`, () => {
      const { meta, payload } = fixturePayload();
      const file = toSwingFile(meta, payload);
      corrupt(file);
      expect(fromSwingFile(JSON.parse(JSON.stringify(file)))).toBeNull();
    });
  }
});

describe("decodeFramesXY sanitizes a half-NaN landmark", () => {
  it("treats x-NaN / y-present as fully missing, never emitting {x:NaN, y:n}", () => {
    const { frames } = buildSwing();
    const enc = encodeFramesXY(frames);
    // Corrupt landmark 5 of frame 10: blank only x, leave y a real number.
    const o = (10 * 33 + 5) * 2;
    enc.data[o] = NaN;
    const out = decodeFramesXY(enc);
    expect(out[10]).not.toBeNull(); // the rest of the frame is intact
    expect(Number.isNaN(out[10]![5].x)).toBe(true);
    expect(Number.isNaN(out[10]![5].y)).toBe(true); // y sanitized to NaN too
  });
});

describe("estimatePayloadBytes", () => {
  it("is positive and grows with more stored stills", () => {
    const { payload } = fixturePayload();
    const base = estimatePayloadBytes(payload);
    expect(base).toBeGreaterThan(0);
    const heavier: SavedPayload = {
      ...payload,
      scrubs: [...payload.scrubs, { idx: 12, url: "data:image/png;base64," + "Z".repeat(5000) }],
    };
    expect(estimatePayloadBytes(heavier)).toBeGreaterThan(base);
  });
});
