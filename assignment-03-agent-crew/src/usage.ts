// Token, time and cost totals per agent and for the whole run.
import type { AgentName, Usage } from "./claude";

export type Totals = { calls: number; inputTokens: number; outputTokens: number; totalTokens: number; seconds: number; costUsd: number };
export type UsageSummary = { byAgent: Partial<Record<AgentName, Totals>>; overall: Totals };

const zero = (): Totals => ({ calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, seconds: 0, costUsd: 0 });

function add(t: Totals, u: Usage) {
  t.calls += 1;
  t.inputTokens += u.inputTokens;
  t.outputTokens += u.outputTokens;
  t.totalTokens += u.inputTokens + u.outputTokens;
  t.seconds += u.seconds;
  t.costUsd = Math.round((t.costUsd + u.costUsd) * 10000) / 10000;
}

export function summarize(usage: Usage[]): UsageSummary {
  const byAgent: UsageSummary["byAgent"] = {};
  const overall = zero();
  for (const u of usage) {
    add((byAgent[u.agent] ??= zero()), u);
    add(overall, u);
  }
  return { byAgent, overall };
}

export const formatTokens = (n: number) => n.toLocaleString("en-GB");
