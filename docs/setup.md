# Setup and running

## Prerequisites

The app is a [Bun](https://bun.sh) program (the version in `.bun-version`) and starts the rest itself. These must be on the service's `PATH`:

| Program | Used for |
|---|---|
| `omp` | agent workers on omp's models (`omp --mode rpc`); the fill prompt was verified against v18.8.7 (see [browser.md](browser.md)) |
| `claude` | agent workers on `claude-code/…` models (`claude -p`, signed in with `claude auth login`); see [harnesses.md](harnesses.md) |
| `npx` | Playwright's browser tools, for a fill on a `claude-code/…` model |
| `google-chrome` | the browsers applications are filled in |
| `Xvfb`, `x11vnc`, `websockify` with noVNC in `/usr/share/novnc` | the virtual displays and their live view |
| `typst` | compiling the stock and tailored resumes |
| `pdfinfo`, `pdftoppm`, `pdftotext` (poppler-utils) | page counts, the resume preview, and the resume journal |
| `git` | the resume diff on a job's page, and the pre-commit hook |
| `tailscale` | optional: publishing the app to the tailnet |

`bun run check` needs only `pdftotext` (at `/usr/bin/pdftotext`, where the resume journal looks for it): the tests use throwaway state and inert browsers.

## Install

The app's **Setup** page (`#setup`) walks a new install through what follows and checks each step against the machine as it is: the programs on the service's `PATH` (omp or Claude Code, whichever the stages use), a model provider one of them can reach, `config.local.yml`, the resume, the profile, Gmail and the first scan. The sidebar counts the required steps left.

```bash
bun install                      # also points git at .githooks (pre-commit runs `bun run check`)
cp config.local.example.yml config.local.yml              # then edit: addresses, mailbox, resume file name
mkdir -p ~/.config/systemd/user
cp deploy/systemd/* ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now auto-apply.service auto-apply-journal.timer
loginctl enable-linger "$USER"   # keep it running after logout and across reboots
```

The units in `deploy/systemd/` assume the repository is at `~/auto-apply` (`%h` is your home directory) and Bun at `/usr/bin/bun`; change `WorkingDirectory`, `ExecStart` and `PATH` for another location. After editing a unit here, copy it again and run `systemctl --user daemon-reload`.

- `auto-apply.service`: the app. `KillMode=process` leaves Chrome and its tabs alive when the app restarts; `Restart=on-failure` brings the app back after a crash.
- `auto-apply-journal.service` and `.timer`: the [observation journal](operations.md#observation-journal), every three hours.

## Run

Runs as a systemd user service (`~/.config/systemd/user/auto-apply.service`, lingering enabled so it survives logout and reboot):

```bash
systemctl --user status auto-apply
systemctl --user restart auto-apply      # after editing config.yml or code, or a setting that waits for a restart
journalctl --user -u auto-apply -f
```

The app itself listens on `127.0.0.1:8787` only. `tailscale serve` publishes it to the tailnet (not the internet):

- App: `publicUrl`, for example `https://your-machine.your-tailnet.ts.net:8787`
- Live browser (noVNC): `vncUrl`, the same host on port 6080

There is no login on the app: anyone on the tailnet can approve applications and see stored site passwords. To unpublish: `sudo tailscale serve --https=8787 off` (and `6080`).

What the app does check is where a request comes from (`refusal` in `src/server.ts`). The browsers it drives visit arbitrary sites on this machine, so:

- every request must be addressed to the app under a name of its own: `127.0.0.1`, `localhost`, or the host in `publicUrl`. A hostname re-pointed at this machine is refused.
- a request that changes something must also come from one of the app's own pages. A page on any other site posting to the local port is refused with 403. Command-line clients, which send no `Origin`, are unaffected.

If you reach the app under another name, set `publicUrl` to it.

## Windows (WSL2)

The app does not run on Windows itself (Xvfb, `setsid`, X11 sockets, systemd), but it runs in a WSL2 Linux distro with the steps above. Inside WSL, systemd still runs the app; a Windows scheduled task only keeps the distro up. Untested so far.

1. **Distro**: `wsl --install -d Ubuntu` in an elevated PowerShell, then open Ubuntu and create your user.
2. **Repository**: clone it to `~/auto-apply` inside the distro, not under `/mnt/c`: the Windows drive is slow from WSL and its line endings and permissions break the hooks and `chmod`.
3. **systemd**: `sudo cp ~/auto-apply/deploy/wsl/wsl.conf /etc/wsl.conf`, then `wsl --shutdown` from Windows and reopen Ubuntu. `systemctl --user status` should answer.
4. **Programs**: the prerequisites above, from apt where it has them: `sudo apt install xvfb x11vnc websockify novnc poppler-utils git unzip`, Chrome from Google's `.deb`, Bun at the version in `.bun-version` (its installer puts it in `~/.bun/bin`; `sudo ln -s ~/.bun/bin/bun /usr/bin/bun` so the units find it), and `typst` from its release binary into `~/.local/bin`.
5. **Service**: [Install](#install) as on Linux, `loginctl enable-linger` included.
6. **Keepalive**: WSL stops a distro soon after its last `wsl.exe` session closes, services or not. From an elevated PowerShell on Windows, run `deploy/wsl/install-keepalive.ps1` (reach it as `\\wsl$\Ubuntu\home\<you>\auto-apply\deploy\wsl\`, or copy it out):

   ```powershell
   powershell -ExecutionPolicy Bypass -File install-keepalive.ps1 -Distro Ubuntu
   ```

   It registers `auto-apply WSL keepalive`, which runs `wsl.exe -d Ubuntu --exec sleep infinity` at boot whether or not you are logged on, with no time limit, and restarts it if it exits. If the task does not stay running, open it in Task Scheduler and switch it to "Run only when user is logged on" with an "At log on" trigger.
7. **Sleep**: a sleeping PC pauses the distro too. `powercfg /change standby-timeout-ac 0` keeps it awake on mains power.

`http://localhost:8787` and `:6080` reach the app from Windows through WSL's localhost forwarding. Chrome's GL flags (`src/chrome.ts`) expect a render node at `/dev/dri/renderD128`, which WSL2 may not have; without it Chrome may fall back to software rendering and change the WebGL fingerprint, so run the [browser audit](browser.md) before the first real application.

## Profile, Gmail and config

1. **Profile** (Profile tab, or edit `profile/` directly). `profile/` is not tracked: on start, the app copies each file of `profile.example/` that is missing from it (never over one that exists), so a fresh checkout starts from working templates. Nothing is assessed or applied while a file still contains `TODO-FILL`; the examples carry it only where the choice is yours (`targets.md`, `personal.yml`, `answers.md`).
   - `targets.md`: what you want, in plain language; drives triage and discovery.
   - `rubric.yml`: the scoring checklist. The agent answers each statement yes / no / unclear with evidence; the app computes the score from the weights, applies the required items and threshold, and decides apply / hold / skip. A required item marked `screen: false` is left out of the cheap pre-read that comes before the full assessment: use it for judgments, such as what kind of employer it is, and for items the cheap model gets wrong.
   - `basic-resume/`: the stock resume (Typst). `main.typ` is yours and not tracked; `main.example.typ` shows the shape. The agent tailors a per-job copy of `main.typ` and never edits the template `resume.typ`. The **Resume** page (`#resume`) builds `main.typ` from whatever files you upload (any format, up to 8 files, 20 MB together): the `import` worker (`src/resume-import.ts`, `prompts/import.md`) writes it on the template and moves what does not fit into `resume-notes.md`, the host compiles the draft, and you can ask for changes before you accept it. Accepting keeps the files it replaced in `data/resume-import/history/`. "Start from the example" copies `main.example.typ` with a `TODO-FILL` line, so nothing is applied with the example's made-up person.
   - `resume-notes.md` (not tracked): optional bank of extra bullets/skills/examples the agent may swap in. Empty means reorder and trim only.
   - `personal.yml`, `answers.md`: form details and standard answers. Answers you keep on Questions are added to `answers.md` by an agent, which edits the entries as it sees fit (see operations.md).
   - `employers.yml`: employers settled by hand: `frontier` (the real targets, never spent on practice) and `practice`.
   - `companies.yml`: company boards to watch; it starts with the 1,800-odd boards found so far (`ats`: greenhouse, lever, ashby, workable, recruitee, smartrecruiters, workday). The discover step adds to it. A Workday slug is `<tenant>.<wdN>/<site>`; an optional `search:` narrows a large employer to matching titles.
2. **Gmail**: in Google Cloud, enable the Gmail API, create a Web OAuth client with redirect URI `<publicUrl>/oauth/callback`, save its JSON as `profile/gmail-client.json`, then Settings → Connect Gmail and sign in as the `mailbox` you configured. Scope is `gmail.modify`.
3. **`config.yml`**: approval (`auto` or `gated`), target employers and whether they are held back, models per stage, schedule and daily caps. The Settings page changes every one of them, writing to `config.local.yml`: from the next read, or for `port`, `chrome`, `concurrency.fill` and `resume` from the next restart, which the page says. Settings → Models picks each stage's model from what `omp models` lists (prices per million tokens beside each) and Claude Code's aliases (`claude-code/…`; see [harnesses.md](harnesses.md)) and writes the choice to `config.local.yml`; it takes effect from that stage's next run, with no restart. A model neither lists can still be typed by name. **`config.local.yml`** (not tracked; start from `config.local.example.yml`) is laid over it and holds what identifies you or this machine: `publicUrl`, `vncUrl`, `mailbox` and `resume.pdfName`.
