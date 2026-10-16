# Setup and running

## Prerequisites

The app is a [Bun](https://bun.sh) program (the version in `.bun-version`) and starts the rest itself. These must be on the service's `PATH`:

| Program | Used for |
|---|---|
| `omp` | every agent worker (`omp --mode rpc`); the fill prompt was verified against v18.8.7 (see [browser.md](browser.md)) |
| `google-chrome` | the browsers applications are filled in |
| `Xvfb`, `x11vnc`, `websockify` with noVNC in `/usr/share/novnc` | the virtual displays and their live view |
| `typst` | compiling the stock and tailored resumes |
| `pdfinfo`, `pdftoppm`, `pdftotext` (poppler-utils) | page counts, the resume preview, and the resume journal |
| `git` | the resume diff on a job's page, and the pre-commit hook |
| `tailscale` | optional: publishing the app to the tailnet |

`bun run check` needs only `pdftotext` (at `/usr/bin/pdftotext`, where the resume journal looks for it): the tests use throwaway state and inert browsers.

## Install

```bash
bun install                      # also points git at .githooks (pre-commit runs `bun run check`)
cp config.local.example.yml config.local.yml              # then edit: addresses, mailbox, resume file name
cp basic-resume/main.example.typ basic-resume/main.typ   # then replace with your own resume
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
systemctl --user restart auto-apply      # after editing config.yml or code
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

## Profile, Gmail and config

1. **Profile** (Profile tab, or edit `profile/` directly). Nothing is assessed or applied while a file still contains `TODO-FILL`.
   - `targets.md`: what you want, in plain language; drives triage and discovery.
   - `rubric.yml`: the scoring checklist. The agent answers each statement yes / no / unclear with evidence; the app computes the score from the weights, applies the required items and threshold, and decides apply / hold / skip. A required item marked `screen: false` is left out of the cheap pre-read that comes before the full assessment: use it for judgments, such as what kind of employer it is, and for items the cheap model gets wrong.
   - `basic-resume/`: the stock resume (Typst). `main.typ` is yours and not tracked; `main.example.typ` shows the shape. The agent tailors a per-job copy of `main.typ` and never edits the template `resume.typ`.
   - `resume-notes.md` (not tracked): optional bank of extra bullets/skills/examples the agent may swap in. Empty means reorder and trim only.
   - `personal.yml`, `answers.md`: form details and deliberately maintained standard answers. Inbox answers are application-local by default; they are never automatically appended to `answers.md`.
   - `companies.yml`: company boards to watch (`ats`: greenhouse, lever, ashby, workable, recruitee, smartrecruiters, workday). The discover step adds to it. A Workday slug is `<tenant>.<wdN>/<site>`; an optional `search:` narrows a large employer to matching titles.
2. **Gmail**: in Google Cloud, enable the Gmail API, create a Web OAuth client with redirect URI `<publicUrl>/oauth/callback`, save its JSON as `profile/gmail-client.json`, then Settings → Connect Gmail and sign in as the `mailbox` you configured. Scope is `gmail.modify`.
3. **`config.yml`**: phase, models per stage, schedule, daily caps, and `confirmBeforeSubmit` (gate 2). **`config.local.yml`** (not tracked; start from `config.local.example.yml`) is laid over it and holds what identifies you or this machine: `publicUrl`, `vncUrl`, `mailbox` and `resume.pdfName`.
