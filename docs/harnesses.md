# Harnesses

Every piece of agent work is one process started by `runWorker` (`src/worker.ts`) with a prompt, a working directory, the built-in tools it may use, and the host tools it reports through. Which program runs it follows from the stage's model in `models.<stage>`:

| Model | Harness | Client |
|---|---|---|
| `claude-code/<model>`: `claude-code/opus`, `claude-code/sonnet`, `claude-code/default`, or a full model name such as `claude-code/claude-opus-5-5` | Claude Code, `claude -p`, signed in as `claude auth status` shows | `src/claude.ts` |
| `codex/<model>`: `codex/gpt-6-luna`, `codex/gpt-6-sol`, or `codex/default` for Codex's own default | Codex, `codex exec --json`, signed in under the app's own `CODEX_HOME` (`data/codex`, `bun run codex:login`) | `src/codex.ts` |
| anything else, or null (omp's default) | omp, `omp --mode rpc` | `src/omp.ts` |

Each stage picks its own, so filling can stay on omp while assessing runs on Claude Code or Codex. Settings → Models lists all three: omp's own listing, Claude Code's aliases once `claude` is signed in, and the models Codex shows in its picker (`codex debug models`) once the app's Codex home is signed in. Setup requires only the harnesses the stages use, and `npx` when a Claude Code or Codex model fills applications.

The Codex binary is `AUTO_APPLY_CODEX` if set, else `codex` on the PATH, else (on Windows) the Codex desktop app's own CLI, found once through `Get-AppxPackage OpenAI.Codex`.

## Usage limits and fallbacks

When a provider refuses work for capacity, the work moves to the next model or account that can take it, and the app pauses only when none can (`src/providers.ts`, `watchCapacity` in `src/scheduler.ts`).

```yaml
fallback: [codex/gpt-6-sol]          # every stage's fallbacks, in order
claudeAccounts: [C:/claude-account-2] # extra Claude sign-ins, each tried for a Claude Code model
models:
  fill: claude-code/opus
  fallback:
    prep: [codex/gpt-6-luna, claude-code/haiku] # replaces the global list for prep
```

- **The chain.** A stage's work may run on its own model, then each of its fallbacks: `models.fallback.<stage>` (one model or a list) when the stage has one, which replaces the global `fallback` rather than adding to it, else the global `fallback`. Each model is in the chain once. A Claude Code model is tried on each account in turn: Claude Code's own sign-in first, then every directory in `claudeAccounts` that has been signed in (`CLAUDE_CONFIG_DIR=<dir> claude`, then `/login`, which writes `<dir>/.credentials.json`). A worker named after no stage says which one it runs for (`stage`: the answer bank runs on `models.recheck`).
- **Providers out.** Limits belong to an account, not a model, so they are kept per provider: `codex`, `claude:default`, `claude:<dir>` or `omp` (`limit.<provider>` in kv). Any capacity refusal (`isCapacityError` in `src/errors.ts`: a usage limit, an overload, a 429) marks the provider that served the worker out until 30 seconds after the reset it names (`limitResetsAt`: Claude Code's `resets <ISO time>`; Codex's "try again at 11:58 PM", read as this machine's local time, or a dated one; "try again in 2 hours"), or for 5 minutes when it names none. New work of a stage starts on the first choice in its chain whose provider is not out, and goes back to the stage's own model once that one is back.
- **Most stages.** `withFallback` runs a worker that was refused for capacity again at once, with the same prompt and host tools, on the next choice that is not out, unless it called a host tool before the refusal: it may have changed something already (a prep that handed in its resume), so its caller handles the refusal as before, and the next worker of that stage starts on the fallback.
- **Fill.** A browser worker may have filled half a form, so it is not rerun in place. `fillChoice` (`src/fill.ts`) picks the model and account before the prompt is written, since the prompt and tools follow the harness (omp's browser or Playwright's). A fill refused for capacity stops as before (the same draft goes back in the fill queue) and resumes on the next choice, with the resuming brief and the checkpoint the first worker saved.
- **Pausing.** While some choice in the stage's chain is not out, a refusal does not pause the app. When every one is, all agent work waits until the first of them is back (`backOff(until)` in `src/limits.ts`), instead of the doubling pause of up to an hour that a worker with no stage gets. The pause covers every stage.

Settings → Models does not show fallbacks or accounts: they are set in `config.local.yml` (or `config.yml`). Setup counts the fallback models when it checks which harnesses and tools are needed.

## What each harness is given

| | omp | Claude Code | Codex |
|---|---|---|---|
| Host tools | `set_host_tools` over the RPC channel | an MCP server ("host") the app serves on a private localhost port, with a token, for the worker's lifetime: `mcp__host__<name>` | the same server through `-c mcp_servers.host.*`: the token in an environment variable (`bearer_token_env_var`), `required`, tools pre-approved (`default_tools_approval_mode = "approve"`), a 48-hour tool timeout |
| `read` | `read` | `Read`, `Glob` | its shell, in a `read-only` sandbox |
| `write`, `edit`, `bash` | the same | `Write`, `Edit`, `Bash` | its shell and patch tool, in a `workspace-write` sandbox whose only writable root is the working directory (TMP excluded) |
| `web_search` | `web_search` | `WebSearch`, `WebFetch` | `web_search = "live"` (otherwise `"disabled"`) |
| `eval` | its JavaScript session | none (see the fill worker below) | none, as for Claude Code |
| Browser | omp's browser tool over CDP | Playwright's MCP server (`@playwright/mcp`, pinned in `src/claude.ts`), started with `--cdp-endpoint`, `--no-webmcp` and `--caps vision` | the same server, through `-c mcp_servers.browser.*` |
| Permissions | `approvalMode: yolo` | `--permission-mode bypassPermissions` | `approval_policy = "never"` inside the sandbox above; on Windows `windows.sandbox = "elevated"` (without it every command is refused) |
| Isolation | `--no-extensions --no-rules --no-skills --no-lsp` | `--setting-sources ""` (no CLAUDE.md, settings, hooks or plugins), `--strict-mcp-config`, `--disable-slash-commands`, `--no-chrome` | its own `CODEX_HOME` (`data/codex`), because `--ignore-user-config` still loads the owner's `~/.codex/AGENTS.md`; plus `--ignore-user-config --ignore-rules --ephemeral`; and no skills: Codex also finds them in `~/.agents/skills`, under the home directory rather than `CODEX_HOME`, so `skills.include_instructions = false` keeps every skill out of the prompt (checked with `codex debug prompt-input` on codex-cli 0.164; `features.skip_host_skill_discovery` does not stop that search and only adds an unstable-feature warning) |
| System prompt | `prompts/system.md` appended | the same, plus a line naming the `mcp__host__` prefix | `prompts/system.md` and a line about the "host" server, ahead of the task on stdin |
| Time limit | `--max-time` | a timer in the client that stops the process | the same |
| Abort | an `abort` frame, then a kill after 3 s | SIGTERM, then SIGKILL after 3 s | the same |
| Transcript | `data/sessions/<worker>/` | Claude Code's own store (`~/.claude/projects/`); the session id is in the log line of any worker that does not complete | none (`--ephemeral`); the thread id is in the log line of any worker that does not complete |
| Activity log | omp's `intent` per tool call | the tool and what it acts on (a description, element, URL, query or path; never typed text) | each command (without its shell wrapper), browser tool, web search and file change, the same way |
| Capacity | errors matched by `isCapacityError` | the same, plus a rejected `rate_limit_event` and "You've hit your … limit" | the same, from its `error` and `turn.failed` events |

## The fill worker

All three harnesses drive the same browser through the same scoped pacing proxy (`src/cdp-proxy.ts`), so tab scoping, input pacing and checkpoints are the same. What differs is in the prompt: `prompts/fill.md` takes its browser section from `prompts/browser-omp.md`, or from `prompts/browser-playwright.md` for Claude Code and Codex, which both drive Playwright's MCP server.

- **Prefill.** omp's fill agent imports `src/prefill.ts` into its JavaScript session. Claude Code and Codex have no such session, and Playwright's `browser_run_code_unsafe` runs code in a sandbox that cannot import a module, so a Claude Code or Codex fill worker gets a `prefill` host tool instead: the app runs the same script against the tab over CDP (`src/cdp-tab.ts`), through the scoped proxy, so its input is paced like the agent's.
- **Typing.** Playwright's `browser_type` sets a value all at once unless it is given `slowly: true`; the prompt requires it. `browser_fill_form`, `browser_close` and `browser_run_code_unsafe` are disallowed outright. A long answer typed in pieces needs `End` pressed before each later piece, since Playwright types at the caret.
- **WebMCP.** omp's browser adds `navigator.modelContext` unless the prompt's init script removes it; Playwright's server is started with `--no-webmcp`, and adds nothing to `navigator`.
- **Proxy.** Playwright asks for `/json/version/` and expects a page it creates to be announced before `Target.createTarget` replies; the scoped proxy allows both.

## Writing free-text answers

Workers load no skills (see Isolation above), so the humanizer skill reaches them through the prompt instead: `prompts/humanizer.md` is a copy of it (MIT, `prompts/humanizer.LICENSE`), and the fill and recheck prompts include it under "Editing a free-text answer", with a note on using it without anyone to ask. Every harness gets the same text, so an answer reads the same whether Claude Code, Codex or omp wrote it, including when a usage limit moves a fill from one to another. Answers copied unchanged from the answer bank or the candidate details are left as they are, and the answer-bank worker, which files the candidate's own words, does not get it. It adds about 8,000 tokens to each fill and recheck prompt.

## Differences that remain

- **Prefill timing.** A Claude Code fill waits for the prefill tool's reply (up to a few minutes on a long form) as one tool call; omp runs it as one `eval` call with a 180-second timeout.
- **Instructions, not enforcement.** Typing slowly, clicking before typing, and never setting values through `browser_evaluate` are prompt rules under both harnesses; Playwright's server cannot refuse a fast `browser_type` or close a tab through `browser_tabs` while allowing its other uses.
- **Model choice.** Claude Code has no model listing, so Settings shows its aliases (which follow the newest model of each family) with no prices; a full model name can be typed.
- **Verified locally, not on live sites.** A Claude Code fill has been run end to end against a local form through the scoped proxy (prefill, a dropdown, a free-text answer, the report), not yet against Greenhouse, Workday or a real CAPTCHA. The fill prompt's site-specific advice was written against omp's browser.
- **Codex, verified only in part.** A Codex worker has run against the real CLI (codex-cli 0.164) on Windows: a shell read and write in its sandbox and a host-tool call. A Codex fill against a real form, and a run in a freshly signed-in `data/codex` home (whose elevated sandbox may need setting up again), have not been tried yet.
