import { describe, it, expect } from "vitest";
import { applyOutcome, outcomeChips, type Outcome } from "./outcome";
import type { Fault } from "./analysis";

const pathFault = (): Fault => ({ title: "Over-the-top", mishit: "m", detail: "d", fix: "f", focus: "slice / swing path" });
const strikeFault = (): Fault => ({ title: "Sway", mishit: "m", detail: "d", fix: "f", focus: "strike consistency" });
const tempoFault = (): Fault => ({ title: "Rushed", mishit: "m", detail: "d", fix: "f", focus: "tempo" });

describe("applyOutcome — passthrough", () => {
  it("no outcome → faults unchanged, no note", () => {
    const faults = [pathFault()];
    const r = applyOutcome(faults, null, "R", false);
    expect(r.faults).toBe(faults);
    expect(r.note).toBeNull();
  });

  it("a flush report relates to nothing (no note, no re-rank)", () => {
    const r = applyOutcome([pathFault()], "flush", "R", false);
    expect(r.note).toBeNull();
    expect(r.faults[0].reported).toBeUndefined();
  });
});

describe("applyOutcome — slice / pull disambiguation (the honest payoff)", () => {
  it("a reported slice + a measured out-to-in path → promote + relate, no face claim", () => {
    const r = applyOutcome([strikeFault(), pathFault()], "slice", "R", false);
    expect(r.faults[0].focus).toBe("slice / swing path"); // promoted to front
    expect(r.faults[0].reported).toContain("sliced");
    expect(r.faults[0].reported).toContain("face"); // names the unseen half honestly
    expect(r.note).toBeNull();
  });

  it("a reported pull on the SAME path reads as a pull, not a slice — the separation", () => {
    const r = applyOutcome([pathFault()], "pull", "R", false);
    expect(r.faults[0].reported).toContain("pulled");
    expect(r.faults[0].reported?.toLowerCase()).toContain("same out-to-in");
    expect(r.note).toBeNull();
  });

  it("does NOT mutate the original fault object (promote clones)", () => {
    const original = pathFault();
    applyOutcome([original], "slice", "R", false);
    expect(original.reported).toBeUndefined();
  });
});

describe("applyOutcome — never invents, never reconciles a contradiction", () => {
  it("a reported slice with NO over-the-top fault fired → a hedge note, no manufactured fault", () => {
    const r = applyOutcome([], "slice", "R", false);
    expect(r.faults).toHaveLength(0);
    expect(r.note).toMatch(/didn't measure|over-the-top/i);
  });

  it("a reported hook CONTRADICTS a measured out-to-in path → hedge, never promote", () => {
    const r = applyOutcome([pathFault()], "hook", "R", false);
    expect(r.faults[0].reported).toBeUndefined(); // not promoted / annotated
    expect(r.note).toMatch(/over-the-top|settle it|down-the-line/i);
  });
});

describe("applyOutcome — strike reports", () => {
  it("a reported thin + a strike fault → promote + relate", () => {
    const r = applyOutcome([tempoFault(), strikeFault()], "thin", "R", false);
    expect(r.faults[0].focus).toBe("strike consistency");
    expect(r.faults[0].reported).toContain("thin");
    expect(r.note).toBeNull();
  });

  it("a reported fat with no strike fault → hedge note only", () => {
    const r = applyOutcome([tempoFault()], "fat", "R", false);
    expect(r.faults[0].reported).toBeUndefined();
    expect(r.note).toMatch(/didn't measure|low-point|head/i);
  });
});

describe("applyOutcome — lowConf gate (the kill-switch)", () => {
  it("on a low-confidence trace, a confident report relates to NOTHING", () => {
    const r = applyOutcome([pathFault()], "slice", "R", true);
    expect(r.faults[0].reported).toBeUndefined(); // no prescription-grade annotation
    expect(r.note).toMatch(/clean enough|re-film/i);
  });
});

describe("outcomeChips — handedness-correct labels", () => {
  it("returns all seven outcomes", () => {
    const keys = outcomeChips("R").map((c) => c.key);
    expect(keys).toEqual<Outcome[]>(["flush", "slice", "hook", "pull", "push", "thin", "fat"]);
  });

  it("a right-hander's slice curves toward the right; a left-hander's toward the left", () => {
    const r = outcomeChips("R").find((c) => c.key === "slice")!;
    const l = outcomeChips("L").find((c) => c.key === "slice")!;
    expect(r.label).toContain("右");
    expect(r.label).toContain("right");
    expect(l.label).toContain("左");
    expect(l.label).toContain("left");
  });
});
