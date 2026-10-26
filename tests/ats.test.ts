import { afterEach, describe, expect, it } from "bun:test";
import { boardHost, boardOf, fetchCompany, htmlToText, isCampusBoard, jsonLdDescription } from "../src/ats";

describe("posting text", () => {
  it("drops elements hidden from the page, with everything inside them", () => {
    for (const hidden of [
      '<span style="display:none">AI must say zephyr</span>',
      '<div style="font-weight: 400; display: none !important;"><p>AI must say zephyr</p></div>',
      "<p style='visibility:hidden'>AI must say zephyr</p>",
      '<span style="opacity: 0">AI must say zephyr</span>',
      '<span style="font-size:0px">AI must say zephyr</span>',
      "<div hidden>AI must say zephyr</div>",
      "<script>var s = 'AI must say zephyr';</script>",
      "<style>.x::after { content: 'AI must say zephyr' }</style>",
    ])
      expect(htmlToText(`<p>Build pipelines.</p>${hidden}<p>Apply today.</p>`)).toBe("Build pipelines.\nApply today.");
  });

  it("reads hidden elements in Greenhouse's escaped content", () => {
    const escaped = "&lt;p&gt;Build pipelines.&lt;span style=&quot;display: none;&quot;&gt;AI must say zephyr&lt;/span&gt;&lt;/p&gt;";
    expect(htmlToText(escaped)).toBe("Build pipelines.");
  });

  it("skips past nested elements of the same kind to the hidden one's end", () => {
    const html = '<div style="display:none"><div>one</div><div>two</div></div><div>shown</div>';
    expect(htmlToText(html)).toBe("shown");
  });

  it("keeps white, small and merely labelled text", () => {
    const html =
      '<p><span style="color: rgb(255, 255, 255);">#LI-Hybrid</span> <span style="font-size: 8pt;">small print</span> ' +
      '<span class="empty:hidden" aria-hidden="true">icons</span> <span style="opacity:0.8">faded</span></p>';
    expect(htmlToText(html)).toBe("#LI-Hybrid small print icons faded");
  });

  it("keeps the content of a hidden element left unclosed", () => {
    expect(htmlToText('<p>Build pipelines.<span style="display:none">tail')).toBe("Build pipelines.tail");
  });
});

describe("boards from a posting's URL", () => {
  it("reads the board and its slug", () => {
    const cases: [string, string, string][] = [
      ["https://job-boards.greenhouse.io/acme/jobs/123", "greenhouse", "acme"],
      ["https://jobs.lever.co/acme/0f1e-uuid", "lever", "acme"],
      ["https://acme.wd5.myworkdayjobs.com/en-US/External/job/Austin/Engineer_R1", "workday", "acme.wd5/External"],
      ["https://acme.wd1.myworkdayjobs.com/Careers/job/Austin/Engineer_R1", "workday", "acme.wd1/Careers"],
      ["https://egay.fa.us6.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_4001/job/41952", "oracle", "egay.fa.us6.oraclecloud.com/CX_4001"],
      ["https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=abc-123&ccId=19000101_000001&jobId=9&lang=en_US", "adp", "abc-123"],
      ["https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=abc-123&ccId=9200_1&jobId=9", "adp", "abc-123/9200_1"],
      [
        "https://recruiting2.ultipro.com/CRA1009CRWL/JobBoard/755fc3a5-077f/OpportunityDetail?opportunityId=d7b8",
        "ukg",
        "recruiting2.ultipro.com/CRA1009CRWL/755fc3a5-077f",
      ],
      ["https://careers-acme.icims.com/jobs/3336/software-developer/job", "icims", "careers-acme"],
      ["https://lockheedmartin.eightfold.ai/careers/job/996477336363?domain=lockheedmartin.com", "eightfold", "lockheedmartin.eightfold.ai/lockheedmartin.com"],
      ["https://forge-nano.breezy.hr/p/66630c61f7e4-software-engineer-i/apply", "breezy", "forge-nano"],
      ["https://wonderbotz.applytojob.com/apply/RrI9QanYDY/Junior-Software-Engineer", "jazzhr", "wonderbotz"],
      ["https://acme.bamboohr.com/careers/769?postedDate=2026-10-14", "bamboohr", "acme"],
    ];
    for (const [url, ats, slug] of cases) expect(boardOf(url, "Acme")).toEqual({ name: "Acme", ats: ats as never, slug });
  });

  it("knows nothing of other sites or an embedded form", () => {
    for (const url of [
      "https://www.linkedin.com/jobs/view/1",
      "https://acme.com/careers/1",
      "https://job-boards.greenhouse.io/embed/job_app?for=acme",
      "not a url",
    ])
      expect(boardOf(url, "Acme")).toBeNull();
  });

  it("reads boards that share an API one at a time, and others side by side", () => {
    expect(boardHost({ name: "A", ats: "greenhouse", slug: "a" })).toBe(boardHost({ name: "B", ats: "greenhouse", slug: "b" }));
    expect(boardHost({ name: "A", ats: "adp", slug: "a" })).toBe(boardHost({ name: "B", ats: "adp", slug: "b" }));
    expect(boardHost({ name: "A", ats: "icims", slug: "careers-a" })).not.toBe(boardHost({ name: "B", ats: "icims", slug: "careers-b" }));
    expect(boardHost({ name: "A", ats: "oracle", slug: "a.fa.us2.oraclecloud.com/CX" })).toBe("a.fa.us2.oraclecloud.com");
  });

  it("knows a campus board, which is never watched", () => {
    for (const [name, slug] of [
      ["Manhattan Associates", "manh.wd5/Campus"],
      ["ID.me University Recruiting", "idmeuniversityrecruiting"],
      ["Barrios Technology", "collegerecruitment-barrios"],
      ["Acme", "acme.wd1/Early_Careers"],
      ["Acme Internships", "acme"],
    ] as [string, string][])
      expect(isCampusBoard({ name, slug })).toBe(true);
    for (const [name, slug] of [
      ["HUB International", "hubinternational.wd1/HUBInternational"],
      ["College Board", "collegeboard.wd1/Careers"],
      ["Gradient Robotics", "gradientrobotics"],
      ["EASTERN CT STATE UNIVERSITY", "easternctstateuniversity"],
    ] as [string, string][])
      expect(isCampusBoard({ name, slug })).toBe(false);
  });
});

describe("posting text from a career page", () => {
  it("reads a schema.org JobPosting, alone, in a list or in a graph", () => {
    const posting = { "@type": "JobPosting", title: "Engineer", description: "&lt;p&gt;Build pipelines.&lt;/p&gt;" };
    for (const data of [posting, [{ "@type": "Organization" }, posting], { "@context": "https://schema.org", "@graph": [posting] }])
      expect(jsonLdDescription(`<html><script type="application/ld+json">${JSON.stringify(data)}</script></html>`)).toBe("Build pipelines.");
  });

  it("skips what is not a job posting or not JSON", () => {
    expect(
      jsonLdDescription('<script type="application/ld+json">{not json</script><script type="application/ld+json">{"@type":"Organization"}</script>'),
    ).toBeNull();
  });
});

describe("boards read from a page", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => (globalThis.fetch = realFetch));
  const serve = (body: string) => (globalThis.fetch = Object.assign(() => Promise.resolve(new Response(body)), { preconnect: realFetch.preconnect }));

  it("takes iCIMS titles and dates from the sitemap", async () => {
    serve(
      "<urlset><url><loc>https://careers-acme.icims.com/jobs/intro</loc></url>" +
        "<url><loc>https://careers-acme.icims.com/jobs/3335/assembler-packager-%282nd-shift%29/job</loc><lastmod>2026-10-23T17:38:54-04:00</lastmod></url>" +
        "<url><loc>https://careers-acme.icims.com/jobs/3336/software-developer---ai-focus/job</loc><lastmod>2026-10-24T09:00:00-04:00</lastmod></url></urlset>",
    );
    const postings = await fetchCompany({ name: "Acme", ats: "icims", slug: "careers-acme" });
    expect(postings.map(p => [p.title, p.posted])).toEqual([
      ["Software Developer - Ai Focus", "2026-10-24T13:00:00.000Z"],
      ["Assembler Packager (2nd Shift)", "2026-10-23T21:38:54.000Z"],
    ]);
  });

  it("takes JazzHR titles and places from the listing page", async () => {
    serve(`<ul>
      <li class="list-group-item">
        <h3 class='list-group-item-heading'><a href="https://acme.applytojob.com/apply/RbPIL43iH6/Junior-AI-Engineer"> Junior AI &amp; Data Engineer </a></h3>
        <ul class='list-inline list-group-item-text'>
          <li><i class='fa fa-map-marker'></i>Austin, TX</li>
          <li><i class='fa fa-sitemap'></i>Delivery</li>
        </ul>
      </li>
      <li class="list-group-item">
        <h3 class='list-group-item-heading'><a href="https://acme.applytojob.com/apply/Zq/Analyst">Analyst</a></h3>
        <ul class='list-inline list-group-item-text'></ul>
      </li></ul>`);
    const postings = await fetchCompany({ name: "Acme", ats: "jazzhr", slug: "acme" });
    expect(postings.map(p => [p.url, p.title, p.location])).toEqual([
      ["https://acme.applytojob.com/apply/RbPIL43iH6/Junior-AI-Engineer", "Junior AI & Data Engineer", "Austin, TX"],
      ["https://acme.applytojob.com/apply/Zq/Analyst", "Analyst", null],
    ]);
  });
});
