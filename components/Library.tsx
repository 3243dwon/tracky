"use client";

import { useEffect, useRef, useState } from "react";
import {
  listMeta,
  deleteSwing,
  getEstimate,
  getPayload,
  saveSwing,
  toSwingFile,
  fromSwingFile,
  type SavedMeta,
} from "@/lib/library";
import { sortMetas, type SortKey } from "@/lib/trends";
import { bhToMph } from "./SpeedChart";
import Progress from "./Progress";

const SORTS: { key: SortKey; en: string; zh: string }[] = [
  { key: "newest", en: "Newest", zh: "最新" },
  { key: "fast", en: "Fastest", zh: "最快" },
  { key: "smooth", en: "Smoothest", zh: "最流畅" },
];

// The saved-swing library: a grid of past analyses (thumbnail + key numbers),
// with select-to-compare (max 2), delete, a storage meter, honest on-device /
// eviction copy, and .swing export/import so the library survives Safari's
// ~7-day eviction or moves to another device / a coach.

function daysAgo(ts: number): string {
  const d = Math.floor((Date.now() - ts) / 86_400_000);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  return `${d} days ago`;
}

export default function Library({
  onReopen,
  onCompare,
  onClose,
}: {
  onReopen: (m: SavedMeta) => void;
  onCompare: (a: SavedMeta, b: SavedMeta) => void;
  onClose: () => void;
}) {
  const [metas, setMetas] = useState<SavedMeta[]>([]);
  const [sel, setSel] = useState<string[]>([]);
  const [est, setEst] = useState<{ usage: number; quota: number } | null>(null);
  const [msg, setMsg] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [sort, setSort] = useState<SortKey>("newest");
  const importRef = useRef<HTMLInputElement>(null);
  const shown = sortMetas(metas, sort);

  async function refresh() {
    setMetas(await listMeta());
    setEst(await getEstimate());
    setLoaded(true);
  }
  useEffect(() => {
    void refresh();
  }, []);

  function toggle(id: string) {
    setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 2 ? [s[1], id] : [...s, id]));
  }

  async function onDelete(id: string) {
    await deleteSwing(id);
    setSel((s) => s.filter((x) => x !== id));
    void refresh();
  }

  async function onExport() {
    const ids = sel.length ? sel : metas.map((m) => m.id);
    if (!ids.length) return;
    const files = [];
    for (const id of ids) {
      const p = await getPayload(id);
      const m = metas.find((x) => x.id === id);
      if (p && m) files.push(toSwingFile(m, p));
    }
    if (!files.length) return;
    const blob = new Blob([JSON.stringify(files)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = files.length === 1 ? `${files[0].meta.label || "swing"}.swing` : `swings-${files.length}.swing`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg(`Exported ${files.length} swing${files.length > 1 ? "s" : ""}.`);
  }

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      let n = 0;
      for (const item of arr) {
        const r = fromSwingFile(item);
        if (r) {
          await saveSwing(r.meta, r.payload);
          n++;
        }
      }
      setMsg(n ? `Imported ${n} swing${n > 1 ? "s" : ""}.` : "No valid swings in that file.");
      void refresh();
    } catch {
      setMsg("Couldn't read that file — is it a .swing export?");
    }
  }

  const pct = est && est.quota > 0 ? Math.round((est.usage / est.quota) * 100) : null;

  return (
    <div className="results">
      <div className="cmptop">
        <div className="section-title" style={{ marginTop: 0 }}>
          Your swing library{metas.length ? ` · ${metas.length}` : ""}
        </div>
        <button className="chip" onClick={onClose}>
          ✕ Close
        </button>
      </div>

      <div className="libbar">
        <span className="note" style={{ margin: 0 }}>
          Saved on <b>this device</b> · nothing uploaded. Safari may clear these if the site is unused ~a week —{" "}
          <b>Export</b> to keep them.
          {pct !== null ? ` · storage ${pct}% full` : ""}
        </span>
        <div className="libactions">
          <button className="chip" onClick={onExport} disabled={!metas.length}>
            ⤓ Export{sel.length ? ` (${sel.length})` : " all"}
          </button>
          <button className="chip" onClick={() => importRef.current?.click()}>
            ⤒ Import
          </button>
          <input ref={importRef} type="file" accept=".swing,application/json" hidden onChange={onImportFile} />
        </div>
      </div>

      {loaded && metas.length > 0 && <Progress metas={metas} />}

      {msg && <p className="note">{msg}</p>}

      {sel.length === 2 && (
        <div className="cta2" style={{ margin: "6px 0 14px" }}>
          <button
            className="btn"
            onClick={() => {
              const a = metas.find((m) => m.id === sel[0])!;
              const b = metas.find((m) => m.id === sel[1])!;
              onCompare(a, b);
            }}
          >
            ⇄ Compare these 2 swings
          </button>
        </div>
      )}

      {!loaded ? (
        <p className="note">Loading…</p>
      ) : metas.length === 0 ? (
        <div className="card">
          <p className="reco">
            No saved swings yet. Analyze a swing, then hit <b>Save swing</b> — it&apos;s stored on this device (nothing
            uploads), and you can reopen or compare it here later. Use <b>Import</b> to restore a <code>.swing</code>{" "}
            export.
          </p>
        </div>
      ) : (
        <>
          {metas.length > 1 && (
            <div className="sortbar">
              <span className="sortlabel">Sort 排序</span>
              {SORTS.map((s) => (
                <button
                  key={s.key}
                  className={sort === s.key ? "sortchip on" : "sortchip"}
                  onClick={() => setSort(s.key)}
                >
                  {s.en} <span className="zh">{s.zh}</span>
                </button>
              ))}
            </div>
          )}
          <div className="libgrid">
            {shown.map((m) => {
            const on = sel.includes(m.id);
            const mph = m.peakBh != null ? Math.round(bhToMph(m.peakBh, m.heightCmAtSave)) : null;
            return (
              <div className={on ? "libcard on" : "libcard"} key={m.id}>
                <button className="libthumb" onClick={() => onReopen(m)} title="Reopen this analysis">
                  {m.thumb ? <img src={m.thumb} alt={m.label} /> : <div className="demobox">no preview</div>}
                  <span className="libview">{m.view}</span>
                </button>
                <div className="libmeta">
                  <div className="libname" title={m.label || m.fileName}>
                    {m.label || m.fileName}
                  </div>
                  <div className="libnums num">
                    {Number.isNaN(m.tempoRatio) ? "—" : m.tempoRatio.toFixed(1)}:1
                    {mph != null ? ` · ${mph} mph` : ""}
                  </div>
                  <div className="libdate">{daysAgo(m.createdAt)}</div>
                </div>
                <div className="librow">
                  <label className="libsel">
                    <input type="checkbox" checked={on} onChange={() => toggle(m.id)} /> compare
                  </label>
                  <button className="libdel" onClick={() => onDelete(m.id)} title="Delete">
                    ✕
                  </button>
                </div>
              </div>
            );
            })}
          </div>
        </>
      )}

      {metas.length > 0 && (
        <p className="note">Tick two swings to compare them side-by-side. Click a thumbnail to reopen the full analysis.</p>
      )}
    </div>
  );
}
