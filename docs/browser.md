# Browser

Real Chrome, headed on Xvfb display `:99`, persistent profile in `data/chrome-profile`, CDP on `127.0.0.1:9222`. `concurrency.fill` controls the browser-slot pool, not the number of parked applications: browser N (from 0) uses display `:99+N`, profile `data/chrome-profile-<N+1>`, CDP port `9222+2N`, pacing port `9223+2N` and noVNC port `6080+N`, and starts the first time it is needed. The extra profiles start empty, so their first visit to a site logs in again with the stored account. To reach an extra live view over the tailnet, publish its port the same way: `sudo tailscale serve --bg --https=6081 http://127.0.0.1:6081`. Agents connect through a pacing layer on port 9223 (`src/cdp-proxy.ts`) that turns their clicks into curved pointer paths and spaces keystrokes like a person's; Chrome is started with the machine's real GPU for WebGL. Live browser links use x11vnc + noVNC, started with Chrome and published on the tailnet at port 6080. Watch an active worker without interacting; to take over a stopped application, explicitly reserve its browser first. Unreserved parked applications do not expose a live link to a browser that another job may be using.

Open pages are what Chrome's memory goes on, so they are bounded. When a fill starts in a browser, that browser's tabs are pruned (`tabPlan` in `src/fill.ts`): pages of applications that are over (submitted, declined, rejected, skipped, held) are closed, and of the applications parked there on a question or a hand-off only the 8 most recently parked keep their page (`PARKED_TABS`). An application whose page was closed resumes like one whose browser died: from its stored answers, frozen resume and the draft the site saved. A page that may show whether a final submit went through is never closed while that outcome is unknown.

The running systemd user service uses `KillMode=process`, so restarting the Bun app leaves Chrome and its unsaved tabs alive. Killing Chrome, its display, or the machine is different: the worker must recover and verify an ATS-saved draft; a database checkpoint alone cannot restore unsaved page state.

## Browser Session Hiding & Fingerprint Audit

Anti-bot detection resistance is measured empirically using `scripts/browser-audit.ts`. The repository prioritises native headed Chrome consistency on real hardware over injected navigator/prototype/canvas lies.

The scoped proxy applies two native-consistency repairs. A UA-only override equal to Chrome's own `/json/version` User-Agent is forwarded as Chrome's native reset (`userAgent: ""`), preventing the frontend from erasing native Client Hints. Explicit custom UAs, metadata, language/platform overrides and resets retain their original semantics; failed native-version discovery leaves requests unchanged.

For object IDs received in `Runtime.consoleAPICalled`, the proxy converts only the frontend's exact eager JSON-materialization request into a genuine Chrome remote-object preview. No page console methods are patched, events dropped or responses fabricated. Warning/error text and primitive arguments remain visible; logged objects are descriptions rather than eagerly serialized structures. Intentional evaluation and serialization of non-console objects remain unchanged. Tracking is session-scoped, bounded and cleared with object/context/session lifecycles.

### Running the Audit

```bash
# Full diagnostic audit (all routes and public checkers)
bun run scripts/browser-audit.ts --mode=full

# Fast smoke run (direct, proxied, attached routes; sannysoft + botd)
bun run scripts/browser-audit.ts --mode=smoke --routes=direct,proxied,attached

# Custom options
bun run scripts/browser-audit.ts \
  --display=:188 \
  --cdp-port=19222 \
  --proxy-port=19223 \
  --checkers=sannysoft,browserscan,creepjs,botd,fingerprint_demo \
  --routes=direct,proxied,attached \
  --out=artifacts/browser-audit.json \
  --screenshot-dir=artifacts/screenshots
```

### Isolation & Teardown Guarantees

- **Preflight collision safety**: The runner checks X11 sockets (`/tmp/.X11-unix/X<display>`), lock files (`/tmp/.X<display>-lock`), and TCP ports before startup; if display or ports are occupied, it fails immediately rather than colliding with production sessions.
- **Scoped cleanup**: On normal exit, errors, or `SIGINT`/`SIGTERM`, the audit locates and kills only processes matching its own display and temporary profile path, unlinks only X sockets it created, and purges temporary files.
- **Route comparison**:
  - `direct`: Connects directly to Chrome's native CDP target (`/devtools/page/<id>`).
  - `proxied`: Connects to `prepareJobBrowser` scoped proxy tab WebSocket, testing worker tab isolation.
  - `attached`: Connects to scoped proxy browser WebSocket (`/devtools/browser/<guid>`) and attaches via `Target.attachToTarget` with `flatten: true`, testing CDP protocol-level worker attachment. *Note:* this tests the scoped proxy transport; actual worker agent frontend environments (such as `omp` browser tools) execute their own initialization scripts and require separate end-to-end verification.

Reports include native low/high-entropy UA data, observed HTTP User-Agent/Client Hints, wire-to-DOM consistency, navigator own properties, and individual CreepJS heuristic flags. Missing detector results are never assumed to be zero or clean. An unobserved CreepJS trust score is explicitly reported even when its native detector analysis completes; this does not establish a network failure. Raw CDP reports never claim frontend coverage.
### Empirical In-Browser Findings

- **`navigator.webdriver`**: Natively `false` in real headed Chrome with `--remote-debugging-port`. The prototype getter descriptor (`Object.getOwnPropertyDescriptor(Navigator.prototype, 'webdriver')`) is native (`function get webdriver() { [native code] }`, configurable and enumerable). No `--disable-blink-features=AutomationControlled` injection is needed.
- **Hardware WebGL & WebGL2**: Enabled through ANGLE Vulkan flags (`--use-gl=angle --use-angle=vulkan --enable-features=Vulkan --ignore-gpu-blocklist`). Chrome connects to the host's physical GPU render node (`/dev/dri/renderD128`, AMD Radeon 780M Graphics RADV PHOENIX). Removing these flags degrades virtual display rendering to `supported: false`; keeping them preserves genuine hardware renderer strings without software fallbacks (no SwiftShader or llvmpipe).
- **Media Devices**: The `--use-fake-device-for-media-stream` flag previously injected 7 synthetic mock devices (`fake_device_0`, `Fake Default Audio Input`, etc.), leaking mock hardware labels into the session. Removing it restores clean native desktop behavior: on a headless server without physical capture hardware, `navigator.mediaDevices.enumerateDevices()` returns `[]` and `getUserMedia` raises standard `NotFoundError`. Diagnostic permissions granted via CDP (`Browser.grantPermissions`) succeed cleanly without synthetic tracks.
- **Execution Context Consistency**: In-browser probes verify consistency across window, iframe, and DedicatedWorker contexts for User-Agent, platform, languages, and WebGL parameters.
### Industry Checker Comparison & Route Limitations

Empirical testing distinguishes between **Raw CDP Sessions** (measured by `scripts/browser-audit.ts` across `direct`, `proxied`, and protocol-level `attached` routes) and the **Actual `omp` Worker Frontend** (`browser.open` tool executed by application filling agents).

The repository intentionally avoids injecting client-side stealth scripts (such as `puppeteer-extra-plugin-stealth` or prototype lies) into `src/cdp-proxy.ts`, because synthetic prototype patches break under scrutiny. Under the worker automation frontend, BrowserScan initially flagged `Result: Robot` due to `Native Navigator: Abnormal`. Investigation distinguished the injected bridge from unrelated site-owned instrumentation:

1. **`navigator.modelContext`**: The `omp` browser tool attaches an optional WebMCP bridge that injects a non-native own property `modelContext` onto `navigator`. BrowserScan checks `Object.getOwnPropertyNames(navigator)` and flags any non-standard own properties.
2. **`Function.prototype.toString`**: BrowserScan's own website bundles `@sentry/browser` with its `FunctionToString` instrumentation; this was BrowserScan's own telemetry wrapping native functions, not an `omp` evasion artifact.

**Mitigation**: Every `browser.open` includes `init_scripts: ["globalThis.__ompWebMcpBridge_v1?.uninstall?.();"]`. Raw Puppeteer access can subsequently register another bridge initializer, so `prompts/fill.md` now attaches **without a URL**, initializes raw access and registers `page.evaluateOnNewDocument` with the same cleanup hook last, then immediately uninstalls any bridge on the existing document. Only a first fill then navigates to the posting. Resume initialization does not reload or navigate: actual typing, clicking and re-adoption retained the same document token and unsaved answer. Reused raw helpers followed by navigation were verified to keep navigator own keys empty.

*Maintenance / Upgrade Requirement:* The hook `__ompWebMcpBridge_v1` and eager-console request shape were observed with `omp` v18.8.7. Reverify hook ordering, native Client Hints and passive console capture after frontend upgrades rather than introducing fake prototype/getter patches.

The following compares the previous frontend measurement (`artifacts/worker-after/results.json`) with the revised **actual `omp browser.open` frontend**, not just its CDP transport:

| Checker | Previous frontend | Revised frontend | Interpretation |
| :--- | :--- | :--- | :--- |
| [Sannysoft](https://bot.sannysoft.com/) | 31 passed, 0 failed | 31 passed, 0 failed | Native webdriver and browser consistency retained. |
| [CreepJS](https://abrahamjuliot.github.io/creepjs/) | Like-headless 50%; lies/headless/stealth 0 | Like-headless 44%; lies/headless/stealth 0 | `uaDataIsBlank` is now false. Trust score unobserved, not counted as a complete pass. |
| [BrowserScan](https://www.browserscan.net/bot-detection) | Normal after bridge cleanup | Normal | Cleanup now survives raw-helper initialization; no synthetic navigator own properties. |
| [BotD](https://openfpcdn.io/botd/v2) | `bot: false` | `bot: false` | Open-source client-side detector, distinct from commercial Fingerprint Pro. |
| [Fingerprint Pro demo](https://demo.fingerprint.com/playground) | Bot not detected; DevTools detected; tampering false; suspect 14 | Bot not detected; DevTools detected; tampering false; suspect 14 | Residual DevTools signal remains despite passive console capture and bridge cleanup; high-activity signal is still true. |

Retained evidence: `artifacts/worker-current-weaknesses/results.json` and its screenshots cover the real frontend, local console canaries, explicit emulation, HTTP/frame/worker coherence and draft recovery. `artifacts/browser-audit-current-weaknesses.json` separately covers all three raw CDP routes against Sannysoft, BrowserScan, CreepJS and BotD; those routes have coherent native identity, but incomplete trust-score coverage. BrowserScan parsing uses its result badge rather than matching “robot” in explanatory page text.

The remaining CreepJS heuristic flags are `hasKnownBgColor`, `prefersLightColor`, `noTaskbar`, `noWebShare`, `noContentIndex`, `noContactsManager` and `noDownlinkMax`: native Linux/Chrome defaults and the bare Xvfb desktop, not detected webdriver, headless UA, SwiftShader or prototype lies. These are not falsified to force a lower score.

The platform does not claim universal checker passes or undetectable automation. Preventing tooling from invoking logged-object getters is independently proven, but does not eliminate the commercial DevTools signal. The suspect score is history/velocity-sensitive; repeated diagnostics are not a controlled test of that score. No IP identity rotation or detector-response alteration is used.

The remaining commercial DevTools signal was reproduced locally from the [observed SDK detector](https://demo.fingerprint.com/DBqbMN7zXxwl4Ei8/web/v4/jxtiFTDnTOrUU9NryTqx?ci=jsl/4.1.6): it assigns the native Promise resolver directly as an `Error.stack` getter and logs that error through a hidden iframe's timer. This is not equivalent to a script-defined getter canary. The same local probe resolves false with `Runtime` disabled, true with `Runtime.enable`, and true through the actual frontend, even with passive console capture. The current frontend relies on Runtime execution-context events; a proxy-only disable is not a safe transparent repair. Removing this residual signal requires a frontend/engine change, not additional navigator patches or fabricated CDP acknowledgements.
### Service Lifecycle & Flag Propagation Warning

Restarting the Bun service (`systemctl --user restart auto-apply`) **does not** restart Chrome or apply modified launch flags. Because the systemd unit uses `KillMode=process`, existing Chrome processes and open tabs remain alive across app restarts.

Launch flag modifications take effect only when a new Chrome process starts (e.g. after explicit slot termination or machine reboot). Terminating Chrome closes unsaved tabs and destroys in-memory DOM state; draft recovery relies on ATS-saved state verified in `prompts/fill.md`, not browser memory.
