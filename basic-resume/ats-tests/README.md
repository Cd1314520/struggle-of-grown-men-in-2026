# ATS Parsability Test Suite

A local, deterministic test harness that scores how well `main.pdf` (compiled
from `main.typ`) survives ATS-style extraction. Catches the failure modes
Typst PDFs are most prone to: ligature artefacts, smart-quote / em-dash
mojibake, font-subset non-copyable glyphs, swallowed link text, broken
reading order, and missing section headings.

This is **not** a Workday/Greenhouse/Taleo guarantee — it's a regression
tool. If a known-good resume scores X today, you'll know immediately when an
edit drops it to Y.

## Quick start

Requires [uv](https://docs.astral.sh/uv/) on PATH. No manual `pip install` —
`uv run` syncs the venv from `pyproject.toml` on first invocation.

```powershell
.\ats-tests\run_ats.ps1
```

The script auto-runs `typst compile main.typ` first, so you don't need to
remember.

Exit code is `0` if every dimension meets its threshold in
`ats-tests/thresholds.yaml`, non-zero otherwise.

## Layout

```
ats-tests/
  ats_truth.yaml         ground truth — update when main.typ changes
  thresholds.yaml        per-dimension pass thresholds
  run_ats.ps1            one-command entrypoint
  last_run.json          machine-readable last-run report (gitignored)
  src/					 project source
```

## When a test fails

1. Run `.\ats-tests\run_ats.ps1` and read the Rich table.
2. Inspect `ats-tests/last_run.json` for findings detail per dimension.
3. If the resume changed legitimately, update `ats_truth.yaml`.
4. If the resume regressed, fix `main.typ` / `resume.typ`.

## Adding a backend

Implement `backends/base.py::Backend` and register it in
`__main__.py::BACKENDS`. Each backend is scored independently; the suite
reports the **best** score per dimension (any ATS that can read it counts as
"can be read") and the **worst** score per dimension (any ATS that mangles
it counts as a risk).
