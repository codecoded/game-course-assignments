// The lead producer's loop as code (ADD handoff chain):
// assign → systems designer → (schedule designer → mission designer) ∥ dialogue designer → simulation engineer → revise or accept.
// Usage: bun run crew [briefs/<brief>.json]
import { mkdir } from "node:fs/promises";
import { check, type CheckResult, type Pkg } from "./checker";
import { runAgent, type Usage } from "./claude";
import { renderBriefing } from "./render";
import { formatTokens, summarize } from "./usage";
import { Brief, Cast, Dialogue, Layout, Mission, Schedule, Verdict, type Owner } from "./schemas";

const MAX_REVISIONS = 3;
const DOWNSTREAM: Record<Owner, Owner[]> = {
  "systems-designer": ["schedule-designer", "mission-designer", "dialogue-designer"],
  "schedule-designer": ["mission-designer"],
  "mission-designer": [],
  "dialogue-designer": [],
};

const block = (label: string, data: unknown) => `${label}:\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``;
const logLines: string[] = [];
const log = (msg: string) => {
  const line = `[lead-producer] ${msg}`;
  console.log(line);
  logLines.push(line);
};

// Layer-4 objective in the ADD's form: task · input · done when · evidence · next owner,
// plus revision notes and the previous output when the work is sent back.
type Spec = { task: string; inputs: [string, unknown][]; done: string; evidence: string; next: string };
function objective(s: Spec, notes: string[] = [], previous?: unknown) {
  const parts = [`Objective: ${s.task}`, ...s.inputs.map(([l, d]) => block(l, d)),
    `Done when: ${s.done}`, `Evidence: ${s.evidence}`, `Next: ${s.next}`];
  if (notes.length)
    parts.push(`Sent back by the simulation engineer. Change only what these notes require; keep every other field, id and number unchanged, and return the full output:\n- ${notes.join("\n- ")}`);
  if (previous) parts.push(block("Your previous output", previous));
  return parts.join("\n\n");
}

const briefPath = process.argv[2] ?? "briefs/handover.json";
const brief = Brief.parse(await Bun.file(briefPath).json());
const layout = Layout.parse(await Bun.file(brief.layout).json());
const dir = `out/${brief.id}`;
await mkdir(dir, { recursive: true });
const save = (name: string, data: unknown) => Bun.write(`${dir}/${name}.json`, JSON.stringify(data, null, 2));
const usage: Usage[] = [];

const agents = {
  systems: (notes: string[], prev?: Cast) =>
    runAgent("systems-designer", objective({
      task: `Design the cast for mission "${brief.id}".`, inputs: [["Brief", brief], ["Layout", layout]],
      done: "the simulation engineer accepts the table: every contact has one clear need, learnable facts and priced approaches; the purse lesson holds.",
      evidence: "the cast, with the purse lesson worked out in dollars.",
      next: "schedule designer, mission designer, dialogue designer.",
    }, notes, prev), Cast, usage),
  schedule: (cast: Cast, notes: string[], prev?: Schedule) =>
    runAgent("schedule-designer", objective({
      task: `Write the mission clock for "${brief.id}".`, inputs: [["Brief", brief], ["Layout", layout], ["Cast", cast]],
      done: `the simulation engineer accepts: closing event at ${brief.closingEvent.at_s}s; every window a contact's act needs is an event with a reason.`,
      evidence: "the schedule, with event ids the routes can reference.",
      next: "mission designer.",
    }, notes, prev), Schedule, usage),
  mission: (cast: Cast, schedule: Schedule, notes: string[], prev?: Mission) =>
    runAgent("mission-designer", objective({
      task: `Design the routes for "${brief.id}".`, inputs: [["Brief", brief], ["Layout", layout], ["Cast", cast], ["Schedule", schedule]],
      done: "the mission checker passes: ≥2 quiet routes win, loud costs more Trail, every fail reachable, no essential contact, 60 s spare; every step at a layout place, reachable on foot, covert acts unseen.",
      evidence: "the mission: routes as timed steps, fails with what reaches them, both fight branches.",
      next: "simulation engineer.",
    }, notes, prev), Mission, usage),
  dialogue: (cast: Cast, notes: string[], prev?: Dialogue) =>
    runAgent("dialogue-designer", objective({
      task: `Write the lines for "${brief.id}".`, inputs: [["Brief", brief], ["Cast", cast]],
      done: "every person has a line per approach plus refusal, questioned and confirm_call.",
      evidence: "the dialogue lines.",
      next: "simulation engineer.",
    }, notes, prev), Dialogue, usage),
  simulation: (pkg: Pkg, report: CheckResult, prev?: Verdict) =>
    runAgent("simulation-engineer", objective({
      task: `Check mission "${brief.id}" against the rulebook.`,
      inputs: [["Package", pkg], ["Checker report", report], ...(prev ? [["Your previous verdict", prev] as [string, unknown]] : [])],
      done: "every fault is a revision for its owner with a severity; pass only if the checker passed and nothing blocks.",
      evidence: "the verdict, each fault naming the step, event or field and the number to change.",
      next: "owners (revise) or lead producer (accept).",
    }), Verdict, usage),
};

log(`brief ${briefPath} · layout ${layout.id} (${layout.places.length} places, ${layout.watchers.length} watchers) → ${dir}`);
log("systems-designer: cast");
let cast = await agents.systems([]);
await save("cast", cast);

log("schedule-designer → mission-designer ∥ dialogue-designer");
const routes = async (c: Cast) => {
  const s = await agents.schedule(c, []);
  return { schedule: s, mission: await agents.mission(c, s, []) };
};
let [{ schedule, mission }, dialogue] = await Promise.all([routes(cast), agents.dialogue(cast, [])]);

const rounds: { round: number; checker: CheckResult; verdict: Verdict }[] = [];
let accepted = false;
for (let round = 0; ; round++) {
  const pkg: Pkg = { brief, layout, cast, schedule, mission, dialogue };
  await Promise.all([save("cast", cast), save("schedule", schedule), save("mission", mission), save("dialogue", dialogue)]);

  const report = check(pkg);
  log(`round ${round}: checker ${report.pass ? "pass" : `${report.violations.length} violations`}; simulation-engineer reviewing`);
  const verdict = await agents.simulation(pkg, report, rounds.at(-1)?.verdict);
  rounds.push({ round, checker: report, verdict });
  const blocks = verdict.revisions.filter((r) => r.severity === "block");
  accepted = report.pass && blocks.length === 0;
  log(`simulation-engineer: ${blocks.length} blocking, ${verdict.revisions.length - blocks.length} notes — ${verdict.summary}`);
  if (accepted || round === MAX_REVISIONS) break;

  // Route each blocking fault to its author; anything downstream of a changed output re-aligns too.
  const notes: Record<Owner, string[]> = { "systems-designer": [], "schedule-designer": [], "mission-designer": [], "dialogue-designer": [] };
  for (const r of blocks) notes[r.owner].push(`${r.issue} → ${r.fix}`);
  for (const v of report.violations) notes[v.owner].push(`[checker ${v.rule}] ${v.message}`);
  const redo = new Set((Object.keys(notes) as Owner[]).filter((o) => notes[o].length));
  for (const o of [...redo]) DOWNSTREAM[o].forEach((d) => redo.add(d));
  log(`revising: ${[...redo].join(", ")}`);

  const n = (o: Owner) => (notes[o].length ? notes[o] : ["Upstream output changed — re-align to the new input only where it breaks."]);
  if (redo.has("systems-designer")) cast = await agents.systems(n("systems-designer"), cast);
  const redoRoutes = async () => {
    if (redo.has("schedule-designer")) schedule = await agents.schedule(cast, n("schedule-designer"), schedule);
    if (redo.has("mission-designer")) mission = await agents.mission(cast, schedule, n("mission-designer"), mission);
  };
  const redoLines = async () => { if (redo.has("dialogue-designer")) dialogue = await agents.dialogue(cast, n("dialogue-designer"), dialogue); };
  await Promise.all([redoRoutes(), redoLines()]);
}

const pkg: Pkg = { brief, layout, cast, schedule, mission, dialogue };
const final = rounds.at(-1)!;
const tokens = summarize(usage);
await save("report", { accepted, rounds, usage, tokens });
await save("mission-package", { accepted, ...pkg, check: final.checker });
await Bun.write(`${dir}/briefing.html`, renderBriefing(pkg, final.checker, final.verdict, accepted, tokens));
for (const [agent, t] of Object.entries(tokens.byAgent))
  log(`tokens ${agent}: ${t.calls} calls · ${formatTokens(t.inputTokens)} in · ${formatTokens(t.outputTokens)} out · ${formatTokens(t.totalTokens)} total`);
const o = tokens.overall;
log(`tokens overall: ${o.calls} calls · ${formatTokens(o.inputTokens)} in · ${formatTokens(o.outputTokens)} out · ${formatTokens(o.totalTokens)} total · ${o.seconds}s agent time`);
log(`${accepted ? "ACCEPTED" : "NOT ACCEPTED"} after ${rounds.length} round(s), ${o.calls} agent calls → ${dir}/mission-package.json, ${dir}/briefing.html`);
await Bun.write(`${dir}/run.log`, logLines.join("\n") + "\n");
process.exit(accepted ? 0 : 1);
