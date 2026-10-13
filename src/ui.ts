// Serves the web UI in ui/: the page, its stylesheet, and its TypeScript bundled for the browser.
// There is no build step. The bundle is made on first request and again whenever a source file changes,
// so a page reload is enough after editing anything in ui/.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./config";

const UI = process.env["AUTO_APPLY_UI"] ?? join(ROOT, "ui");
const STATIC: Record<string, string> = { "/": "index.html", "/app.css": "app.css" };

// The newest change to any script the bundle is made from.
const sourcesChanged = () =>
  Math.max(
    ...readdirSync(UI, { recursive: true, encoding: "utf8" })
      .filter(f => f.endsWith(".ts"))
      .map(f => statSync(join(UI, f)).mtimeMs),
  );

let bundle: { at: number; js: string } | null = null;
async function script() {
  const at = sourcesChanged();
  if (bundle?.at === at) return bundle.js;
  const built = await Bun.build({ entrypoints: [join(UI, "main.ts")], target: "browser", sourcemap: "inline" });
  const out = built.outputs[0];
  if (!out) throw new Error("the UI bundle came out empty");
  bundle = { at, js: await out.text() };
  return bundle.js;
}

// The response for a path the UI owns, or null when the path is not one of them.
export async function serveUi(path: string): Promise<Response | null> {
  const file = STATIC[path];
  if (file) return new Response(Bun.file(join(UI, file)));
  if (path !== "/app.js") return null;
  try {
    return new Response(await script(), { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" } });
  } catch (err) {
    // A script that does not compile: say why where the developer will look.
    const why = err instanceof AggregateError ? err.errors.map(String).join("\n") : String(err);
    console.error(`UI bundle failed:\n${why}`);
    return new Response(`console.error(${JSON.stringify(`UI bundle failed:\n${why}`)});`, {
      status: 500,
      headers: { "content-type": "text/javascript; charset=utf-8" },
    });
  }
}
