from __future__ import annotations

from ..backends.base import RawExtraction
from ..util import DimensionResult, normalize


def score(truth: dict, ext: RawExtraction) -> DimensionResult:
    expected = truth["sections"]
    text_cf = normalize(ext.text).casefold()
    findings: list[str] = []

    found_positions: list[tuple[str, int]] = []
    for heading in expected:
        idx = text_cf.find(heading.casefold())
        if idx == -1:
            findings.append(f"section heading not found: {heading!r}")
        else:
            found_positions.append((heading, idx))

    present = len(found_positions)
    total = len(expected)
    presence_score = present / total if total else 1.0

    # Order check: positions must be monotonically increasing among the
    # headings we did find. Order failures are reported but do not directly
    # subtract — sections score weights presence; reading_order owns ordering
    # of bullets vs headings.
    last = -1
    order_ok = True
    for h, idx in found_positions:
        if idx < last:
            order_ok = False
            findings.append(f"section {h!r} appears out of order at offset {idx}")
            break
        last = idx

    # Hard penalty for out-of-order sections: a swapped Education/Work
    # ordering in source should fail the suite, not be quietly absorbed by
    # the "× 0.8" of a near-perfect presence score.
    if not order_ok:
        presence_score = min(presence_score, 0.5)

    return DimensionResult(
        name="sections",
        score=presence_score,
        findings=findings,
        details={
            "expected": expected,
            "found": [h for h, _ in found_positions],
            "order_ok": order_ok,
        },
    )
