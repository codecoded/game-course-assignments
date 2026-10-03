// Self-contained HTML dossier of a generated mission, for review before it goes to Unity.
import type { CheckResult, Pkg } from "./checker";
import type { Verdict } from "./schemas";
import { formatTokens, type Totals, type UsageSummary } from "./usage";

const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const money = (n: number) => `$${n.toLocaleString("en-GB")}`;
const table = (head: string[], rows: unknown[][]) =>
  `<table><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</table>`;

const tokenRow = (name: string, t: Totals) =>
  [name, t.calls, formatTokens(t.inputTokens), formatTokens(t.outputTokens), formatTokens(t.totalTokens), `${t.seconds}s`];

export function renderBriefing(p: Pkg, report: CheckResult, verdict: Verdict, accepted: boolean, tokens: UsageSummary): string {
  const { brief, cast, schedule, mission, dialogue } = p;
  const routes = mission.routes.map((r) => {
    const st = report.routes.find((s) => s.id === r.id)!;
    return `<h3>Route ${esc(r.id)} · ${esc(r.kind)} — ${esc(r.summary)}</h3>
<p class="stats">${money(st.cost)} · +${st.trail} T · Alert ${st.alert} · done ${clock(st.finish_s)} · contacts: ${esc(st.contacts.join(", ") || "none")}</p>
${table(["m:ss", "op", "verb", "target", "place", "time", "$", "T", "A", "note"], r.steps.map((s) => [clock(s.start_s), s.op, s.verb + (s.approach ? ` (${s.approach})` : ""), s.target + (s.blinds ? ` · blinds ${s.blinds}` : ""), s.place, `${s.duration_s}s`, s.cost ? money(s.cost) : "", s.trail || "", s.alert || "", s.note]))}`;
  }).join("\n");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(mission.title)} · dossier</title>
<style>
:root{--bg:#f4ecdc;--ink:#1d2a2e;--teal:#1f7a78;--coral:#e0664f;--line:#d6c9ad;--card:#fbf6ec}
@media (prefers-color-scheme:dark){:root{--bg:#141b1d;--ink:#ece3d0;--teal:#5fc2bd;--coral:#f08a74;--line:#2c393c;--card:#1b2427}}
body{background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,sans-serif;margin:0;padding:24px 16px}
main{max-width:1000px;margin:auto}h1{color:var(--teal);margin:0}h2{border-bottom:2px solid var(--coral);padding-bottom:4px;margin-top:32px}
.badge{display:inline-block;padding:2px 10px;border-radius:99px;color:#fff;background:${accepted ? "var(--teal)" : "var(--coral)"}}
.stats{font-weight:600;color:var(--teal)}table{border-collapse:collapse;width:100%;background:var(--card);margin:8px 0;display:block;overflow-x:auto}
th,td{border:1px solid var(--line);padding:4px 8px;text-align:left;vertical-align:top}th{background:var(--line)}
</style></head><body><main>
<h1>${esc(mission.title)}</h1>
<p><span class="badge">${accepted ? "ACCEPTED" : "NOT ACCEPTED"}</span> ${esc(brief.district)} · ${esc(brief.objective)} · target ${esc(brief.target.name)} · purse ${money(brief.purse)} · closes ${clock(brief.closingEvent.at_s)} (${esc(brief.closingEvent.label)})</p>
<p><b>Block:</b> ${esc(p.layout.id)} · ${p.layout.places.length} places · watchers: ${esc(p.layout.watchers.map((w) => w.id).join(", "))} · target starts at ${esc(cast.target.place)}</p>
<p><b>Win:</b> ${esc(mission.win)}<br><b>Purse lesson:</b> ${esc(cast.purseLesson)}</p>
<h2>People (systems designer)</h2>
${table(["id", "name", "job", "place", "temperament", "need", "learn", "approaches", "when turned"], cast.people.map((x) => [x.id, x.name, x.occupation, x.place, x.temperament, x.need,
    x.learn.map((l) => `${l.fact}: ${l.verb} ${l.time_s}s`).join("; "), x.approaches.map((a) => `${a.kind} ${money(a.cost)} ${a.time_s}s +${a.trail}T`).join("; "), x.whenTurned]))}
<h2>Clock (schedule designer)</h2>
${table(["m:ss", "who", "what", "where"], schedule.events.map((e) => [clock(e.at_s), e.actor, e.what + (e.id === schedule.closingEventId ? " ◆ closing" : "") + (e.blinds ? ` · blinds ${e.blinds}` : ""), e.where]))}
<p>Rivals arrive ${clock(schedule.rivals.arrive_s)}: ${esc(schedule.rivals.plan)}</p>
<h2>Routes (mission designer)</h2>${routes}
<h2>Fails &amp; fight</h2>
${table(["fail", "reached by"], mission.fails.map((f) => [f.condition, f.reachedBy]))}
<p><b>Loud fight:</b> ${esc(mission.fight.loud)}<br><b>Quiet fight:</b> ${esc(mission.fight.quiet)}</p>
<h2>Lines (dialogue designer)</h2>
${table(["person", "situation", "line"], dialogue.lines.map((l) => [l.personId, l.situation, l.line]))}
<h2>Check (simulation engineer)</h2>
<p>Checker: ${report.pass ? "pass" : `${report.violations.length} violations`} · simulation engineer: ${esc(verdict.summary)}</p>
${report.violations.length ? table(["rule", "owner", "message"], report.violations.map((v) => [v.rule, v.owner, v.message])) : ""}
${verdict.revisions.length ? table(["owner", "severity", "issue", "fix"], verdict.revisions.map((r) => [r.owner, r.severity, r.issue, r.fix])) : ""}
<h2>Tokens</h2>
${table(["agent", "calls", "input", "output", "total", "time"], [...Object.entries(tokens.byAgent).map(([a, t]) => tokenRow(a, t!)), tokenRow("overall", tokens.overall)])}
</main></body></html>`;
}
