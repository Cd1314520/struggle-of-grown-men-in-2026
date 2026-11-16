import { describe, expect, it } from "bun:test";
import { insertJob, lastEventId, logEvent } from "../src/db";
import { overStepCap } from "../src/fill";
import { authorizeSubmit } from "../src/fill-state";

const lastEvent = lastEventId;
let n = 0;
const job = () => {
  const id = insertJob({
    url: `https://example.com/steps/${++n}`,
    source: "greenhouse",
    company: `Steps ${n}`,
    title: "Engineer",
    location: "Austin, TX",
    description: null,
  });
  if (!id) throw new Error("job not inserted");
  return id;
};

describe("the fill step cap", () => {
  it("counts only this fill's own browser steps since it started", () => {
    const id = job();
    const other = job();
    logEvent("step", "browser click", id, "fill"); // before this fill started
    const start = lastEvent();
    for (let i = 0; i < 3; i++) logEvent("step", "browser click", id, "fill");
    logEvent("agent", "thinking", id, "fill");
    logEvent("step", "browser click", other, "fill");
    logEvent("step", "web search", id, "prep");
    expect(overStepCap(id, start, 4)).toBeNull();
    expect(overStepCap(id, start, 3)).toBe(3);
  });

  it("leaves a fill alone once its final submit is authorized", () => {
    const id = job();
    const start = lastEvent();
    for (let i = 0; i < 5; i++) logEvent("step", "browser click", id, "fill");
    expect(overStepCap(id, start, 5)).toBe(5);
    authorizeSubmit(id);
    expect(overStepCap(id, start, 5)).toBeNull();
  });
});
