import { describe, expect, test } from "bun:test";
import { check } from "../src/checker";
import { handover } from "../fixtures/handover";

const clone = () => structuredClone(handover);
const rules = (p = handover) => check(p).violations.map((v) => v.rule);

describe("simulation engineer checker", () => {
  test("passes the Handover reference case (GDD §07)", () => {
    const r = check(handover);
    expect(r.violations).toEqual([]);
    expect(r.pass).toBe(true);
  });

  test("rejects a verb the operative doesn't have", () => {
    const p = clone();
    p.mission.routes[0]!.steps[0]!.verb = "Hack";
    expect(rules(p)).toContain("verb");
  });

  test("rejects a turn before the need is known", () => {
    const p = clone();
    p.mission.routes[0]!.steps.splice(1, 1); // drop Listen
    expect(rules(p)).toContain("knowledge");
  });

  test("rejects a price that doesn't match the systems designer's table", () => {
    const p = clone();
    p.mission.routes[0]!.steps[2]!.cost = 10000;
    expect(rules(p)).toContain("price");
  });

  test("rejects an essential contact", () => {
    const p = clone();
    const b = p.mission.routes[1]!;
    b.steps[0]!.target = "inez";
    b.steps.splice(1, 0, { ...p.mission.routes[0]!.steps[1]!, id: "b1b", start_s: 48 });
    b.steps[2] = { ...p.mission.routes[0]!.steps[2]!, id: "b2", start_s: 95 };
    expect(rules(p)).toContain("essential");
  });

  test("rejects a loud route that is no dearer in Trail", () => {
    const p = clone();
    p.mission.routes[2]!.steps = p.mission.routes[2]!.steps.filter((s) => s.verb !== "Fire");
    expect(rules(p)).toContain("loud-cost");
  });

  test("gunfire is one incident: Alert 2 for the firefight, +2 Trail per shot", () => {
    const p = clone();
    p.mission.routes[2]!.steps[0]!.alert = 1; // firefight now totals Alert 1
    expect(rules(p)).toContain("fire-cost");
  });

  test("rejects a route over the purse", () => {
    const p = clone();
    p.mission.routes[0]!.steps[2]!.approach = "Pay";
    p.mission.routes[0]!.steps[2]!.cost = 70000;
    p.brief.purse = 60000;
    expect(rules(p)).toContain("purse");
  });

  test("after/before can name a step in the same route", () => {
    const p = clone();
    p.mission.routes[0]!.steps[5]!.after = "a5"; // Enter after the call
    expect(check(p).violations).toEqual([]);
    p.mission.routes[0]!.steps[5]!.start_s = 152; // before the call ends at 155
    expect(rules(p)).toContain("timing");
  });

  test("rejects missing dialogue", () => {
    const p = clone();
    p.dialogue.lines = p.dialogue.lines.filter((l) => l.situation !== "confirm_call");
    expect(rules(p)).toContain("dialogue");
  });
  test("rejects a cast that drops or moves the block's residents", () => {
    const p = clone();
    p.cast.people[0]!.place = "fountain"; // the world has Inez at the café
    expect(rules(p)).toContain("resident");
    p.cast.people.splice(0, 1);
    expect(rules(p)).toContain("resident");
  });

  test("rejects an unknown place", () => {
    const p = clone();
    p.mission.routes[0]!.steps[0]!.place = "nowhere";
    expect(rules(p)).toContain("place");
  });

  test("rejects turning someone where they aren't", () => {
    const p = clone();
    p.mission.routes[0]!.steps[2]!.place = "fountain";
    expect(rules(p)).toContain("meet");
  });

  test("rejects a quiet entry in view of a live camera", () => {
    const p = clone();
    p.mission.routes[0]!.steps[3]!.blinds = null; // loop no longer blinds the entrance camera
    expect(rules(p)).toContain("seen");
  });

  test("a Loop holds only while the Tech stays at the cabinet", () => {
    const p = clone();
    const a = p.mission.routes[0]!;
    a.steps.push({ ...a.steps[3]!, id: "a8", verb: "Reroute", target: "patrol-bot", blinds: "patrol-bot", start_s: 150, duration_s: 45 });
    expect(check(p).violations).toEqual([]); // rerouting from the same cabinet keeps the loop (prototype)
    a.steps.at(-1)!.place = "south-walkway"; // the Tech walks off at 150: the camera is live again when the Enter completes at 238
    a.steps.at(-1)!.verb = "Loop";
    a.steps.at(-1)!.blinds = null;
    expect(rules(p)).toContain("seen");
  });

  test("rejects a pickup in view of the pickup camera", () => {
    const p = clone();
    p.mission.routes[1]!.steps[3]!.blinds = null; // driver no longer parks across the camera
    expect(rules(p)).toContain("seen");
  });

  test("rejects a quiet entry while the patrol sweep covers the door", () => {
    const p = clone();
    p.mission.routes[0]!.steps[5]!.start_s = 180; // completes at 218 s, phase 18 of the 100 s sweep
    expect(rules(p)).toContain("seen");
  });

  test("operatives start at the getaway car", () => {
    const p = clone();
    p.mission.routes[0]!.steps[0]!.start_s = 10; // car → café steps is 27 s on foot
    expect(rules(p)).toContain("walk");
  });

  test("rejects an operative who can't walk there in time", () => {
    const p = clone();
    p.mission.routes[1]!.steps[2]!.start_s = 95; // Scout office-north → official-dropoff needs 11 s after Watch ends at 93 s
    p.mission.routes[1]!.steps[2]!.after = null;
    expect(rules(p)).toContain("walk");
  });
});
