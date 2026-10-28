from __future__ import annotations

from collections import Counter

from ..backends.base import RawExtraction
from ..util import DimensionResult


def score(truth: dict, ext: RawExtraction) -> DimensionResult:
    text = ext.text
    findings: list[str] = []
    warnings: list[str] = []

    banned = {int(g["codepoint"], 16): g["name"] for g in truth.get("banned_glyphs", [])}
    banned_hits: Counter[int] = Counter()
    for ch in text:
        cp = ord(ch)
        if cp in banned:
            banned_hits[cp] += 1

    for cp, n in banned_hits.items():
        findings.append(
            f"banned glyph U+{cp:04X} ({banned[cp]}) appears {n} time(s)"
        )

    warn = {int(g["codepoint"], 16): g["name"] for g in truth.get("warn_glyphs", [])}
    warn_hits: Counter[int] = Counter()
    for ch in text:
        cp = ord(ch)
        if cp in warn:
            warn_hits[cp] += 1
    for cp, n in warn_hits.items():
        warnings.append(
            f"suspect glyph U+{cp:04X} ({warn[cp]}) appears {n} time(s)"
        )

    pua_whitelist = {int(c, 16) for c in truth.get("pua_whitelist", [])}
    pua_hits: Counter[int] = Counter()
    for ch in text:
        cp = ord(ch)
        if 0xE000 <= cp <= 0xF8FF and cp not in pua_whitelist:
            pua_hits[cp] += 1
    for cp, n in pua_hits.items():
        findings.append(
            f"private-use codepoint U+{cp:04X} appears {n} time(s) "
            f"(likely font-subset glyph an ATS can't decode)"
        )

    total_failing = sum(banned_hits.values()) + sum(pua_hits.values())
    score_val = 1.0 if total_failing == 0 else 0.0

    return DimensionResult(
        name="glyphs",
        score=score_val,
        findings=findings,
        details={
            "banned_hits": dict(banned_hits),
            "warn_hits": dict(warn_hits),
            "pua_hits": dict(pua_hits),
            "warnings": warnings,
        },
    )
