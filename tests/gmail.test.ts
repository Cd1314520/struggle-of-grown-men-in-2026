import { afterEach, describe, expect, it } from "bun:test";
import { config } from "../src/config";
import { kvDelete, kvSet } from "../src/db";
import { applicationMailbox } from "../src/gmail";

const initial = config.mailbox;
afterEach(() => {
  config.mailbox = initial;
  kvDelete("gmail.address");
});

describe("applicationMailbox", () => {
  it("is the connected Gmail address", () => {
    config.mailbox = "owner@example.com";
    kvSet("gmail.address", "connected@example.com");
    expect(applicationMailbox()).toBe("connected@example.com");
  });

  it("falls back to the configured mailbox before Gmail is connected", () => {
    config.mailbox = " owner@example.com ";
    expect(applicationMailbox()).toBe("owner@example.com");
  });

  it("is empty with neither", () => {
    config.mailbox = null;
    expect(applicationMailbox()).toBe("");
  });
});
