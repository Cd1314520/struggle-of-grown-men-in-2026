from __future__ import annotations

import re

from ..backends.base import RawExtraction
from ..util import DimensionResult, normalize


# Canonical range: "May 2025 — Present", "Aug 2024 — Dec 2024".
# We accept em-dash (U+2014), en-dash (U+2013), or " - " ASCII hyphen with
# spaces, but a successful em-dash is the "ideal".
MONTH = r"(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?"
DATE_TOKEN = rf"(?:{MONTH}\s+\d{{4}}|\d{{4}}|Present)"
RANGE_RE = re.compile(
    rf"({DATE_TOKEN})\s*([—–\-])\s*({DATE_TOKEN})",
    re.I,
)
ASCII_DASH_BETWEEN_DATES = re.compile(
    rf"({DATE_TOKEN})\s*-\s*({DATE_TOKEN})",
    re.I,
)


def score(truth: dict, ext: RawExtraction) -> DimensionResult:
    text = normalize(ext.text)
    findings: list[str] = []

    # Collect every expected start_date / end_date pair from work + projects.
    expected_pairs: list[tuple[str, str]] = []
    for bucket in ("work", "projects"):
        for entry in truth.get(bucket, []):
            sd = entry.get("start_date")
            ed = entry.get("end_date")
            if sd and ed:
                expected_pairs.append((sd, ed))

    if not expected_pairs:
        return DimensionResult(name="dates", score=1.0)

    ranges_in_text = RANGE_RE.findall(text)
    em_dash_seen = any(sep == "—" for _, sep, _ in ranges_in_text)

    hits = 0
    for start, end in expected_pairs:
        found = False
        for s, _sep, e in ranges_in_text:
            # Exact-token compare so "2024" doesn't falsely match "Aug 2024".
            if s.strip().lower() == start.strip().lower() and \
               e.strip().lower() == end.strip().lower():
                found = True
                break
        if found:
            hits += 1
        else:
            findings.append(f"date range not found in canonical form: {start} — {end}")

    score_val = hits / len(expected_pairs)

    if truth.get("em_dash_required") and not em_dash_seen:
        findings.append("em-dash (U+2014) never appears in extracted dates")
        score_val *= 0.7

    bad_ascii = ASCII_DASH_BETWEEN_DATES.findall(text)
    if bad_ascii:
        findings.append(
            f"ASCII hyphen used between dates {bad_ascii!r} — should be em-dash"
        )
        score_val *= 0.9

    return DimensionResult(
        name="dates",
        score=max(0.0, score_val),
        findings=findings,
        details={
            "expected_pairs": expected_pairs,
            "ranges_in_text": ranges_in_text,
            "em_dash_seen": em_dash_seen,
        },
    )
