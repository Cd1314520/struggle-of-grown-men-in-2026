from __future__ import annotations

from ..backends.base import RawExtraction
from ..util import DimensionResult, contains_normalized


def score(truth: dict, ext: RawExtraction) -> DimensionResult:
    expected = truth.get("links", [])
    if not expected:
        return DimensionResult(name="links", score=1.0)

    findings: list[str] = []
    url_hits = 0
    text_hits = 0

    # Only meaningful for backends that surface link annotations.
    backend_has_links = bool(ext.links)

    for spec in expected:
        url_needle = spec["url_contains"]
        vis_needle = spec["visible_text"]

        if backend_has_links:
            url_ok = any(url_needle.lower() in l.url.lower() for l in ext.links)
            if url_ok:
                url_hits += 1
            else:
                findings.append(f"link URL missing: {url_needle!r}")

        vis_ok = contains_normalized(ext.text, vis_needle)
        if vis_ok:
            text_hits += 1
        else:
            findings.append(f"link visible text missing: {vis_needle!r}")

    n = len(expected)
    if backend_has_links:
        s = (url_hits + text_hits) / (2 * n)
    else:
        # Backend can't surface link annotations at all — skip scoring rather
        # than inflate via visible-text-only. The orchestrator's "best across
        # backends" should pick a link-capable backend's score instead.
        s = None

    return DimensionResult(
        name="links",
        score=s if s is not None else 0.0,
        findings=findings,
        details={
            "backend_has_links": backend_has_links,
            "url_hits": url_hits,
            "text_hits": text_hits,
            "total": n,
            "skip_for_best": not backend_has_links,
        },
    )
