// Spatial rules against the block layout: places exist, people are where a step meets them,
// operatives can walk between steps, and covert acts on quiet routes are unseen (GDD §05, §07 fail "entry seen").
// Watchers are judged the moment an act completes, as in the prototype sim.
import type { Layout, Route } from "./schemas";
import type { Pkg, Violation } from "./checker";

type XY = [number, number];
type Watcher = Layout["watchers"][number];

const REACH_M = 15; // Watch/Listen range; witness sightline is 13 m (§05)
const COVERT = new Set(["Enter", "Take"]);
const BLIND_BY: Record<Watcher["kind"], string[]> = { camera: ["Loop", "Call"], guard: ["Call", "Mislead"], patrol: ["Reroute"] };

const end = (s: { start_s: number; duration_s: number }) => s.start_s + s.duration_s;
const dist = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function inside([x, y]: XY, poly: XY[]) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

export function checkSpatial(p: Pkg, v: Violation[]) {
  const places = new Map(p.layout.places.map((x) => [x.id, x]));
  const watchers = new Map(p.layout.watchers.map((w) => [w.id, w]));
  const known = (id: string) => places.has(id);

  // Where each actor starts, then every schedule event moves its actor.
  const home = new Map<string, string>([...p.layout.residents.map((x) => [x.id, x.place] as [string, string]),
    [p.cast.target.id, p.cast.target.place], ...p.cast.people.map((x) => [x.id, x.place] as [string, string])]);

  // The world's residents are the cast: same id, same place.
  for (const r of p.layout.residents) {
    const c = r.role === "target" ? p.cast.target : r.role === "contact" ? p.cast.people.find((x) => x.id === r.id) : undefined;
    if (r.role === "rivals") continue;
    if (!c || c.id !== r.id) v.push({ rule: "resident", owner: "systems-designer", message: `${r.role} ${r.id} (${r.name}) lives on this block but is not in the cast` });
    else if (c.place !== r.place) v.push({ rule: "resident", owner: "systems-designer", message: `${r.id}: the world puts them at ${r.place}, not ${c.place}` });
  }
  const moves = [...p.schedule.events].sort((a, b) => a.at_s - b.at_s);
  const whereAt = (actor: string, t: number) => moves.filter((e) => e.actor === actor && e.at_s <= t && known(e.where)).at(-1)?.where ?? home.get(actor);

  for (const [id, place] of home)
    if (!known(place)) v.push({ rule: "place", owner: "systems-designer", message: `${id}: place ${place} is not in layout ${p.layout.id}` });
  for (const e of p.schedule.events) {
    if (e.where !== "block" && !known(e.where)) v.push({ rule: "place", owner: "schedule-designer", message: `event ${e.id}: where ${e.where} is not a layout place (or "block")` });
    if (e.blinds && !watchers.has(e.blinds)) v.push({ rule: "blinds", owner: "schedule-designer", message: `event ${e.id}: blinds unknown watcher ${e.blinds}` });
  }
  for (const r of p.mission.routes) checkRoute(p, r, v, places, watchers, whereAt);
}

function checkRoute(p: Pkg, r: Route, v: Violation[], places: Map<string, Layout["places"][number]>,
  watchers: Map<string, Watcher>, whereAt: (actor: string, t: number) => string | undefined) {
  const at = `route ${r.id}`;
  const xy = (id: string | undefined) => (id ? places.get(id)?.xy as XY | undefined : undefined);

  for (const s of r.steps) {
    const where = `${at} step ${s.id}`;
    const here = xy(s.place);
    if (!here) { v.push({ rule: "place", owner: "mission-designer", message: `${where}: place ${s.place} is not in the layout` }); continue; }

    // The person a step acts on must be there (Turn, Take) or within reach (Watch, Listen).
    const them = whereAt(s.target, s.start_s);
    if ((s.verb === "Turn" || s.verb === "Take") && them && them !== s.place)
      v.push({ rule: "meet", owner: "mission-designer", message: `${where}: ${s.target} is at ${them} at ${s.start_s}s, not ${s.place}` });
    if ((s.verb === "Watch" || s.verb === "Listen") && xy(them) && dist(here, xy(them)!) > REACH_M)
      v.push({ rule: "reach", owner: "mission-designer", message: `${where}: ${s.target} at ${them} is ${Math.round(dist(here, xy(them)!))} m away (max ${REACH_M} m)` });
    if ((s.verb === "Loop" || s.verb === "Reroute") && !places.get(s.place)!.tags.includes("device"))
      v.push({ rule: "device", owner: "mission-designer", message: `${where}: ${s.verb} needs a device place (tag "device")` });

    if (s.blinds) {
      const w = watchers.get(s.blinds);
      if (!w) v.push({ rule: "blinds", owner: "mission-designer", message: `${where}: blinds unknown watcher ${s.blinds}` });
      else if (!BLIND_BY[w.kind].includes(s.verb))
        v.push({ rule: "blinds", owner: "mission-designer", message: `${where}: ${s.verb} cannot blind a ${w.kind} (use ${BLIND_BY[w.kind].join(" or ")})` });
    }

    // Quiet routes: nothing that sees the place may be watching when a covert act completes.
    if (r.kind === "quiet" && COVERT.has(s.verb) && !places.get(s.place)!.tags.includes("interior"))
      for (const w of watchers.values())
        if (inside(here, w.area as XY[]) && watching(p, r, w, end(s)))
          v.push({ rule: "seen", owner: "mission-designer", message: `${where}: ${s.verb} at ${s.place} completes at ${end(s)}s in view of ${w.id}; blind it first (${BLIND_BY[w.kind].join("/")} or a schedule event)` });
  }

  // Walking: every operative leaves the getaway car at 0:00, and needs time to cover each distance between outdoor steps.
  const car = { id: "start", place: p.layout.crew_start, start_s: 0, duration_s: 0 };
  for (const op of new Set(r.steps.map((s) => s.op))) {
    const mine = [car, ...r.steps.filter((s) => s.op === op).sort((a, b) => a.start_s - b.start_s)];
    for (let i = 1; i < mine.length; i++) {
      const [a, b] = [mine[i - 1]!, mine[i]!];
      const [pa, pb] = [places.get(a.place), places.get(b.place)];
      if (!pa || !pb || pa.tags.includes("interior") || pb.tags.includes("interior")) continue;
      const need = Math.ceil(dist(pa.xy as XY, pb.xy as XY) / p.layout.walk_mps);
      if (b.start_s - end(a) < need)
        v.push({ rule: "walk", owner: "mission-designer", message: `${at}: ${op} needs ${need}s to walk ${a.place} → ${b.place} but has ${b.start_s - end(a)}s between ${a.id} and ${b.id}` });
    }
  }
}

// Is this watcher seeing its area at time t? Not if it's in its sweep gap or blinded by an earlier step or event.
function watching(p: Pkg, r: Route, w: Watcher, t: number) {
  if (w.sweep) {
    const phase = t % w.sweep.period_s;
    if (phase >= w.sweep.gap[0] && phase <= w.sweep.gap[1]) return false;
  }
  const lasts = (from: number, until = Infinity) => from <= t && t <= until && (w.blind_s === null || t <= from + w.blind_s);
  // A Loop is tethered (prototype: the Tech must stay connected): it holds until the Tech's next step somewhere else.
  const tether = (s: Route["steps"][number]) =>
    s.verb === "Loop" ? Math.min(Infinity, ...r.steps.filter((x) => x.op === s.op && x.start_s >= end(s) && x.place !== s.place).map((x) => x.start_s)) : Infinity;
  const byStep = r.steps.some((s) => s.blinds === w.id && BLIND_BY[w.kind].includes(s.verb) && lasts(end(s), tether(s)));
  const byEvent = p.schedule.events.some((e) => e.blinds === w.id && lasts(e.at_s));
  return !byStep && !byEvent;
}
