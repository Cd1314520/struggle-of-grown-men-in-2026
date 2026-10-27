import { describe, expect, it } from "bun:test";
import { buildFacts, decide, holds, pick, type Facts, type Field, type Plan } from "../src/prefill";

const facts: Facts = buildFacts(
  {
    first_name: "Ada",
    middle_name: "Byron",
    last_name: "Lovelace",
    preferred_name: null,
    phone: "+1 (512) 555-0100",
    address: { street: "Available on Request", city: "Austin", state: "TX", postal_code: "78701", country: "United States" },
    links: { linkedin: "https://linkedin.com/in/ada", github: null, website: null },
    current_company: "Analytical Engines",
    current_title: "AI Engineer",
    education: [{ school: "University of Texas at Austin", degree: "Bachelor of Science", field: "Computer Science" }],
    prefill: {
      work_authorized: "yes",
      sponsorship: "no",
      adult: "yes",
      previously_employed: "no",
      referred: "no",
      relocate: "yes",
      hispanic: "no",
      eeo: "decline",
      gender_if_required: "Male",
      sms_consent: "yes",
      how_heard: ["LinkedIn", "Job board", "Other"],
    },
  },
  "ada@example.com",
  "/jobs/1/resume.pdf",
);

const text = (question: string, kind: Field["kind"] = "text"): Field => ({ id: "1", kind, question, required: true });
const choice = (question: string, options: string[], kind: Field["kind"] = "radio", required = true): Field => ({
  id: "1",
  kind,
  question,
  required,
  options: options.map((o, i) => ({ tag: `1.${i}`, value: String(i), text: o })),
});
// The option a plan picks among a field's options.
const picked = (field: Field) => {
  const plan = decide(field, facts);
  return plan && "choose" in plan ? (pick(field.options ?? [], plan)?.text ?? "(none)") : plan;
};

describe("prefill decides", () => {
  it("types the candidate's plain facts", () => {
    const cases: [string, string][] = [
      ["First Name*", "Ada"],
      ["Last Name*", "Lovelace"],
      ["Middle Name", "Byron"],
      ["Middle", "Byron"],
      ["Middle initial", "B"],
      ["Name", "Ada Lovelace"],
      ["Email*", "ada@example.com"],
      ["Full name✱", "Ada Lovelace"],
      ["Phone", "+1 (512) 555-0100"],
      ["LinkedIn Profile", "https://linkedin.com/in/ada"],
      ["Current company", "Analytical Engines"],
      ["Current location", "Austin, TX"],
      ["City", "Austin"],
      ["Zip Code", "78701"],
      ["What state do you live in? *", "TX"],
    ];
    for (const [question, value] of cases) expect(decide(text(question), facts)).toEqual({ text: value });
  });

  it("leaves what the facts do not settle, or settle as blank", () => {
    for (const question of [
      "Preferred First Name",
      "Website",
      "Reference phone number",
      "Emergency contact name",
      "Confirm email",
      "If you were referred, please list who referred you.",
      "Why do you want to work here?",
      "What is your hourly compensation target?*",
    ])
      expect(decide(text(question), facts)).toBeNull();
    expect(decide(text("Briefly describe a time you led a project*", "textarea"), facts)).toBeNull();
  });

  it("uploads the resume and nothing else", () => {
    expect(decide(text("Attach resume", "file"), facts)).toEqual({ upload: "/jobs/1/resume.pdf" });
    expect(decide(text("Attach cover_letter", "file"), facts)).toBeNull();
  });

  it("answers the plain yes/no questions from the profile", () => {
    const yesNo = ["Yes", "No"];
    expect(picked(choice("Are you legally authorized to work in the United States?*", yesNo))).toBe("Yes");
    expect(picked(choice("Can you provide proof you are legally authorized to work in the United States?", yesNo))).toBe("Yes");
    expect(picked(choice("Will you now or in the future require sponsorship for employment visa status?", yesNo))).toBe("No");
    expect(picked(choice("Are you at least 18 years of age?", yesNo, "select"))).toBe("Yes");
    expect(picked(choice("Have you ever worked for RoadRunner?*", yesNo, "combobox"))).toBe("No");
    expect(picked(choice("Are you willing to relocate?", yesNo))).toBe("Yes");
  });

  it("leaves questions that only look like the plain ones", () => {
    const yesNo = ["Yes", "No"];
    for (const question of [
      "For this role, we do not provide any form of visa sponsorship. Do you understand?",
      "Are you authorized to work in a country other than the United States?",
      "Have you participated in an interview process for this position before?",
      "If you answered yes to the question above, please explain",
    ])
      expect(decide(choice(question, yesNo), facts)).toBeNull();
  });

  it("declines EEO questions, and answers Hispanic or Latino", () => {
    expect(picked(choice("Gender", ["Male", "Female", "Decline to self-identify"], "combobox"))).toBe("Decline to self-identify");
    expect(picked(choice("Veteran Status", ["I am not a protected veteran", "I don't wish to answer"], "combobox"))).toBe("I don't wish to answer");
    expect(picked(choice("Race", ["White", "Asian", "Hispanic or Latino", "Decline to self-identify"]))).toBe("Decline to self-identify");
    expect(picked(choice("Are you Hispanic/Latino?", ["Yes", "No", "Decline to self-identify"], "combobox"))).toBe("No");
    expect(picked(choice("Gender", ["Male", "Female"], "select"))).toBe("Male");
    expect(decide(choice("Gender", ["Male", "Female"], "select", false), facts)).toBeNull();
    // A closed combobox has not shown its options yet: the plan declines.
    const closed = decide({ id: "1", kind: "combobox", question: "Gender", required: false }, facts);
    expect(closed && "choose" in closed && pick([{ text: "Male" }, { text: "Decline To Self Identify" }], closed)?.text).toBe("Decline To Self Identify");
  });

  it("picks the source and text-message consent options it was told to prefer", () => {
    expect(picked(choice("Phone", ["Yes - I consent to receiving text messages", "No - I do not consent to receiving text messages"], "radio", false))).toBe(
      "Yes - I consent to receiving text messages",
    );
    expect(picked(choice("How did you hear about us?", ["Riveron's Website", "Glassdoor", "LinkedIn", "Other"]))).toBe("LinkedIn");
    expect(picked(choice("How did you hear about this job?", ["Friend", "Other"]))).toBe("Other");
    expect(picked(choice("Text message consent", ["No - I do not consent to receiving text messages", "Yes - I consent to receiving text messages"]))).toBe(
      "Yes - I consent to receiving text messages",
    );
  });

  it("picks the country, state and school in lists", () => {
    expect(picked(choice("Country", ["Canada", "United States of America", "Mexico"], "combobox"))).toBe("United States of America");
    expect(picked(choice("State", ["Tennessee", "Texas", "Utah"], "select"))).toBe("Texas");
    expect(picked(choice("School", ["University of Texas at Arlington", "University of Texas at Austin"], "combobox"))).toBe("University of Texas at Austin");
    expect(picked(choice("Degree", ["High School", "Bachelor's Degree", "Master's Degree"], "select"))).toBe("Bachelor's Degree");
    expect(picked(choice("What is your highest level of completed education? *", ["High school", "Bachelor's degree"], "combobox"))).toBe("Bachelor's degree");
  });
});

describe("prefill compares", () => {
  const plan = (p: Plan) => p;
  it("knows a field already holding the candidate's value", () => {
    expect(holds("(512) 555-0100", plan({ text: "+1 (512) 555-0100" }))).toBe(true);
    expect(holds("ADA@example.com", plan({ text: "ada@example.com" }))).toBe(true);
    expect(holds("ada.l@gmail.com", plan({ text: "ada@example.com" }))).toBe(false);
    expect(holds("United States", plan({ choose: [/^united states\b/i] }))).toBe(true);
  });
});
