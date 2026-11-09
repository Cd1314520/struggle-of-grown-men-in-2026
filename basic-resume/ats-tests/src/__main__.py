from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

for stream in (sys.stdout, sys.stderr):
    try:
        stream.reconfigure(encoding="utf-8")
    except Exception:
        pass

import yaml

from .backends.base import RawExtraction
from .backends.pdfminer_backend import PdfMinerBackend
from .backends.pypdf_backend import PyPdfBackend
from .report import DIMS, render
from .scoring import (
    bullets,
    contact,
    copyable,
    dates,
    entries,
    glyphs,
    links,
    reading_order,
    sections,
)
from .util import DimensionResult


SCORERS = {
    "contact": contact.score,
    "sections": sections.score,
    "entries": entries.score,
    "dates": dates.score,
    "reading_order": reading_order.score,
    "bullets": bullets.score,
    "glyphs": glyphs.score,
    "copyable": copyable.score,
    "links": links.score,
}

BACKENDS = [PdfMinerBackend(), PyPdfBackend()]


def _compile_typst(repo_root: Path) -> None:
    typst = shutil.which("typst")
    src = repo_root / "main.typ"
    out = repo_root / "main.pdf"
    if typst is None:
        if src.exists() and out.exists() and src.stat().st_mtime > out.stat().st_mtime:
            print(
                f"typst not on PATH and main.pdf is stale (older than main.typ). "
                f"Install typst or pass --no-compile knowingly.",
                file=sys.stderr,
            )
            sys.exit(2)
        print("typst not on PATH — using existing main.pdf (not stale)",
              file=sys.stderr)
        return
    result = subprocess.run(
        [typst, "compile", str(src), str(out)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print("typst compile failed:", file=sys.stderr)
        print(result.stderr, file=sys.stderr)
        sys.exit(2)


REQUIRED_TRUTH_KEYS = (
    "contact", "sections", "work", "education", "projects",
    "certifications", "skills", "must_appear_verbatim",
    "banned_glyphs", "links",
)
REQUIRED_CONTACT_KEYS = ("name", "email", "phone", "location", "linkedin")


def _validate_truth(truth: dict) -> None:
    """Hard-fail on a malformed truth file instead of silently scoring 1.0."""
    missing = [k for k in REQUIRED_TRUTH_KEYS if k not in truth]
    if missing:
        print(f"ats_truth.yaml missing required top-level keys: {missing}",
              file=sys.stderr)
        sys.exit(2)
    contact = truth.get("contact") or {}
    cmissing = [k for k in REQUIRED_CONTACT_KEYS if k not in contact]
    if cmissing:
        print(f"ats_truth.yaml: contact missing keys: {cmissing}",
              file=sys.stderr)
        sys.exit(2)


def _run(pdf_path: Path, truth_path: Path, thresholds_path: Path,
         out_path: Path) -> int:
    truth = yaml.safe_load(truth_path.read_text(encoding="utf-8"))
    thresholds = yaml.safe_load(thresholds_path.read_text(encoding="utf-8"))
    _validate_truth(truth)

    per_backend: dict[str, dict[str, DimensionResult]] = {}
    extractions: list[RawExtraction] = []
    for backend in BACKENDS:
        ext: RawExtraction = backend.extract(str(pdf_path))
        if ext.error:
            print(f"[{backend.name}] extraction error: {ext.error}",
                  file=sys.stderr)
            per_backend[backend.name] = {}
            continue
        if not ext.text.strip():
            print(f"[{backend.name}] extraction returned empty text — skipping scorers",
                  file=sys.stderr)
            per_backend[backend.name] = {}
            continue
        extractions.append(ext)
        results: dict[str, DimensionResult] = {}
        for dim, scorer in SCORERS.items():
            try:
                results[dim] = scorer(truth, ext)
            except Exception as e:
                results[dim] = DimensionResult(
                    name=dim, score=0.0,
                    findings=[f"scorer crashed: {type(e).__name__}: {e}"],
                )
        per_backend[backend.name] = results

    if len(extractions) >= 2:
        def _text_quality(e: RawExtraction) -> float:
            r = per_backend.get(e.backend_name, {}).get("copyable")
            return r.score if r else 0.0
        best_text_ext = max(extractions, key=_text_quality)
        merged_text = best_text_ext.text
        merged_links = []
        seen_urls: set[str] = set()
        for e in extractions:
            for link in e.links:
                if link.url not in seen_urls:
                    merged_links.append(link)
                    seen_urls.add(link.url)
        merged_ext = RawExtraction(
            backend_name="merged",
            text=merged_text,
            layout_lines=merged_text.splitlines(),
            links=merged_links,
        )
        try:
            per_backend["merged"] = {"links": SCORERS["links"](truth, merged_ext)}
        except Exception as e:
            per_backend["merged"] = {
                "links": DimensionResult(
                    name="links", score=0.0,
                    findings=[f"merged scorer crashed: {type(e).__name__}: {e}"],
                )
            }

    best: dict[str, float] = {}
    for dim in DIMS:
        scores: list[float] = []
        for b in per_backend:
            r = per_backend[b].get(dim)
            if r is None:
                continue
            if isinstance(r.details, dict) and r.details.get("skip_for_best"):
                continue
            scores.append(r.score)
        if not scores:
            scores = [
                per_backend[b][dim].score
                for b in per_backend
                if dim in per_backend[b]
            ]
        best[dim] = max(scores) if scores else 0.0

    overall = sum(best.values()) / len(best) if best else 0.0
    overall_threshold = float(thresholds.get("overall", 0.0))

    render(per_backend, best, thresholds, overall, overall_threshold, out_path)

    failures = [
        dim for dim in DIMS
        if best.get(dim, 0.0) < float(thresholds.get(dim, 0.0))
    ]
    if failures or overall < overall_threshold:
        print(f"\nFAIL: dimensions below threshold: {failures or ['overall']}")
        return 1
    print("\nPASS")
    return 0


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    ap = argparse.ArgumentParser(prog="ats-tests")
    ap.add_argument("--pdf", default=str(repo_root / "main.pdf"))
    ap.add_argument("--truth", default=str(repo_root / "ats-tests" / "ats_truth.yaml"))
    ap.add_argument("--thresholds",
                    default=str(repo_root / "ats-tests" / "thresholds.yaml"))
    ap.add_argument("--out",
                    default=str(repo_root / "ats-tests" / "last_run.json"))
    ap.add_argument("--no-compile", action="store_true",
                    help="Skip typst recompile; use existing main.pdf")
    args = ap.parse_args()

    if not args.no_compile:
        _compile_typst(repo_root)

    return _run(
        Path(args.pdf),
        Path(args.truth),
        Path(args.thresholds),
        Path(args.out),
    )


if __name__ == "__main__":
    sys.exit(main())
