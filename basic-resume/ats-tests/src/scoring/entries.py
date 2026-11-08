from __future__ import annotations

from ..backends.base import RawExtraction
from ..util import DimensionResult, fuzzy_contains, normalize


def _window(text: str, anchor: str, radius: int = 600) -> str:
    """Text from radius/4 before the first occurrence of anchor to radius after it."""
    cf = text.casefold()
    idx = cf.find(anchor.casefold())
    if idx == -1:
        return ""
    return text[max(0, idx - radius // 4) : idx + radius]


def _score_entry(entry: dict, text: str, key_for_anchor: str) -> tuple[float, list[str]]:
    anchor = entry[key_for_anchor]
    window = _window(text, anchor)
    if not window:
        return 0.0, [f"entry anchor not found: {anchor!r}"]

    findings: list[str] = []
    parts = []
    for field in ("title", "company", "name", "issuer", "institution",
                  "location", "degree"):
        val = entry.get(field)
        if not val:
            continue
        ok = fuzzy_contains(window, val)
        parts.append(ok)
        if not ok:
            findings.append(
                f"entry {anchor!r}: {field}={val!r} not in surrounding text"
            )

    for field in ("start_date", "end_date", "date"):
        val = entry.get(field)
        if not val:
            continue
        ok = fuzzy_contains(window, val)
        parts.append(ok)
        if not ok:
            findings.append(f"entry {anchor!r}: {field}={val!r} not in window")

    if not parts:
        return 1.0, findings
    return sum(parts) / len(parts), findings


def score(truth: dict, ext: RawExtraction) -> DimensionResult:
    text = normalize(ext.text)
    all_scores: list[float] = []
    all_findings: list[str] = []

    for w in truth.get("work", []):
        s, f = _score_entry(w, text, key_for_anchor="title")
        all_scores.append(s)
        all_findings.extend(f)

    for e in truth.get("education", []):
        s, f = _score_entry(e, text, key_for_anchor="institution")
        all_scores.append(s)
        all_findings.extend(f)

    for p in truth.get("projects", []):
        s, f = _score_entry(p, text, key_for_anchor="name")
        all_scores.append(s)
        all_findings.extend(f)

    for c in truth.get("certifications", []):
        s, f = _score_entry(c, text, key_for_anchor="name")
        all_scores.append(s)
        all_findings.extend(f)

    avg = sum(all_scores) / len(all_scores) if all_scores else 1.0
    return DimensionResult(
        name="entries",
        score=avg,
        findings=all_findings,
        details={"per_entry": all_scores},
    )
