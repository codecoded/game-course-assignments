// Strip the capstone's world manifest down to what the crew needs: named places, residents, watchers, walk speed, crew start.
// Trees, render data and the crew's staging poses are dropped.
// Usage: bun run layout [layouts/<id>.overlay.json]  →  layouts/<id>.json
import { Layout } from "./schemas";

type XY = [number, number];
type Pos = { x: number; y: number };
type Manifest = {
  buildings: ({ id: string; position: Pos })[];
  sceneObjects: ({ id: string; position: Pos })[];
  people: ({ id: string; name: string; position: Pos; behaviour?: { waypoints?: Pos[] } })[];
  vehicles: ({ id: string; position: Pos })[];
  navigation: { destinations: ({ id: string } & Pos)[] };
};
type Overlay = {
  id: string; manifest: string; walk_mps: number; crew_start: string; notes: string;
  places: { id: string; from: string; tags: string[] }[];
  residents: { id: string; from?: string; name?: string; role: string; place: string; job: string; canon: string }[];
  watchers: { id: string; kind: string; from?: string; post?: XY; area?: XY[]; radius?: number; blind_s: number | null; sweep?: unknown }[];
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const xy = (p: Pos): XY => [r1(p.x), r1(p.y)];
const octagon = ([cx, cy]: XY, r: number): XY[] =>
  Array.from({ length: 8 }, (_, i) => [r1(cx + r * Math.cos((i * Math.PI) / 4)), r1(cy + r * Math.sin((i * Math.PI) / 4))]);

const overlayPath = process.argv[2] ?? "layouts/civic-district.overlay.json";
const overlay: Overlay = await Bun.file(overlayPath).json();
const m: Manifest = await Bun.file(new URL(overlay.manifest, Bun.pathToFileURL(overlayPath))).json();

const named = new Map<string, Pos>([
  ...m.navigation.destinations.map((d) => [d.id, d] as const),
  ...m.sceneObjects.map((o) => [o.id, o.position] as const),
  ...m.buildings.map((b) => [b.id, b.position] as const),
]);
const find = (id: string) => named.get(id) ?? (() => { throw new Error(`manifest has no place "${id}"`); })();

// A patrolling person's post is the centre of their loop; a static one's is where they stand.
function postOf(id: string): XY {
  const p = m.people.find((x) => x.id === id);
  if (!p) throw new Error(`manifest has no person "${id}"`);
  const w = p.behaviour?.waypoints;
  return w?.length ? [r1(w.reduce((n, q) => n + q.x, 0) / w.length), r1(w.reduce((n, q) => n + q.y, 0) / w.length)] : xy(p.position);
}

const places = overlay.places.map((p) => ({ id: p.id, xy: xy(find(p.from)), tags: p.tags }));

// The cell starts at its car: the nearest place to the manifest's crew vehicle.
const car = m.vehicles.find((v) => v.id === overlay.crew_start)?.position ?? find(overlay.crew_start);
const d = (p: { xy: XY }) => Math.hypot(p.xy[0] - car.x, p.xy[1] - car.y);
const start = places.reduce((a, b) => (d(b) < d(a) ? b : a));
if (d(start) > 5) throw new Error(`no place within 5 m of ${overlay.crew_start}`);

// Residents keep the manifest's name; their place must be near where the manifest stands them.
const residents = overlay.residents.map((r) => {
  const p = r.from ? m.people.find((x) => x.id === r.from) : undefined;
  if (r.from && !p) throw new Error(`manifest has no person "${r.from}"`);
  const at = places.find((x) => x.id === r.place);
  if (!at) throw new Error(`resident ${r.id}: unknown place ${r.place}`);
  if (p && Math.hypot(at.xy[0] - p.position.x, at.xy[1] - p.position.y) > 10) throw new Error(`resident ${r.id}: ${r.place} is over 10 m from the manifest position`);
  return { id: r.id, name: p?.name ?? r.name!, role: r.role, place: r.place, job: r.job, canon: r.canon };
});

const layout = Layout.parse({
  id: overlay.id,
  source: overlay.manifest,
  units: "m",
  walk_mps: overlay.walk_mps,
  crew_start: start.id,
  places,
  residents,
  watchers: overlay.watchers.map((w) => {
    const post = w.post ?? postOf(w.from!);
    return { id: w.id, kind: w.kind, post, area: w.area ?? octagon(post, w.radius!), blind_s: w.blind_s, sweep: w.sweep ?? null };
  }),
  notes: overlay.notes,
});
const out = overlayPath.replace(/\.overlay\.json$/, ".json");
// One place or watcher per line: readable in review, cheap in every agent's prompt.
const lines = Object.entries(layout).map(([k, v]) =>
  Array.isArray(v) ? `"${k}": [\n${v.map((x) => `  ${JSON.stringify(x)}`).join(",\n")}\n]` : `"${k}": ${JSON.stringify(v)}`);
await Bun.write(out, `{\n${lines.join(",\n")}\n}\n`);
console.log(`${out}: ${layout.places.length} places, ${layout.residents.length} residents, ${layout.watchers.length} watchers, ${(await Bun.file(out).text()).length} bytes`);
