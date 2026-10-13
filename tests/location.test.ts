import { describe, expect, it } from "bun:test";
import { placeOf } from "../src/location";

describe("where a listing is", () => {
  it("recognises US locations as boards write them", () => {
    for (const loc of [
      "Tysons, Virginia",
      "New York, NY",
      "Washington, D.C.",
      "Hub - San Francisco",
      "Remote - US",
      "Gallup, New Mexico, United States",
      "Carmel, Indiana — Hybrid",
      "Houston",
    ])
      expect(placeOf(loc)).toBe("us");
  });
  it("recognises locations abroad", () => {
    for (const loc of [
      "London, United Kingdom",
      "Kraków, Lesser Poland Voivodeship, Poland",
      "Hub - Porto",
      "Remote - Ukraine",
      "Toronto, Ontario, Canada",
      "Bengaluru, India",
      "Bangalore, IN",
      "Berlin, DE",
      "EMEA",
    ])
      expect(placeOf(loc)).toBe("abroad");
  });
  it("does not guess", () => {
    for (const loc of [null, "", "Remote", "Hybrid", "Springfield"]) expect(placeOf(loc)).toBe("unknown");
  });
});
