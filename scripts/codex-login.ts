// Signs the app's Codex workers in, under their own CODEX_HOME (data/codex), so they run apart from
// the owner's Codex setup. Usage: bun run codex:login [--device-auth]
import { mkdirSync } from "node:fs";
import { codexBinary, codexHome } from "../src/codex";

const bin = codexBinary();
if (!bin) throw new Error("codex is not installed: install the Codex CLI or the Codex desktop app");
mkdirSync(codexHome(), { recursive: true });
const proc = Bun.spawn([...bin, "login", ...process.argv.slice(2)], {
  stdio: ["inherit", "inherit", "inherit"],
  env: { ...process.env, CODEX_HOME: codexHome() },
});
process.exit(await proc.exited);
