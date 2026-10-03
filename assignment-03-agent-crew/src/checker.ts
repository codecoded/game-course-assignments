// The mission checker (ADD: owned by the mission designer) plus the simulation engineer's rulebook rules (§03–§06), as code.
// Spatial rules against the block layout live in spatial.ts.
// Deterministic — the same package always gives the same verdict.
import type { Brief, Cast, Dialogue, Layout, Mission, Owner, Route, Schedule } from "./schemas";
import { checkSpatial } from "./spatial";

export const VERBS: Record<string, string[]> = {
  Scout: ["Watch", "Listen", "Mislead"],
  Fixer: ["Turn", "Call"],
  Tech: ["Loop", "Reroute"],
  Enforcer: ["Enter", "Take", "Fire"],
};
const SPARE_S = 60; // informed player finishes ≥ 1:00 before the closing event
const MISSION_S = [480, 720]; // one block, 8–12 min

export type Violation = { rule: string; owner: Owner; message: string };
export type RouteStats = { id: string; kind: string; cost: number; trail: number; alert: number; finish_s: number; contacts: string[] };
export type CheckResult = { pass: boolean; violations: Violation[]; routes: RouteStats[] };
export type Pkg = { brief: Brief; layout: Layout; cast: Cast; schedule: Schedule; mission: Mission; dialogue: Dialogue };

const end = (s: { start_s: number; duration_s: number }) => s.start_s + s.duration_s;
const sum = (r: Route, k: "cost" | "trail" | "alert") => r.steps.reduce((n, s) => n + s[k], 0);
const contactsOf = (r: Route) => [...new Set(r.steps.filter((s) => s.verb === "Turn").map((s) => s.target))];

function checkSteps(p: Pkg, r: Route, v: Violation[]) {
  const people = new Map(p.cast.people.map((x) => [x.id, x]));
  const events = new Map(p.schedule.events.map((e) => [e.id, e]));
  const stepsById = new Map(r.steps.map((s) => [s.id, { start: s.start_s, end: end(s) }]));
  const at = `route ${r.id}`;

  for (const s of r.steps) {
    const where = `${at} step ${s.id}`;
    if (!p.brief.cell.includes(s.op)) v.push({ rule: "cell", owner: "mission-designer", message: `${where}: ${s.op} is not in this mission's cell` });
    if (!VERBS[s.op]?.includes(s.verb)) {
      v.push({ rule: "verb", owner: "mission-designer", message: `${where}: ${s.op} cannot ${s.verb} (allowed: ${VERBS[s.op]?.join(", ")})` });
      continue;
    }
    // after/before name a schedule event (its time) or another step in this route (it must finish first / start later).
    if (s.after) {
      const t = events.get(s.after)?.at_s ?? stepsById.get(s.after)?.end;
      if (t === undefined) v.push({ rule: "event", owner: "mission-designer", message: `${where}: after unknown event or step ${s.after}` });
      else if (s.start_s < t) v.push({ rule: "timing", owner: "mission-designer", message: `${where}: starts ${s.start_s}s, before ${s.after} at ${t}s` });
    }
    if (s.before) {
      const t = events.get(s.before)?.at_s ?? stepsById.get(s.before)?.start;
      if (t === undefined) v.push({ rule: "event", owner: "mission-designer", message: `${where}: before unknown event or step ${s.before}` });
      else if (end(s) > t) v.push({ rule: "timing", owner: "mission-designer", message: `${where}: ends ${end(s)}s, after ${s.before} at ${t}s` });
    }
    if (s.verb === "Fire" && s.trail < 2)
      v.push({ rule: "fire-cost", owner: "mission-designer", message: `${where}: each shot is +2 Trail (§06)` });
    if (s.verb === "Take" && s.target !== p.cast.target.id)
      v.push({ rule: "take", owner: "mission-designer", message: `${where}: Take must target ${p.cast.target.id}` });

    if (s.verb === "Turn") {
      const person = people.get(s.target);
      if (!person) { v.push({ rule: "turn", owner: "mission-designer", message: `${where}: ${s.target} is not in the cast` }); continue; }
      const ap = person.approaches.find((a) => a.kind === s.approach);
      if (!ap) { v.push({ rule: "turn", owner: "mission-designer", message: `${where}: ${person.id} has no ${s.approach} approach` }); continue; }
      if (ap.cost !== s.cost || ap.time_s !== s.duration_s || ap.trail !== s.trail)
        v.push({ rule: "price", owner: "mission-designer", message: `${where}: price must match the systems designer's table ($${ap.cost}, ${ap.time_s}s, +${ap.trail} T)` });
      if (ap.requires !== "none") {
        const how = person.learn.find((l) => l.fact === ap.requires);
        if (!how) v.push({ rule: "learn", owner: "systems-designer", message: `${person.id}: ${s.approach} requires ${ap.requires} but no way to learn it` });
        else if (!r.steps.some((x) => x.verb === how.verb && x.target === person.id && end(x) <= s.start_s))
          v.push({ rule: "knowledge", owner: "mission-designer", message: `${where}: ${s.approach} needs ${ap.requires} known first (${how.verb} ${person.id})` });
      }
    }
    if (s.verb === "Call" && !r.steps.some((x) => x.verb === "Turn" && x.target === s.target && end(x) <= s.start_s))
      v.push({ rule: "call", owner: "mission-designer", message: `${where}: can only Call a contact already turned` });
  }

  // An operative does one thing at a time.
  for (const op of Object.keys(VERBS)) {
    const mine = r.steps.filter((s) => s.op === op).sort((a, b) => a.start_s - b.start_s);
    for (let i = 1; i < mine.length; i++)
      if (mine[i]!.start_s < end(mine[i - 1]!))
        v.push({ rule: "overlap", owner: "mission-designer", message: `${at}: ${op} steps ${mine[i - 1]!.id} and ${mine[i]!.id} overlap` });
  }
}

function checkCast(p: Pkg, v: Violation[]) {
  if (p.cast.people.length < 2) v.push({ rule: "cast", owner: "systems-designer", message: "need at least 2 contacts so no single contact is essential" });
  for (const x of p.cast.people) {
    if (!x.need.trim()) v.push({ rule: "need", owner: "systems-designer", message: `${x.id}: needs one clear need` });
    if (!x.approaches.length) v.push({ rule: "approach", owner: "systems-designer", message: `${x.id}: has no approaches` });
  }
}

function checkSchedule(p: Pkg, v: Violation[]) {
  const close = p.schedule.events.find((e) => e.id === p.schedule.closingEventId);
  if (!close) return v.push({ rule: "closing", owner: "schedule-designer", message: `closing event ${p.schedule.closingEventId} not in schedule` });
  if (close.at_s !== p.brief.closingEvent.at_s)
    v.push({ rule: "closing", owner: "schedule-designer", message: `closing event at ${close.at_s}s, brief says ${p.brief.closingEvent.at_s}s` });
  if (close.at_s < MISSION_S[0]! || close.at_s > MISSION_S[1]!)
    v.push({ rule: "length", owner: "schedule-designer", message: `mission must close between 8:00 and 12:00 (got ${close.at_s}s)` });
  if (p.schedule.rivals.arrive_s >= close.at_s)
    v.push({ rule: "rivals", owner: "schedule-designer", message: "rivals must arrive before the closing event" });
}

function checkMission(p: Pkg, stats: RouteStats[], v: Violation[]) {
  const closing = p.brief.closingEvent.at_s;
  const quiet = stats.filter((r) => r.kind === "quiet");
  const loud = stats.filter((r) => r.kind === "loud");

  for (const r of p.mission.routes) {
    const st = stats.find((s) => s.id === r.id)!;
    if (!r.steps.some((s) => s.op === "Enforcer" && s.verb === "Take"))
      v.push({ rule: "win", owner: "mission-designer", message: `route ${r.id}: never takes ${p.cast.target.id}` });
    if (st.cost > p.brief.purse) v.push({ rule: "purse", owner: "mission-designer", message: `route ${r.id}: costs $${st.cost} > purse $${p.brief.purse}` });
    if (st.finish_s >= closing) v.push({ rule: "clock", owner: "mission-designer", message: `route ${r.id}: finishes ${st.finish_s}s, not before closing ${closing}s` });
    if (r.steps.some((s) => s.verb === "Fire") && st.alert < 2)
      v.push({ rule: "fire-cost", owner: "mission-designer", message: `route ${r.id}: gunfire sets Alert 2 (§05, one incident counts once); route totals ${st.alert}` });
    if (st.alert > 3) v.push({ rule: "alert-cap", owner: "mission-designer", message: `route ${r.id}: Alert totals ${st.alert}; it runs 0–3 and one incident counts once (§05)` });
    if (r.kind === "quiet" && (st.alert > 1 || r.steps.some((s) => s.verb === "Fire")))
      v.push({ rule: "quiet", owner: "mission-designer", message: `route ${r.id}: quiet routes fire no shots and stay at Alert ≤ 1` });
  }
  if (quiet.length < 2) v.push({ rule: "quiet-routes", owner: "mission-designer", message: `need ≥ 2 quiet routes (got ${quiet.length})` });
  if (!loud.length) v.push({ rule: "loud-route", owner: "mission-designer", message: "need a loud route" });
  const maxQuietTrail = Math.max(0, ...quiet.map((r) => r.trail));
  for (const r of loud)
    if (r.trail <= maxQuietTrail) v.push({ rule: "loud-cost", owner: "mission-designer", message: `loud route ${r.id} must cost more Trail than every quiet route (${r.trail} ≤ ${maxQuietTrail})` });
  if (quiet.length && Math.min(...quiet.map((r) => r.finish_s)) > closing - SPARE_S)
    v.push({ rule: "spare", owner: "mission-designer", message: `fastest quiet route must finish ≥ 60 s before closing (${closing - SPARE_S}s)` });

  for (const c of new Set(quiet.flatMap((r) => r.contacts)))
    if (!quiet.some((r) => !r.contacts.includes(c)))
      v.push({ rule: "essential", owner: "mission-designer", message: `contact ${c} is essential: every quiet route uses them` });

  const ids = new Set([...p.schedule.events.map((e) => e.id), ...p.mission.routes.flatMap((r) => r.steps.map((s) => s.id))]);
  if (p.mission.fails.length < 3) v.push({ rule: "fails", owner: "mission-designer", message: "list every fail condition (≥ 3)" });
  for (const f of p.mission.fails)
    if (!ids.has(f.reachedBy)) v.push({ rule: "fail-reachable", owner: "mission-designer", message: `fail ${f.id}: reachedBy ${f.reachedBy} is not an event or step` });
}

function checkDialogue(p: Pkg, v: Violation[]) {
  const has = (id: string, sit: string) => p.dialogue.lines.some((l) => l.personId === id && l.situation === sit && l.line.trim());
  const called = new Set(p.mission.routes.flatMap((r) => r.steps.filter((s) => s.verb === "Call").map((s) => s.target)));
  for (const x of p.cast.people) {
    const need = [...x.approaches.map((a) => a.kind), "refusal", "questioned", ...(called.has(x.id) ? ["confirm_call"] : [])];
    for (const sit of need) if (!has(x.id, sit)) v.push({ rule: "dialogue", owner: "dialogue-designer", message: `${x.id}: missing ${sit} line` });
  }
}

export function check(p: Pkg): CheckResult {
  const v: Violation[] = [];
  const routes: RouteStats[] = p.mission.routes.map((r) => ({
    id: r.id,
    kind: r.kind,
    cost: sum(r, "cost"),
    trail: sum(r, "trail"),
    alert: sum(r, "alert"),
    finish_s: Math.max(0, ...r.steps.map(end)),
    contacts: contactsOf(r),
  }));
  checkCast(p, v);
  checkSchedule(p, v);
  for (const r of p.mission.routes) checkSteps(p, r, v);
  checkMission(p, routes, v);
  checkSpatial(p, v);
  checkDialogue(p, v);
  return { pass: v.length === 0, violations: v, routes };
}
