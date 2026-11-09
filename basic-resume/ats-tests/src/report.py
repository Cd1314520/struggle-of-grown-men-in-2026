from __future__ import annotations

import json
from pathlib import Path

from rich.console import Console
from rich.table import Table
from rich.text import Text

from .util import DimensionResult


DIMS = [
    "contact",
    "sections",
    "entries",
    "dates",
    "reading_order",
    "bullets",
    "glyphs",
    "copyable",
    "links",
]


def _cell(score: float, threshold: float) -> Text:
    txt = f"{score:.2f}"
    if score >= threshold:
        return Text(txt, style="green")
    if score >= threshold - 0.10:
        return Text(txt, style="yellow")
    return Text(txt, style="red bold")


def render(
    per_backend: dict[str, dict[str, DimensionResult]],
    best: dict[str, float],
    thresholds: dict[str, float],
    overall: float,
    overall_threshold: float,
    out_path: Path,
) -> None:
    console = Console()
    backend_names = list(per_backend.keys())

    table = Table(title="ATS Parsability Report", show_lines=False)
    table.add_column("dimension", style="bold")
    for b in backend_names:
        table.add_column(b)
    table.add_column("best", style="bold")
    table.add_column("threshold")

    for dim in DIMS:
        row: list = [dim]
        thr = thresholds.get(dim, 0.0)
        for b in backend_names:
            r = per_backend[b].get(dim)
            if r is None:
                row.append(Text("n/a", style="dim"))
            else:
                row.append(_cell(r.score, thr))
        row.append(_cell(best.get(dim, 0.0), thr))
        row.append(f"{thr:.2f}")
        table.add_row(*row)

    console.print(table)

    overall_color = "green" if overall >= overall_threshold else "red bold"
    console.print(
        f"\n[bold]overall:[/bold] [{overall_color}]{overall:.3f}[/{overall_color}] "
        f"(threshold {overall_threshold:.2f})"
    )

    console.print()
    for dim in DIMS:
        if best.get(dim, 0.0) >= thresholds.get(dim, 0.0):
            continue
        console.print(f"[red bold]FAIL {dim}[/red bold] (best={best.get(dim, 0.0):.2f})")
        for b in backend_names:
            r = per_backend[b].get(dim)
            if r is None or not r.findings:
                continue
            console.print(f"  \\[{b}]")
            for f in r.findings[:8]:
                console.print(f"    - {f}")
            if len(r.findings) > 8:
                console.print(f"    - ... and {len(r.findings) - 8} more")

    seen: set[str] = set()
    warn_lines: list[str] = []
    for b, dims in per_backend.items():
        for dim, r in dims.items():
            if not isinstance(r.details, dict):
                continue
            for w in r.details.get("warnings", []):
                key = f"{dim}|{w}"
                if key in seen:
                    continue
                seen.add(key)
                warn_lines.append(f"[{dim}] {w}")
    if warn_lines:
        console.print("\n[yellow]warnings (non-blocking):[/yellow]")
        for line in warn_lines:
            console.print(f"  - {line}")

    serializable = {
        "overall": overall,
        "overall_threshold": overall_threshold,
        "best_per_dimension": best,
        "thresholds": thresholds,
        "per_backend": {
            b: {
                dim: {
                    "score": r.score,
                    "findings": r.findings,
                    "details": r.details,
                }
                for dim, r in dims.items()
            }
            for b, dims in per_backend.items()
        },
    }
    out_path.write_text(json.dumps(serializable, indent=2, default=str), encoding="utf-8")
    console.print(f"\n[dim]wrote {out_path}[/dim]")
