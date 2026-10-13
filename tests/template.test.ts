import { describe, expect, it } from "bun:test";
import { fillTemplate } from "../src/template";

describe("prompt templates", () => {
  it("fills every placeholder, each time it appears", () => {
    expect(fillTemplate("{{company}} wants a {{title}}. Apply to {{company}} (job {{id}}).", { company: "Acme", title: "Engineer", id: 7 })).toBe(
      "Acme wants a Engineer. Apply to Acme (job 7).",
    );
  });

  it("renders a null value as nothing and ignores values no placeholder asks for", () => {
    expect(fillTemplate("Location: {{location}}.", { location: null, unused: "x" })).toBe("Location: .");
  });

  it("refuses a placeholder nothing was supplied for, naming all of them", () => {
    expect(() => fillTemplate("{{a}} {{b}} {{c}} {{b}}", { a: "1" }, "prompts/fill.md")).toThrow("prompts/fill.md: nothing supplied for {{b}}, {{c}}");
    expect(() => fillTemplate("{{toString}}", {})).toThrow("nothing supplied for {{toString}}");
  });

  it("does not expand placeholders that arrive inside a value", () => {
    expect(fillTemplate("{{description}}", { description: "Use {{secret}} here", secret: "leaked" })).toBe("Use {{secret}} here");
  });
});
