# Harnesses

Every piece of agent work is one process started by `runWorker` (`src/worker.ts`) with a prompt, a working directory, the built-in tools it may use, and the host tools it reports through. Which program runs it follows from the stage's model in `models.<stage>`:

| Model | Harness | Client |
|---|---|---|
| `claude-code/<model>`: `claude-code/opus`, `claude-code/sonnet`, `claude-code/default`, or a full model name such as `claude-code/claude-opus-5-5` | Claude Code, `claude -p`, signed in as `claude auth status` shows | `src/claude.ts` |
| anything else, or null (omp's default) | omp, `omp --mode rpc` | `src/omp.ts` |

Each stage picks its own, so filling can stay on omp while assessing runs on Claude Code, or the other way round. Settings → Models lists both: omp's own listing, and Claude Code's aliases once `claude` is signed in. Setup requires only the harnesses the stages use, and `npx` when a Claude Code model fills applications.

## What each harness is given

| | omp | Claude Code |
|---|---|---|
| Host tools | `set_host_tools` over the RPC channel | an MCP server ("host") the app serves on a private localhost port, with a token, for the worker's lifetime: `mcp__host__<name>` |
| `read` | `read` | `Read`, `Glob` |
| `write`, `edit`, `bash` | the same | `Write`, `Edit`, `Bash` |
| `web_search` | `web_search` | `WebSearch`, `WebFetch` |
| `eval` | its JavaScript session | none (see the fill worker below) |
| Browser | omp's browser tool over CDP | Playwright's MCP server (`@playwright/mcp`, pinned in `src/claude.ts`), started with `--cdp-endpoint`, `--no-webmcp` and `--caps vision` |
| Permissions | `approvalMode: yolo` | `--permission-mode bypassPermissions` |
| Isolation | `--no-extensions --no-rules --no-skills --no-lsp` | `--setting-sources ""` (no CLAUDE.md, settings, hooks or plugins), `--strict-mcp-config`, `--disable-slash-commands`, `--no-chrome` |
| System prompt | `prompts/system.md` appended | the same, plus a line naming the `mcp__host__` prefix |
| Time limit | `--max-time` | a timer in the client that stops the process |
| Abort | an `abort` frame, then a kill after 3 s | SIGTERM, then SIGKILL after 3 s |
| Transcript | `data/sessions/<worker>/` | Claude Code's own store (`~/.claude/projects/`); the session id is in the log line of any worker that does not complete |
| Activity log | omp's `intent` per tool call | the tool and what it acts on (a description, element, URL, query or path; never typed text) |
| Capacity | errors matched by `isCapacityError` | the same, plus a rejected `rate_limit_event` and "You've hit your … limit" |

## The fill worker

Both harnesses drive the same browser through the same scoped pacing proxy (`src/cdp-proxy.ts`), so tab scoping, input pacing and checkpoints are the same. What differs is in the prompt: `prompts/fill.md` takes its browser section from `prompts/browser-omp.md` or `prompts/browser-claude.md`.

- **Prefill.** omp's fill agent imports `src/prefill.ts` into its JavaScript session. Claude Code has no such session, and Playwright's `browser_run_code_unsafe` runs code in a sandbox that cannot import a module, so a Claude Code fill worker gets a `prefill` host tool instead: the app runs the same script against the tab over CDP (`src/cdp-tab.ts`), through the scoped proxy, so its input is paced like the agent's.
- **Typing.** Playwright's `browser_type` sets a value all at once unless it is given `slowly: true`; the prompt requires it. `browser_fill_form`, `browser_close` and `browser_run_code_unsafe` are disallowed outright. A long answer typed in pieces needs `End` pressed before each later piece, since Playwright types at the caret.
- **WebMCP.** omp's browser adds `navigator.modelContext` unless the prompt's init script removes it; Playwright's server is started with `--no-webmcp`, and adds nothing to `navigator`.
- **Proxy.** Playwright asks for `/json/version/` and expects a page it creates to be announced before `Target.createTarget` replies; the scoped proxy allows both.

## Differences that remain

- **Prefill timing.** A Claude Code fill waits for the prefill tool's reply (up to a few minutes on a long form) as one tool call; omp runs it as one `eval` call with a 180-second timeout.
- **Instructions, not enforcement.** Typing slowly, clicking before typing, and never setting values through `browser_evaluate` are prompt rules under both harnesses; Playwright's server cannot refuse a fast `browser_type` or close a tab through `browser_tabs` while allowing its other uses.
- **Model choice.** Claude Code has no model listing, so Settings shows its aliases (which follow the newest model of each family) with no prices; a full model name can be typed.
- **Verified locally, not on live sites.** A Claude Code fill has been run end to end against a local form through the scoped proxy (prefill, a dropdown, a free-text answer, the report), not yet against Greenhouse, Workday or a real CAPTCHA. The fill prompt's site-specific advice was written against omp's browser.
