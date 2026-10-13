import { describe, expect, it } from "bun:test";
import { serveUi } from "../src/ui";

describe("the web UI", () => {
  it("serves the page and its stylesheet", async () => {
    const page = await serveUi("/");
    expect(page?.headers.get("content-type")).toStartWith("text/html");
    expect(await page?.text()).toContain('<script type="module" src="/app.js">');
    expect((await serveUi("/app.css"))?.headers.get("content-type")).toStartWith("text/css");
  });

  it("bundles its TypeScript into one script the browser can run", async () => {
    const res = await serveUi("/app.js");
    expect(res?.status).toBe(200);
    expect(res?.headers.get("content-type")).toStartWith("text/javascript");
    const js = (await res?.text()) ?? "";
    expect(js).toContain("/api/stream");
    expect(js).not.toMatch(/^\s*import\s/m); // nothing left for the browser to fetch
  });

  it("leaves every other path to the API", async () => {
    expect(await serveUi("/api/state")).toBeNull();
    expect(await serveUi("/main.ts")).toBeNull();
  });
});
