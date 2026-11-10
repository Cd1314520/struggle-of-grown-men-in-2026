import { describe, expect, it } from "bun:test";
import { PLATFORMS, platformOf, scoreResume, scoreText, type AtsReport, type DimensionId, type Platform, type ResumeExtraction } from "../src/ats-score";

const CLEAN = [
  "Jane Doe",
  "+1 (555) 123-4567 | Austin, TX | jane.doe@example.com | linkedin.com/in/jane-doe",
  "Work Experience",
  "Platform Engineer May 2022 — Present",
  "Acme Corp Austin, TX",
  "• Migrated the deployment pipeline to Kubernetes and cut release time from two hours to ten minutes.",
  "• Built Python services on PostgreSQL and monitored them with Grafana dashboards.",
  "• Automated database failover drills with Ansible playbooks, documented the runbooks, and trained four on-call engineers to run them.",
  "• Led the migration of three legacy cron jobs into a scheduled workflow engine with alerting on every failed run.",
  "Backend Developer Jun 2019 — Apr 2022",
  "Globex Dallas, TX",
  "• Maintained REST APIs in Java and wrote unit tests that raised coverage across the whole billing module.",
  "Education",
  "University of Texas at Austin 2019",
  "Bachelor of Science, Computer Science Austin, TX",
  "Skills",
  "• Languages: Python, Java, SQL",
  "• Infra: Docker, Kubernetes, Terraform, Linux, Git",
].join("\n");

const extraction = (raw: string, over: Partial<ResumeExtraction> = {}): ResumeExtraction => ({
  raw,
  layout: raw,
  pages: 1,
  fonts: [{ name: "ABCDEF+Inter-Regular", embedded: true }],
  ...over,
});

const posting = (description: string | null, url = "https://boards.greenhouse.io/acme/jobs/1", title = "Platform Engineer") => ({ url, title, description });

const dimension = (report: AtsReport, id: DimensionId) => {
  const d = report.parse.dimensions.find(x => x.id === id);
  if (!d) throw new Error(`missing dimension ${id}`);
  return d;
};

describe("platformOf", () => {
  it("recognises platforms from the posting host and path", () => {
    const cases: [string, Platform][] = [
      ["https://job-boards.greenhouse.io/acme/jobs/123", "greenhouse"],
      ["https://grnh.se/abc123", "greenhouse"],
      ["https://jobs.lever.co/acme/uuid", "lever"],
      ["https://jobs.ashbyhq.com/acme/uuid", "ashby"],
      ["https://apply.workable.com/acme/j/ABC/", "workable"],
      ["https://acme.recruitee.com/o/engineer", "recruitee"],
      ["https://jobs.smartrecruiters.com/Acme/123-engineer", "smartrecruiters"],
      ["https://acme.wd5.myworkdayjobs.com/External/job/Austin/Engineer_R1", "workday"],
      ["https://hbbq.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/1", "oracle"],
      ["https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=abc", "adp"],
      ["https://recruiting2.ultipro.com/ACM1000/JobBoard/abc/OpportunityDetail?opportunityId=1", "ukg"],
      ["https://careers-acme.icims.com/jobs/1234/engineer/job", "icims"],
      ["https://acme.eightfold.ai/careers?domain=acme.com", "eightfold"],
      ["https://acme.breezy.hr/p/abc-engineer", "breezy"],
      ["https://acme.applytojob.com/apply/abc/Engineer", "jazzhr"],
      ["https://acme.bamboohr.com/careers/12", "bamboohr"],
      ["https://acme.taleo.net/careersection/ex/jobdetail.ftl?job=1", "taleo"],
      ["https://career5.successfactors.eu/career?company=acme&career_job_req_id=1", "successfactors"],
      ["https://jobs.jobvite.com/acme/job/oAbC", "jobvite"],
      ["https://www.paycomonline.net/v4/ats/web.php/jobs/ViewJobDetails?job=1", "paycom"],
      ["https://recruiting.paylocity.com/recruiting/jobs/Details/123", "paylocity"],
    ];
    for (const [url, platform] of cases) expect([url, platformOf(url)]).toEqual([url, platform]);
  });

  it("falls back to unknown for other hosts and malformed URLs", () => {
    for (const url of ["https://careers.example.com/jobs/1", "https://ats.rippling.com/acme/jobs/1", "not a url", ""]) expect(platformOf(url)).toBe("unknown");
    expect(PLATFORMS).toContain("unknown");
  });
});

describe("parse dimensions", () => {
  it("passes a clean text resume", () => {
    const report = scoreText(extraction(CLEAN), posting(null));
    expect(report.parse.dimensions.map(d => d.id)).toEqual(["extractable", "glyphs", "contact", "sections", "dates", "reading_order", "bullets", "structure"]);
    for (const d of report.parse.dimensions) expect([d.id, d.score]).toEqual([d.id, 1]);
    expect(report.verdict).toBe("pass");
    expect(report.overall).toBe(100);
  });

  it("fails a resume whose text has ligatures, replacement characters or private-use bullets", () => {
    for (const [name, text] of [
      ["ligature", CLEAN.replace("Platform Engineer May", "Platform Engineer certiﬁed May")],
      ["replacement", CLEAN.replace("Acme Corp", "Acme \uFFFD Corp")],
      ["private-use bullet", CLEAN.replace("• Built Python", "\uF0B7 Built Python")],
      ["zero-width", CLEAN.replace("Kubernetes and", "Kuber\u200Bnetes and")],
    ] as const) {
      const report = scoreText(extraction(text), posting(null));
      expect([name, dimension(report, "glyphs").score]).toEqual([name, 0]);
      expect([name, report.verdict]).toEqual([name, "fail"]);
      expect(dimension(report, "glyphs").findings.length).toBeGreaterThan(0);
    }
  });

  it("only warns about smart quotes", () => {
    const report = scoreText(extraction(CLEAN.replace("Built Python", "Built “Python”")), posting(null));
    const glyphs = dimension(report, "glyphs");
    expect(glyphs.score).toBeLessThan(1);
    expect(glyphs.score).toBeGreaterThan(0.5);
    expect(report.verdict).not.toBe("fail");
  });

  it("fails an image-only PDF with no extractable text", () => {
    const report = scoreText(extraction("  \n", { layout: "" }), posting(null));
    expect(dimension(report, "extractable").score).toBe(0);
    expect(report.verdict).toBe("fail");
  });

  it("scores missing contact details and headings lower", () => {
    const bare = CLEAN.split("\n")
      .filter(l => !/@|^Education|^Skills|^Work Experience/.test(l))
      .join("\n");
    const report = scoreText(extraction(bare), posting(null));
    expect(dimension(report, "contact").score).toBeLessThan(1);
    expect(dimension(report, "contact").findings.join(" ")).toMatch(/email/i);
    expect(dimension(report, "sections").score).toBeLessThan(0.5);
  });

  it("flags mixed date formats and year-only ranges", () => {
    const mixed = scoreText(extraction(CLEAN.replace("Jun 2019 — Apr 2022", "06/2019 — Apr 2022")), posting(null));
    expect(dimension(mixed, "dates").score).toBeLessThan(1);
    const years = scoreText(extraction(CLEAN.replace("May 2022 — Present", "2022 — Present").replace("Jun 2019 — Apr 2022", "2019 — 2022")), posting(null));
    expect(dimension(years, "dates").score).toBeLessThan(1);
    const strict = scoreText(
      extraction(CLEAN.replace("May 2022 — Present", "2022 — Present").replace("Jun 2019 — Apr 2022", "2019 — 2022")),
      posting(null, "https://acme.wd5.myworkdayjobs.com/x/job/y"),
    );
    expect(dimension(strict, "dates").score).toBeLessThan(dimension(years, "dates").score);
  });

  it("detects columns that read out of order", () => {
    const left = [
      "Platform Engineer building deployment pipelines",
      "Maintains billing services in production",
      "Writes tests for the payment module",
      "Reviews infrastructure changes weekly",
    ];
    const right = [
      "Python, Docker, Kubernetes and Terraform skills",
      "Certified cloud practitioner since early 2021",
      "Speaks English and Spanish at work daily",
      "Volunteers teaching programming to students",
    ];
    const raw = [CLEAN, ...left, ...right].join("\n");
    const layout = [CLEAN, ...left.map((l, i) => `${l.padEnd(52)}${right[i]}`)].join("\n");
    const report = scoreText(extraction(raw, { layout }), posting(null));
    expect(dimension(report, "reading_order").score).toBeLessThan(1);
    expect(dimension(report, "reading_order").findings.length).toBeGreaterThan(0);
  });

  it("flags unembedded fonts and long documents", () => {
    const report = scoreText(extraction(CLEAN, { pages: 4, fonts: [{ name: "Arial", embedded: false }] }), posting(null));
    const structure = dimension(report, "structure");
    expect(structure.score).toBeLessThan(0.5);
    expect(structure.findings.join(" ")).toMatch(/Arial/);
    expect(report.pages).toBe(4);
  });

  it("does not crash on a missing font table", () => {
    const report = scoreText(extraction(CLEAN, { fonts: [] }), posting(null));
    expect(dimension(report, "structure").findings.join(" ")).toMatch(/font/i);
  });
});

describe("keyword match", () => {
  const description = [
    "About us",
    "We build developer tools.",
    "",
    "Requirements:",
    "- Experience with k8s and Python",
    "- Strong knowledge of Rust",
    "",
    "Nice to have:",
    "- Terraform",
  ].join("\n");

  it("counts an alias in the resume as a match", () => {
    const match = scoreText(extraction(CLEAN), posting(description)).match;
    expect(match).not.toBeNull();
    const k8s = match?.keywords.find(k => /kubernetes|k8s/i.test(k.term));
    expect(k8s).toMatchObject({ kind: "required", found: true });
  });

  it("lists a missing required term as not found and lowers the score", () => {
    const report = scoreText(extraction(CLEAN), posting(description));
    const rust = report.match?.keywords.find(k => k.term === "Rust");
    expect(rust).toMatchObject({ kind: "required", found: false });
    const withRust = scoreText(extraction(`${CLEAN}\n• Rust`), posting(description));
    expect(withRust.match?.keywords.find(k => k.term === "Rust")?.found).toBe(true);
    expect(withRust.match?.score ?? 0).toBeGreaterThan(report.match?.score ?? 1);
  });

  it("weights required terms above preferred ones and sorts by weight", () => {
    const keywords = scoreText(extraction(CLEAN), posting(description)).match?.keywords ?? [];
    const weight = (term: string) => keywords.find(k => k.term === term)?.weight ?? 0;
    expect(weight("Python")).toBeGreaterThan(weight("Terraform"));
    expect(keywords.map(k => k.weight)).toEqual([...keywords.map(k => k.weight)].sort((a, b) => b - a));
    expect(keywords.reduce((s, k) => s + k.weight, 0)).toBeCloseTo(1, 2);
  });

  it("does not let Java satisfy JavaScript", () => {
    const javaOnly = scoreText(extraction(CLEAN), posting("Requirements:\n- JavaScript\n- Python\n- SQL")).match;
    expect(javaOnly?.keywords.find(k => k.term === "JavaScript")?.found).toBe(false);
    const js = scoreText(extraction(`${CLEAN}\n• JavaScript`), posting("Requirements:\n- JavaScript\n- Python\n- SQL")).match;
    expect(js?.keywords.find(k => k.term === "JavaScript")?.found).toBe(true);
  });

  it("does not let Node.js stand in for JavaScript through its .js suffix", () => {
    const match = scoreText(extraction(`${CLEAN}\n• Node.js`), posting("Requirements:\n- JavaScript\n- Python\n- SQL")).match;
    expect(match?.keywords.find(k => k.term === "JavaScript")?.found).toBe(false);
  });

  it("rewards a title that the resume's roles echo", () => {
    const same = scoreText(extraction(CLEAN), posting(description, undefined, "Platform Engineer")).match;
    const other = scoreText(extraction(CLEAN), posting(description, undefined, "Pastry Chef")).match;
    expect(same?.titleMatch).toBe(1);
    expect(other?.titleMatch).toBe(0);
  });

  it("has no match section without a usable description, and the overall is parse only", () => {
    for (const d of [null, "", "   "]) {
      const report = scoreText(extraction(CLEAN), posting(d));
      expect(report.match).toBeNull();
      expect(report.overall).toBe(Math.round(report.parse.score * 100));
    }
  });
});

describe("platform tiers", () => {
  it("weights parse dimensions differently per tier and sums them to one", () => {
    const byUrl = (url: string) => scoreText(extraction(CLEAN), posting(null, url));
    const workday = byUrl("https://acme.wd5.myworkdayjobs.com/x/job/y");
    const greenhouse = byUrl("https://boards.greenhouse.io/acme/jobs/1");
    const unknown = byUrl("https://careers.example.com/jobs/1");
    expect(workday.platform).toMatchObject({ platform: "workday", tier: "parse-and-prefill" });
    expect(greenhouse.platform).toMatchObject({ platform: "greenhouse", tier: "search-and-review" });
    expect(unknown.platform).toMatchObject({ platform: "unknown", tier: "unknown" });
    for (const r of [workday, greenhouse, unknown]) {
      expect(r.parse.dimensions.reduce((s, d) => s + d.weight, 0)).toBeCloseTo(1, 6);
      expect(r.platform.notes.join(" ")).toMatch(/heuristic/i);
    }
    expect(dimension(workday, "contact").weight).toBeGreaterThan(dimension(greenhouse, "contact").weight);
    expect(dimension(workday, "reading_order").weight).toBeGreaterThan(dimension(greenhouse, "reading_order").weight);
  });

  it("lets a weak keyword match drag a search-and-review portal down more than a parse-and-prefill one", () => {
    const description = "Requirements:\n- Rust\n- Go\n- Haskell\n- Erlang\n- Elixir";
    const search = scoreText(extraction(CLEAN), posting(description, "https://boards.greenhouse.io/acme/jobs/1"));
    const legacy = scoreText(extraction(CLEAN), posting(description, "https://acme.wd5.myworkdayjobs.com/x/job/y"));
    expect(search.match?.score).toBeLessThan(0.5);
    expect(search.overall).toBeLessThan(legacy.overall);
  });

  it("forces a fail verdict when glyphs are broken, regardless of the match", () => {
    const report = scoreText(extraction(CLEAN.replace("Kubernetes and", "Kubernetes ﬁ and")), posting("Requirements:\n- Python\n- Kubernetes\n- Docker"));
    expect(report.match?.score).toBeGreaterThan(0.8);
    expect(report.verdict).toBe("fail");
  });
});

describe("scoreResume", () => {
  it("throws a clear error when the PDF is missing", () => {
    expect(() => scoreResume({ pdf: "/nonexistent/resume.pdf", posting: posting(null) })).toThrow(/not found/i);
  });
});
