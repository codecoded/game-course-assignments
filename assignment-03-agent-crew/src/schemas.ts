// Handoff contracts between agents. Each agent's output is validated against
// its schema before the next agent sees it (ADD: handoff = inputs · done-check · next owner).
import { z } from "zod";

export const Op = z.enum(["Scout", "Fixer", "Tech", "Enforcer"]);
export const ApproachKind = z.enum(["Ask", "Pay", "Help", "Pressure"]);
export const Fact = z.enum(["routine", "need"]);

// Input: the block, stripped from the capstone's world manifest (src/extract-layout.ts).
// Agents never write coordinates — only place and watcher ids from this list.
const XY = z.tuple([z.number(), z.number()]);
export const Layout = z.object({
  id: z.string(),
  source: z.string(),
  units: z.literal("m"),
  walk_mps: z.number(),
  crew_start: z.string(), // place id: all four operatives at the getaway car at 0:00
  places: z.array(z.object({ id: z.string(), xy: XY, tags: z.array(z.string()) })),
  watchers: z.array(z.object({
    id: z.string(),
    kind: z.enum(["camera", "guard", "patrol"]),
    post: XY,
    area: z.array(XY), // what it sees
    blind_s: z.number().nullable(), // how long one blinding lasts; null = until the mission ends
    sweep: z.object({ period_s: z.number(), gap: XY }).nullable(), // patrol: blind spot in each cycle
  })),
  // Who the world already places on the block at 0:00. The crew gives them needs, prices and acts; it does not move or rename them.
  residents: z.array(z.object({ id: z.string(), name: z.string(), role: z.enum(["target", "contact", "rivals"]), place: z.string(), job: z.string(), canon: z.string() })), // canon: story facts the crew must keep
  notes: z.string(),
});

// Input: the mission template the lead producer hands the crew (GDD §09).
export const Brief = z.object({
  id: z.string(),
  district: z.string(),
  objective: z.string(),
  target: z.object({ name: z.string(), role: z.string() }),
  closingEvent: z.object({ label: z.string(), at_s: z.number() }),
  fightTrigger: z.string(),
  purse: z.number(),
  cell: z.array(Op),
  layout: z.string(),
  notes: z.string(),
});

// Systems designer → cast: people with temperament, need and priced approaches (GDD §04).
export const Approach = z.object({
  kind: ApproachKind,
  requires: z.enum(["none", "routine", "need"]),
  cost: z.number(),
  time_s: z.number(),
  trail: z.number(),
  leaves: z.string(),
});
export const Person = z.object({
  id: z.string(),
  name: z.string(),
  occupation: z.string(),
  temperament: z.enum(["Idealist", "Mercenary", "Fearful", "Loyal"]),
  need: z.string(),
  routine: z.string(),
  place: z.string(), // layout place id at 0:00
  learn: z.array(z.object({ fact: Fact, verb: z.enum(["Watch", "Listen"]), time_s: z.number() })),
  approaches: z.array(Approach),
  whenTurned: z.string(),
});
export const Cast = z.object({
  target: z.object({ id: z.string(), name: z.string(), role: z.string(), routine: z.string(), place: z.string() }),
  people: z.array(Person),
  purseLesson: z.string(),
});

// Schedule designer → schedule: timed events with reasons, never an arbitrary countdown (GDD §05).
// `where` is a place id (or "block"); an event moves its actor there. `blinds` takes a watcher off its area.
export const Schedule = z.object({
  events: z.array(z.object({ id: z.string(), at_s: z.number(), actor: z.string(), what: z.string(), where: z.string(), blinds: z.string().nullable() })),
  closingEventId: z.string(),
  security: z.array(z.object({ id: z.string(), kind: z.enum(["guard", "camera", "patrol", "response"]), behaviour: z.string() })),
  rivals: z.object({ arrive_s: z.number(), plan: z.string() }),
});

// Mission designer → mission: routes, fail conditions, fight trigger (GDD §07, §09).
export const Step = z.object({
  id: z.string(),
  op: Op,
  verb: z.string(),
  target: z.string(),
  place: z.string(),
  blinds: z.string().nullable(), // watcher id this step takes off its area
  approach: ApproachKind.nullable(),
  start_s: z.number(),
  duration_s: z.number(),
  cost: z.number(),
  trail: z.number(),
  alert: z.number(),
  after: z.string().nullable(),
  before: z.string().nullable(),
  note: z.string(),
});
export const Route = z.object({
  id: z.string(),
  kind: z.enum(["quiet", "loud"]),
  summary: z.string(),
  steps: z.array(Step),
});
export const Mission = z.object({
  title: z.string(),
  routes: z.array(Route),
  fails: z.array(z.object({ id: z.string(), condition: z.string(), reachedBy: z.string() })),
  fight: z.object({ loud: z.string(), quiet: z.string() }),
  win: z.string(),
});

// Dialogue designer → dialogue: build-time lines per person and situation (GDD §09).
export const Situation = z.enum(["Ask", "Pay", "Help", "Pressure", "refusal", "confirm_call", "questioned"]);
export const Dialogue = z.object({
  lines: z.array(z.object({ personId: z.string(), situation: Situation, line: z.string() })),
});

// Simulation engineer → verdict: each fault goes back to the agent that authored it.
// Only `block` faults stop acceptance; `note`s are logged.
export const Owner = z.enum(["systems-designer", "schedule-designer", "mission-designer", "dialogue-designer"]);
export const Verdict = z.object({
  pass: z.boolean(),
  revisions: z.array(z.object({ owner: Owner, severity: z.enum(["block", "note"]), issue: z.string(), fix: z.string() })),
  summary: z.string(),
});

export type Layout = z.infer<typeof Layout>;
export type Brief = z.infer<typeof Brief>;
export type Cast = z.infer<typeof Cast>;
export type Schedule = z.infer<typeof Schedule>;
export type Mission = z.infer<typeof Mission>;
export type Route = z.infer<typeof Route>;
export type Dialogue = z.infer<typeof Dialogue>;
export type Verdict = z.infer<typeof Verdict>;
export type Owner = z.infer<typeof Owner>;
