import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { configProblems } from "../src/config-check";

const shipped = () => YAML.parse(readFileSync(join(import.meta.dir, "../config.yml"), "utf8")) as Record<string, Record<string, unknown>>;
// The shipped file with one thing changed.
const withChange = (change: (config: Record<string, Record<string, unknown>>) => void) => {
  const config = shipped();
  change(config);
  return configProblems(config);
};

describe("config.yml", () => {
  it("is valid as shipped", () => {
    expect(configProblems(shipped())).toEqual([]);
  });

  it("names a mistyped key instead of ignoring it", () => {
    expect(
      withChange(c => {
        c["autoAply"] = c["autoApply"] ?? {};
        delete c["autoApply"];
      })[0],
    ).toStartWith("autoAply: not a setting this app knows");
    expect(
      withChange(c => {
        (c["limits"] ??= {})["applyPerDy"] = 5;
      }),
    ).toEqual(["limits.applyPerDy: not a setting this app knows (known: prepPerDay, applyPerDay, locatePerDay, applySpreadHours)"]);
    expect(
      withChange(c => {
        (c["autoApply"] ??= {})["minscore"] = 70;
      })[0],
    ).toStartWith("autoApply.minscore: not a setting this app knows");
  });

  it("refuses values of the wrong kind, by path", () => {
    expect(
      withChange(c => {
        (c["limits"] ??= {})["applyPerDay"] = "50";
      }),
    ).toEqual(['limits.applyPerDay: expected a whole number of at least 0, got "50"']);
    expect(
      withChange(c => {
        (c["schedule"] ??= {})["scanMinutes"] = -1;
      }),
    ).toEqual(["schedule.scanMinutes: expected a number of at least 0, got -1"]);
    expect(
      withChange(c => {
        (c as Record<string, unknown>)["phase"] = "production";
      }),
    ).toEqual(['phase: expected one of practice, real, got "production"']);
    expect(
      withChange(c => {
        (c as Record<string, unknown>)["confirmBeforeSubmit"] = "yes";
      }),
    ).toEqual(['confirmBeforeSubmit: expected true or false, got "yes"']);
    expect(
      withChange(c => {
        (c["autoApply"] ??= {})["phases"] = ["practice", "live"];
      }),
    ).toEqual(['autoApply.phases[1]: expected one of practice, real, got "live"']);
    expect(
      withChange(c => {
        (c["chrome"] ??= {})["display"] = "99";
      }),
    ).toEqual(['chrome.display: expected an X display such as ":99", got "99"']);
    expect(
      withChange(c => {
        (c["concurrency"] ??= {})["fill"] = 0;
      }),
    ).toEqual(["concurrency.fill: expected a whole number of at least 1, got 0"]);
    expect(
      withChange(c => {
        (c as Record<string, unknown>)["publicUrl"] = "my-machine.example:8787";
      }),
    ).toEqual(['publicUrl: expected an http(s) URL, got "my-machine.example:8787"']);
  });

  it("says what is missing, and reports every problem at once", () => {
    expect(
      withChange(c => {
        delete c["limits"];
      }),
    ).toEqual(["limits: expected a section with keys, got missing"]);
    expect(
      withChange(c => {
        delete (c["models"] ??= {})["fill"];
      }),
    ).toEqual(["models.fill: expected non-empty text, got missing"]);
    const several = withChange(c => {
      (c["limits"] ??= {})["prepPerDay"] = 1.5;
      (c as Record<string, unknown>)["fillPauseSeconds"] = [240, 60];
      (c["questionDigest"] ??= {})["timeZone"] = "Mars/Olympus";
      (c["questionDigest"] ??= {})["time"] = "9am";
    });
    expect(several).toEqual([
      "limits.prepPerDay: expected a whole number of at least 0, got 1.5",
      'questionDigest.time: expected HH:mm in 24-hour local time, got "9am"',
      "fillPauseSeconds: the shortest pause (240) is longer than the longest (60)",
      'questionDigest.timeZone: not an IANA time zone: "Mars/Olympus"',
    ]);
    expect(configProblems(null)).toEqual(["config.yml: expected a section with keys, got null"]);
  });

  it("leaves optional sections optional and lets feeds carry their own parameters", () => {
    const optional = new Set(["autoApply", "questionDigest", "feeds", "boards", "publicUrl", "vncUrl", "mailbox", "retention"]);
    expect(configProblems(Object.fromEntries(Object.entries(shipped()).filter(([key]) => !optional.has(key))))).toEqual([]);
    expect(
      withChange(c => {
        (c as Record<string, unknown>)["mailbox"] = null;
        (c["models"] ??= {})["track"] = null;
      }),
    ).toEqual([]);
    expect(
      withChange(c => {
        (c["feeds"] ??= {})["newfeed"] = { minutes: 60, anything: ["goes"] };
      }),
    ).toEqual([]);
    expect(
      withChange(c => {
        (c["feeds"] ??= {})["newfeed"] = { anything: ["goes"] };
      }),
    ).toEqual(["feeds.newfeed.minutes: expected a number of at least 0, got missing"]);
  });
});

describe("config.local.yml", () => {
  it("is laid over config.yml key by key", async () => {
    const { overlay } = await import("../src/config");
    const base = { port: 8787, publicUrl: null, resume: { dir: "basic-resume", pdfName: "resume.pdf" }, autoApply: { phases: ["practice"], perDay: 5 } };
    expect(overlay(base, { publicUrl: "https://me.example:8787", resume: { pdfName: "a_b_resume.pdf" }, autoApply: { phases: ["real"] } })).toEqual({
      port: 8787,
      publicUrl: "https://me.example:8787",
      resume: { dir: "basic-resume", pdfName: "a_b_resume.pdf" },
      autoApply: { phases: ["real"], perDay: 5 },
    });
    expect(overlay(base, null)).toBeNull(); // an empty file is caught by the check, not ignored
    expect(overlay(base, {})).toEqual(base);
    expect(overlay({ mailbox: "a@example.com" }, { mailbox: null })).toEqual({ mailbox: null });
  });

  it("has an example that fits over the shipped file", async () => {
    const { overlay } = await import("../src/config");
    const example: unknown = YAML.parse(readFileSync(join(import.meta.dir, "../config.local.example.yml"), "utf8"));
    expect(configProblems(overlay(shipped(), example))).toEqual([]);
  });

  it("is never read by a test run", async () => {
    const { config } = await import("../src/config");
    expect(config.resume.pdfName).toBe("resume.pdf");
    expect(config.mailbox).toBeNull();
  });
});
