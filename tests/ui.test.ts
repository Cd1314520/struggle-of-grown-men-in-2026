import { describe, expect, it } from "bun:test";
import { serveUi } from "../src/ui";

describe("the web UI", () => {
  it("serves the page, which loads the bundle and the stylesheet", async () => {
    const page = await serveUi("/");
    expect(page?.headers.get("content-type")).toStartWith("text/html");
    const html = (await page?.text()) ?? "";
    expect(html).toContain('<script type="module" src="/assets/app.js">');
    expect(html).toContain('href="/assets/app.css"');
  });

  it("bundles the app into one script the browser can run, and its Tailwind stylesheet", async () => {
    const res = await serveUi("/assets/app.js");
    expect(res?.status).toBe(200);
    expect(res?.headers.get("content-type")).toStartWith("text/javascript");
    const js = (await res?.text()) ?? "";
    expect(js).toContain("/api/stream");
    expect(js).not.toMatch(/^\s*import\s/m); // nothing left for the browser to fetch
    const css = await serveUi("/assets/app.css");
    expect(css?.headers.get("content-type")).toStartWith("text/css");
    expect(await css?.text()).toContain("--color-accent");
  }, 30_000);

  it("serves the fonts it ships with", async () => {
    const font = await serveUi("/assets/fonts/inter.woff2");
    expect(font?.headers.get("content-type")).toBe("font/woff2");
    expect((await font?.arrayBuffer())?.byteLength).toBeGreaterThan(10_000);
  });

  it("leaves every other path to the API", async () => {
    expect(await serveUi("/api/state")).toBeNull();
    expect(await serveUi("/app.tsx")).toBeNull();
    expect(await serveUi("/assets/nothing.js")).toBeNull();
  });
});
