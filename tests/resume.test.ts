import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileWorking, MAIN, PDF_NAME } from "../src/resume";

// A worker sandbox may not reach typst (Codex on Windows), so the host compiles a job's copy itself.
describe("compileWorking", () => {
  it("compiles the job's resume to the stock PDF name", () => {
    const dir = mkdtempSync(join(tmpdir(), "compile-"));
    writeFileSync(join(dir, MAIN), "Hello");
    expect(compileWorking(dir)).toBeNull();
    expect(existsSync(join(dir, PDF_NAME))).toBe(true);
  });

  it("returns typst's error for a resume that does not compile", () => {
    const dir = mkdtempSync(join(tmpdir(), "compile-"));
    writeFileSync(join(dir, MAIN), "#let x = (");
    expect(compileWorking(dir)).toMatch(/error/i);
    expect(existsSync(join(dir, PDF_NAME))).toBe(false);
  });
});
