import { expect, test } from "bun:test";
import type { Usage } from "../src/claude";
import { summarize } from "../src/usage";

test("totals tokens per agent and overall", () => {
  const u = (agent: Usage["agent"], i: number, o: number): Usage => ({ agent, seconds: 10, costUsd: 0.1, inputTokens: i, outputTokens: o });
  const s = summarize([u("systems-designer", 100, 10), u("simulation-engineer", 500, 50), u("systems-designer", 200, 20)]);
  expect(s.byAgent["systems-designer"]).toMatchObject({ calls: 2, inputTokens: 300, outputTokens: 30, totalTokens: 330 });
  expect(s.byAgent["simulation-engineer"]?.totalTokens).toBe(550);
  expect(s.overall).toMatchObject({ calls: 3, inputTokens: 800, outputTokens: 80, totalTokens: 880, seconds: 30 });
});
