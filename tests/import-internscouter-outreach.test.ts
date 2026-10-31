import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importOutreach } from "../scripts/import-internscouter-outreach";
import { referralStore } from "../src/referrals";
import { openDatabase } from "../src/schema";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function setup(outreach: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "auto-apply-outreach-"));
  dirs.push(dir);
  const dbPath = join(dir, "app.db"),
    file = join(dir, "outreach.json");
  const db = openDatabase(dbPath, "migrate");
  db.query(
    "INSERT INTO jobs (id, url, source, company, title, status, company_key) VALUES (7, 'https://ats.example/7', 'test', 'Acme Robotics', 'Embedded Intern', 'submitted', 'acmerobotics')",
  ).run();
  db.close();
  writeFileSync(file, JSON.stringify(outreach));
  return { dir, dbPath, file };
}

// The shape referral.py writes (InternScouter's data/outreach.json), with made-up people.
const OUTREACH = {
  contacts: {
    "1": {
      name: "Ana Diaz",
      title: "Firmware Engineer",
      company: "Acme Robotics",
      profile_url: "https://www.linkedin.com/in/ana-diaz",
      relation: "alumni",
      stage: "FollowedUp",
      email: "",
      job_key: "acme-1",
      job_title: "Embedded Intern",
      job_link: "https://old.example/1",
      resume: "EE",
      with_note: true,
      dates: { added: "2026-10-01", requested: "2026-10-01", connected: "2026-10-03", messaged: "2026-10-04", followed_up: "2026-10-11" },
      notes: "met at the career fair",
    },
    "2": {
      name: "Bo Chen",
      title: "Recruiter",
      company: "Initech",
      relation: "",
      stage: "Drafted",
      job_key: "",
      job_title: "",
      job_link: "",
      dates: { added: "2026-10-20" },
    },
  },
  suggested: { acmerobotics: "2026-10-28", "bridge:cy-park": "2026-10-27", "bridge:dee lin": "2026-10-26" },
  connections: [
    { name: "Cy Park", url: "https://www.linkedin.com/in/cy-park", company: "Acme Robotics", position: "Hardware Engineer", connected: "2026-10-23" },
    { name: "", url: "", company: "", position: "", connected: "2026-07-18" },
  ],
  last_export: "Basic_LinkedInDataExport_10-24-2026.zip:1792972772",
  last_export_date: "2026-10-25",
  export_reminded: "2026-10-24",
};

describe("importing InternScouter's outreach.json", () => {
  it("brings in contacts with their stages and days, the network, the suggestions and the last export", () => {
    const { dbPath, file } = setup(OUTREACH);
    const db = openDatabase(dbPath, "readwrite");
    try {
      expect(importOutreach(db, file)).toEqual({
        contacts: 2,
        skipped: 0,
        linked: 1,
        connections: 1,
        suggested: 3,
        lastExport: "Basic_LinkedInDataExport_10-24-2026.zip (2026-10-25)",
      });
      const store = referralStore(db);
      const [ana, bo] = store.contacts();
      expect(ana).toMatchObject({
        name: "Ana Diaz",
        relation: "alumni",
        stage: "followed_up",
        job_id: 7, // the same application here
        job_title: null,
        area: "EE",
        with_note: 1,
        added_on: "2026-10-01",
        connected_on: "2026-10-03",
        followed_up_on: "2026-10-11",
        notes: "met at the career fair",
        legacy_id: "1",
      });
      expect(bo).toMatchObject({ relation: "engineer", stage: "drafted", job_id: null, email: null, legacy_id: "2" });
      expect(store.connections().map(c => c.key)).toEqual(["cy-park"]);
      expect(Object.fromEntries(store.suggestions())).toEqual({
        acmerobotics: "2026-10-28",
        "bridge:cy-park": "2026-10-27",
        "bridge:name:dee lin": "2026-10-26",
      });
      expect(store.lastExport()).toMatchObject({ file: "Basic_LinkedInDataExport_10-24-2026.zip", exported_on: "2026-10-25" });
    } finally {
      db.close();
    }
  });

  it("refuses the same file twice, and skips contacts a different, later file still carries", () => {
    const { dbPath, file, dir } = setup(OUTREACH);
    const db = openDatabase(dbPath, "readwrite");
    try {
      importOutreach(db, file);
      expect(() => importOutreach(db, file)).toThrow(/already imported/);
      expect(referralStore(db).contacts()).toHaveLength(2);
      const later = join(dir, "later.json");
      writeFileSync(
        later,
        JSON.stringify({
          ...OUTREACH,
          contacts: {
            ...OUTREACH.contacts,
            "3": { name: "Eve", company: "Hooli", stage: "Requested", dates: { added: "2026-10-28", requested: "2026-10-28" } },
          },
        }),
      );
      expect(importOutreach(db, later)).toMatchObject({ contacts: 1, skipped: 2 });
      expect(
        referralStore(db)
          .contacts()
          .map(c => c.name),
      ).toEqual(["Ana Diaz", "Bo Chen", "Eve"]);
    } finally {
      db.close();
    }
  });

  it("changes nothing on a dry run, and nothing when the file is not an outreach file", () => {
    const { dbPath, file, dir } = setup(OUTREACH);
    const db = openDatabase(dbPath, "readwrite");
    try {
      expect(importOutreach(db, file, { dryRun: true }).contacts).toBe(2);
      expect(referralStore(db).contacts()).toEqual([]);
      expect(referralStore(db).imported("x")).toBe(false);
      const other = join(dir, "other.json");
      writeFileSync(other, JSON.stringify({ hello: 1 }));
      expect(() => importOutreach(db, other)).toThrow(/does not look like/);
      const bad = join(dir, "bad.json");
      writeFileSync(bad, JSON.stringify({ contacts: { "1": { name: "X", company: "Y", stage: "Pending" } } }));
      expect(() => importOutreach(db, bad)).toThrow(/unknown stage/);
      expect(referralStore(db).contacts()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("runs from the command line on the database it is given, and says so when it refuses", () => {
    const { dbPath, file } = setup(OUTREACH);
    const run = () =>
      Bun.spawnSync([process.execPath, join(import.meta.dir, "..", "scripts", "import-internscouter-outreach.ts"), "--db", dbPath, "--file", file], {
        stdout: "pipe",
        stderr: "pipe",
      });
    const first = run();
    expect(first.exitCode).toBe(0);
    expect(first.stdout.toString()).toContain("Imported 2 contact(s) (1 tied to an application, 0 already here), 1 connection(s), 3 earlier suggestion(s)");
    const second = run();
    expect(second.exitCode).toBe(1);
    expect(second.stderr.toString()).toContain("already imported");
    const missing = Bun.spawnSync([process.execPath, join(import.meta.dir, "..", "scripts", "import-internscouter-outreach.ts"), "--file", file], {
      stderr: "pipe",
    });
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr.toString()).toContain("--db");
  });
});
