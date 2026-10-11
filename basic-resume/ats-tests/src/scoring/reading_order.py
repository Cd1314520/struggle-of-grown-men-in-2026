from __future__ import annotations

from ..backends.base import RawExtraction
from ..util import DimensionResult, normalize


def score(truth: dict, ext: RawExtraction) -> DimensionResult:
    """Verify each work / project anchor appears AFTER its section heading
    in the linear text stream. Catches multi-column collapse where bullets
    end up before the heading they belong to."""

    text_cf = normalize(ext.text).casefold()
    findings: list[str] = []

    pairs: list[tuple[str, str]] = []
    for w in truth.get("work", []):
        pairs.append(("Work Experience", w["title"]))
    for p in truth.get("projects", []):
        pairs.append(("Projects", p["name"]))
    for e in truth.get("education", []):
        pairs.append(("Education", e["institution"]))
    for c in truth.get("certifications", []):
        pairs.append(("Certifications", c["name"]))

    if not pairs:
        return DimensionResult(name="reading_order", score=1.0)

    hits = 0
    for heading, child in pairs:
        h_idx = text_cf.find(heading.casefold())
        c_idx = text_cf.find(child.casefold())
        if h_idx == -1 or c_idx == -1:
            findings.append(
                f"reading-order check skipped: heading={heading!r} h_idx={h_idx} "
                f"child={child!r} c_idx={c_idx}"
            )
            continue
        if c_idx > h_idx:
            hits += 1
        else:
            findings.append(
                f"reading-order violation: {child!r} appears before its heading "
                f"{heading!r} (child={c_idx}, heading={h_idx})"
            )

    return DimensionResult(
        name="reading_order",
        score=hits / len(pairs) if pairs else 1.0,
        findings=findings,
    )
