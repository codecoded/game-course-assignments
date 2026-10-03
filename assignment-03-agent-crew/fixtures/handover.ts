// GDD §07 Handover, hand-encoded on the capstone block (layouts/civic-district.json). The reference case: the checker must pass it (§07, §09).
import type { Pkg } from "../src/checker";
import { Layout } from "../src/schemas";
import layoutJson from "../layouts/civic-district.json";

const step = (id: string, op: string, verb: string, target: string, place: string, start_s: number, duration_s: number, x: Partial<Record<string, unknown>> = {}) =>
  ({ id, op, verb, target, place, blinds: null, approach: null, start_s, duration_s, cost: 0, trail: 0, alert: 0, after: null, before: null, note: "", ...x }) as Pkg["mission"]["routes"][number]["steps"][number];

export const handover: Pkg = {
  brief: {
    id: "handover",
    district: "Civic Records block",
    objective: "kidnapping",
    target: { name: "Councillor Vale", role: "signed the clearance order for the marked block" },
    closingEvent: { label: "rivals take Vale or the official car leaves", at_s: 480 },
    fightTrigger: "always; loud (any shot or Alert ≥ 2) → police, quiet → rival ambush",
    purse: 100000,
    cell: ["Scout", "Fixer", "Tech", "Enforcer"],
    layout: "layouts/civic-district.json",
    notes: "training mission; every verb introduced once",
  },
  layout: Layout.parse(layoutJson),
  cast: {
    target: { id: "vale", name: "Councillor Vale", role: "councillor", routine: "inside until the 5:30 chime, exits north at 5:50, at his car 6:10", place: "civic-office" },
    people: [
      {
        id: "inez", name: "Inez", occupation: "café waitress", temperament: "Fearful", need: "clear her debt",
        routine: "serves the guard his pre-shift coffee", place: "cafe-courtyard", whenTurned: "spills coffee on cue: guard walks 30 s, stays 60 s, returns 30 s",
        learn: [{ fact: "routine", verb: "Watch", time_s: 52 }, { fact: "need", verb: "Listen", time_s: 42 }],
        approaches: [
          { kind: "Ask", requires: "none", cost: 0, time_s: 25, trail: 1, leaves: "remembered refusal: later offers +$10,000, +1 T" },
          { kind: "Pay", requires: "routine", cost: 70000, time_s: 50, trail: 2, leaves: "traceable payment; neutral" },
          { kind: "Help", requires: "need", cost: 40000, time_s: 50, trail: 1, leaves: "gratitude; bravery can grow" },
          { kind: "Pressure", requires: "need", cost: 0, time_s: 35, trail: 3, leaves: "fear; resentment grows; can identify Fixer" },
        ],
      },
      {
        id: "driver", name: "Official driver", occupation: "council driver", temperament: "Mercenary", need: "cash",
        routine: "waits at the pickup", place: "official-dropoff", whenTurned: "moves pickup to the service lane, or blocks the pickup camera 2:30",
        learn: [{ fact: "need", verb: "Watch", time_s: 48 }],
        approaches: [
          { kind: "Ask", requires: "none", cost: 0, time_s: 25, trail: 1, leaves: "remembered refusal" },
          { kind: "Pay", requires: "need", cost: 40000, time_s: 50, trail: 2, leaves: "traceable payment" },
        ],
      },
    ],
    purseLesson: "pay Inez + driver = $110,000 > $100,000; help Inez + driver = $80,000 fits, so learning buys the second route",
  },
  schedule: {
    events: [
      { id: "e_start", at_s: 0, actor: "vale", what: "inside; routines run; cell at getaway car", where: "civic-office", blinds: null },
      { id: "e_rival", at_s: 190, actor: "rivals", what: "rival car parks near pickup", where: "official-dropoff", blinds: null },
      { id: "e_chime", at_s: 330, actor: "city", what: "handover chime", where: "block", blinds: null },
      { id: "e_driver_last", at_s: 340, actor: "driver", what: "last chance to turn driver", where: "official-dropoff", blinds: null },
      { id: "e_vale_exit", at_s: 350, actor: "vale", what: "exits north (service lane if driver turned)", where: "office-north", blinds: null },
      { id: "e_vale_car", at_s: 370, actor: "vale", what: "at official car", where: "official-dropoff", blinds: null },
      { id: "e_over", at_s: 480, actor: "rivals", what: "rivals take Vale or car leaves", where: "official-dropoff", blinds: null },
    ],
    closingEventId: "e_over",
    security: [
      { id: "guard", kind: "guard", behaviour: "on door; café stop pre-shift" },
      { id: "cam_entrance", kind: "camera", behaviour: "fixed visible cone on entrance" },
      { id: "patrol", kind: "patrol", behaviour: "sweep; breaks to gunfire within 30 m" },
      { id: "response", kind: "response", behaviour: "on report; district seals 2:25 after arrival" },
    ],
    rivals: { arrive_s: 190, plan: "same target; false tip sends them away 3:50; gunfire brings them within 16 s" },
  },
  mission: {
    title: "Handover",
    routes: [
      { id: "A", kind: "quiet", summary: "front door before 5:50", steps: [
        step("a1", "Scout", "Watch", "inez", "cafe-steps", 27, 52),
        step("a2", "Scout", "Listen", "inez", "cafe-steps", 79, 42),
        step("a3", "Fixer", "Turn", "inez", "cafe-courtyard", 121, 50, { approach: "Help", cost: 40000, trail: 1 }),
        step("a4", "Tech", "Loop", "entrance-camera", "control-cabinet", 36, 62, { blinds: "entrance-camera" }),
        step("a5", "Fixer", "Call", "inez", "cafe-courtyard", 171, 5, { blinds: "office-guard", note: "payoff cut: coffee spill pulls the guard (2:00 window)" }),
        step("a6", "Enforcer", "Enter", "civic-office", "office-approach", 200, 38, { note: "lands in the patrol sweep's gap" }),
        step("a7", "Enforcer", "Take", "vale", "civic-office", 238, 44, { before: "e_vale_exit" }),
      ] },
      { id: "B", kind: "quiet", summary: "pickup from 5:50", steps: [
        step("b1", "Scout", "Watch", "driver", "office-north", 45, 48),
        step("b2", "Fixer", "Turn", "driver", "official-dropoff", 93, 50, { approach: "Pay", cost: 40000, trail: 2, before: "e_driver_last" }),
        step("b3", "Scout", "Mislead", "rivals", "official-dropoff", 200, 44, { after: "e_rival" }),
        step("b4", "Fixer", "Call", "driver", "official-dropoff", 340, 5, { blinds: "pickup-camera", note: "driver parks across the pickup camera" }),
        step("b5", "Enforcer", "Enter", "official-dropoff", "official-dropoff", 350, 38, { after: "e_vale_exit" }),
        step("b6", "Enforcer", "Take", "vale", "official-dropoff", 388, 44, { after: "e_vale_car" }),
      ] },
      { id: "C", kind: "loud", summary: "shoot the guard and go in", steps: [
        step("c1", "Enforcer", "Fire", "office-guard", "office-approach", 120, 6, { trail: 2, alert: 2 }),
        step("c2", "Enforcer", "Fire", "office-guard", "office-approach", 126, 6, { trail: 2, alert: 0 }),
        step("c3", "Enforcer", "Enter", "civic-office", "office-approach", 132, 38),
        step("c4", "Enforcer", "Take", "vale", "civic-office", 170, 44),
      ] },
    ],
    fails: [
      { id: "f_killed", condition: "Vale killed", reachedBy: "c1" },
      { id: "f_car", condition: "Vale leaves in official car", reachedBy: "e_vale_car" },
      { id: "f_rivals", condition: "rivals reach Vale", reachedBy: "e_over" },
      { id: "f_seal", condition: "district seals", reachedBy: "c2" },
      { id: "f_seen", condition: "entry seen by guard, live camera or patrol", reachedBy: "a6" },
    ],
    fight: { loud: "security sides with the rivals; police from west street, 2–4 officers, seal clock running", quiet: "rivals ambush extraction; guard fights them; helped Inez warns 10 s early" },
    win: "Vale alive at the getaway car",
  },
  dialogue: {
    lines: [
      ...["Ask", "Pay", "Help", "Pressure", "refusal", "questioned", "confirm_call"].map((situation) => ({ personId: "inez", situation, line: `inez ${situation}` })),
      ...["Ask", "Pay", "refusal", "questioned", "confirm_call"].map((situation) => ({ personId: "driver", situation, line: `driver ${situation}` })),
    ] as Pkg["dialogue"]["lines"],
  },
};
