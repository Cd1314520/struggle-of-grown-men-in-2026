// Serves the web UI in ui/: a React app bundled for the browser, with its Tailwind stylesheet and fonts.
// There is no build step. The bundle is made on first request and again whenever a source file changes,
// so a page reload is enough after editing anything in ui/.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import tailwind from "bun-plugin-tailwind";
import { ROOT } from "./config";

const UI = process.env["AUTO_APPLY_UI"] ?? join(ROOT, "ui");
const MODULES = join(ROOT, "node_modules");
// Fonts ship with the app: the page must look the same with no internet, and on a machine without Inter.
const FONTS: Record<string, string> = {
  "/assets/fonts/inter.woff2": join(MODULES, "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2"),
  "/assets/fonts/geist-mono.woff2": join(MODULES, "@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2"),
};
const SOURCE = /\.(tsx?|css)$/;
// React's development build checks every render and runs several times slower. Only test and development
// runs (the verification instance among them) bundle it, for its warnings.
const DEV = process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development";

// The newest change to any file the bundle is made from.
const sourcesChanged = () =>
  Math.max(
    ...readdirSync(UI, { recursive: true, encoding: "utf8" })
      .filter(f => SOURCE.test(f))
      .map(f => statSync(join(UI, f)).mtimeMs),
  );

interface Bundle {
  at: number;
  files: Map<string, { body: string; type: string }>;
}
let bundle: Bundle | null = null;
let building: Promise<Bundle> | null = null;
function build(): Promise<Bundle> {
  const at = sourcesChanged();
  if (bundle?.at === at) return Promise.resolve(bundle);
  building ??= (async () => {
    const built = await Bun.build({
      entrypoints: [join(UI, "app.tsx")],
      target: "browser",
      plugins: [tailwind],
      minify: !DEV,
      define: { "process.env.NODE_ENV": JSON.stringify(DEV ? "development" : "production") },
      sourcemap: "linked",
      naming: { entry: "[name].[ext]", asset: "[name].[ext]" },
    });
    const files = new Map<string, { body: string; type: string }>();
    for (const out of built.outputs) files.set(`/assets/${out.path.replace(/^\.\//, "")}`, { body: await out.text(), type: out.type });
    if (!files.has("/assets/app.js")) throw new Error("the UI bundle came out empty");
    bundle = { at, files };
    return bundle;
  })().finally(() => {
    building = null;
  });
  return building;
}

// The response for a path the UI owns, or null when the path is not one of them.
export async function serveUi(path: string): Promise<Response | null> {
  if (path === "/") return new Response(Bun.file(join(UI, "index.html")), { headers: { "cache-control": "no-cache" } });
  const font = FONTS[path];
  if (font) return new Response(Bun.file(font), { headers: { "content-type": "font/woff2", "cache-control": "max-age=604800, immutable" } });
  if (!path.startsWith("/assets/")) return null;
  try {
    const file = (await build()).files.get(path);
    return file ? new Response(file.body, { headers: { "content-type": file.type, "cache-control": "no-cache" } }) : null;
  } catch (err) {
    // A script that does not compile: say why where the developer will look.
    const why = err instanceof AggregateError ? err.errors.map(String).join("\n") : String(err);
    console.error(`UI bundle failed:\n${why}`);
    if (!path.endsWith(".js")) return new Response("", { status: 500 });
    return new Response(`document.body.textContent = ${JSON.stringify(`UI bundle failed:\n${why}`)};`, {
      status: 500,
      headers: { "content-type": "text/javascript; charset=utf-8" },
    });
  }
}
