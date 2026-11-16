import { afterEach, describe, expect, it } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config, PROFILE } from "../src/config";
import { kvDelete, kvGet, kvSet } from "../src/db";
import { applicationMailbox, authUrl, checkOAuthState, exchangeCode } from "../src/gmail";

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

describe("the Gmail sign-in", () => {
  const clientFile = join(PROFILE, "gmail-client.json");
  afterEach(() => {
    rmSync(clientFile, { force: true });
    kvDelete("gmail.oauth.state");
  });
  const started = () => {
    writeFileSync(clientFile, JSON.stringify({ installed: { client_id: "client-1", client_secret: "secret-1" } }));
    return new URL(authUrl()).searchParams.get("state") ?? "";
  };

  it("sends Google a fresh state each time", () => {
    const first = started();
    const second = started();
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).not.toBe(first);
  });

  it("accepts only the state it last sent, once", () => {
    const state = started();
    expect(() => {
      checkOAuthState(state);
    }).not.toThrow();
    expect(() => {
      checkOAuthState(state);
    }).toThrow("not started from this app");
  });

  it("refuses a callback with another state, none, or one older than ten minutes", () => {
    started();
    expect(() => {
      checkOAuthState("not-the-state");
    }).toThrow("not started from this app");
    started();
    expect(() => {
      checkOAuthState(null);
    }).toThrow("not started from this app");
    const state = started();
    kvSet("gmail.oauth.state", JSON.stringify({ state, at: Date.now() - 11 * 60_000 }));
    expect(() => {
      checkOAuthState(state);
    }).toThrow("took longer than ten minutes");
  });

  it("refuses a code with the wrong state before it reaches Google", async () => {
    started();
    const fetched: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = Object.assign(
      (input: string | URL | Request) => {
        fetched.push(input instanceof Request ? input.url : input.toString());
        return Promise.resolve(new Response("{}"));
      },
      { preconnect: real.preconnect },
    );
    let refused = "";
    try {
      await exchangeCode("attacker-code", "forged");
    } catch (err) {
      refused = err instanceof Error ? err.message : "";
    } finally {
      globalThis.fetch = real;
    }
    expect(refused).toContain("not started from this app");
    expect(fetched).toEqual([]);
    expect(kvGet("gmail.refresh")).toBeNull();
  });
});
