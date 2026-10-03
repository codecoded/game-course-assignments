// Runs one crew agent through headless Claude Code: `claude -p --agent <name>`.
// The agent's role card (.claude/agents/<name>.md) and CLAUDE.md (§01 core) load automatically;
// the prompt is the ADD layer-4 objective. Output is schema-constrained and re-validated here.
import { z } from "zod";
import type { Owner } from "./schemas";

export type AgentName = Owner | "simulation-engineer";
export type Usage = { agent: AgentName; seconds: number; costUsd: number; inputTokens: number; outputTokens: number };

const EFFORT: Record<AgentName, string> = {
  "systems-designer": "medium", "schedule-designer": "medium", "mission-designer": "high", "dialogue-designer": "low", "simulation-engineer": "high",
};
const TRIES = 2;

function jsonSchema(schema: z.ZodType) {
  const { $schema: _, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return JSON.stringify(rest);
}

export async function runAgent<T>(agent: AgentName, prompt: string, schema: z.ZodType<T>, usage: Usage[]): Promise<T> {
  let lastError = "";
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    const t0 = Date.now();
    const proc = Bun.spawn(
      ["claude", "-p", "--agent", agent, "--output-format", "json", "--json-schema", jsonSchema(schema),
        "--effort", EFFORT[agent], "--no-session-persistence"],
      { stdin: new Blob([prompt]), stdout: "pipe", stderr: "pipe" },
    );
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    await proc.exited;

    let res: Record<string, any>;
    try { res = JSON.parse(out); } catch { lastError = `unparseable CLI output: ${(err || out).slice(0, 300)}`; continue; }
    const u = res.usage ?? {};
    usage.push({
      agent,
      seconds: Math.round((Date.now() - t0) / 1000),
      costUsd: res.total_cost_usd ?? 0,
      inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      outputTokens: u.output_tokens ?? 0,
    });
    if (res.is_error) { lastError = `agent error: ${String(res.result).slice(0, 300)}`; continue; }

    const parsed = schema.safeParse(res.structured_output);
    if (parsed.success) return parsed.data;
    lastError = `schema mismatch: ${parsed.error.message.slice(0, 300)}`;
  }
  throw new Error(`${agent} failed after ${TRIES} tries — ${lastError}`);
}
