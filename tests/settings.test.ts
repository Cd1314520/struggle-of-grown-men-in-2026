import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { config } from "../src/config";
import { setSetting, settingsState } from "../src/settings";

function withLocal(text: string, test: (file: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "auto-apply-settings-"));
  const file = join(dir, "config.local.yml");
  const before = structuredClone(config);
  try {
    writeFileSync(file, text);
    test(file);
  } finally {
    Object.assign(config, before);
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("settings changed in the app", () => {
  it("write config.local.yml, keeping its comments, and take effect without a restart", () => {
    withLocal("# mine\nmailbox: me@example.com # the inbox\n", file => {
      expect(setSetting(["schedule", "scanMinutes"], 45, file)).toEqual({ restart: false });
      setSetting(["boards", "queries"], ["data engineer", "ml engineer"], file);
      const text = readFileSync(file, "utf8");
      expect(text).toContain("mailbox: me@example.com # the inbox");
      expect(YAML.parse(text)).toEqual({ mailbox: "me@example.com", schedule: { scanMinutes: 45 }, boards: { queries: ["data engineer", "ml engineer"] } });
      expect(config.schedule.scanMinutes).toBe(45);
      expect(config.schedule.trackMinutes).toBe(120);
      expect(config.boards?.queries).toEqual(["data engineer", "ml engineer"]);
      expect(settingsState(file).local).toEqual(YAML.parse(text));
    });
  });

  it("hand a setting back to config.yml on reset, dropping a section left empty", () => {
    withLocal("schedule:\n  scanMinutes: 45\n", file => {
      config.schedule.scanMinutes = 45;
      setSetting(["schedule", "scanMinutes"], undefined, file);
      expect(YAML.parse(readFileSync(file, "utf8")) ?? {}).toEqual({});
      expect(config.schedule.scanMinutes).toBe(30);
      setSetting(["schedule", "scanMinutes"], 50, file);
      expect(readFileSync(file, "utf8")).toBe("schedule:\n  scanMinutes: 50\n");
    });
  });

  it("set a section that config.yml leaves out", () => {
    withLocal("", file => {
      const live: { retention?: unknown } = config;
      delete live.retention;
      setSetting(["retention", "chatterDays"], 7, file);
      expect(live.retention).toEqual({ chatterDays: 7 });
    });
  });

  it("save one read only at start for the next restart", () => {
    withLocal("", file => {
      const port = config.port;
      expect(setSetting(["port"], 9000, file)).toEqual({ restart: true });
      expect(config.port).toBe(port);
      expect(settingsState(file).values["port"]).toBe(9000);
      expect(settingsState(file).pending).toEqual(["port"]);
      setSetting(["port"], undefined, file);
      expect(settingsState(file).pending).toEqual([]);
    });
  });

  it("refuse a value the app could not start with, leaving the file alone", () => {
    withLocal("mailbox: me@example.com\n", file => {
      expect(() => setSetting(["boards", "distance"], "far", file)).toThrow("boards.distance");
      expect(() => setSetting(["fillPauseSeconds"], [300, 60], file)).toThrow("fillPauseSeconds");
      expect(() => setSetting(["schedule", "everyHour"], true, file)).toThrow("not a setting");
      expect(readFileSync(file, "utf8")).toBe("mailbox: me@example.com\n");
      expect(config.boards?.distance).toBe(25);
    });
  });
});
