from __future__ import annotations

from ..backends.base import RawExtraction
from ..util import DimensionResult, contains_normalized


def score(truth: dict, ext: RawExtraction) -> DimensionResult:
    tokens = truth.get("must_appear_verbatim", [])
    if not tokens:
        return DimensionResult(name="copyable", score=1.0)

    findings: list[str] = []
    hits = 0
    for t in tokens:
        if contains_normalized(ext.text, t):
            hits += 1
        else:
            findings.append(f"verbatim token missing: {t!r}")

    # Skills are also checked here — flat list of all skill strings.
    skill_tokens: list[str] = []
    for cat, items in truth.get("skills", {}).items():
        for item in items:
            skill_tokens.append(item)

    skill_hits = 0
    for t in skill_tokens:
        if contains_normalized(ext.text, t):
            skill_hits += 1
        else:
            findings.append(f"skill missing: {t!r}")

    total = len(tokens) + len(skill_tokens)
    return DimensionResult(
        name="copyable",
        score=(hits + skill_hits) / total if total else 1.0,
        findings=findings,
        details={
            "verbatim_hits": f"{hits}/{len(tokens)}",
            "skill_hits": f"{skill_hits}/{len(skill_tokens)}",
        },
    )
