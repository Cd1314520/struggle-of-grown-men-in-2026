from __future__ import annotations

from ..backends.base import RawExtraction
from ..util import DimensionResult


BULLET_CHARS = ("•", "◦", "‣", "⁃", "▪", "▫", "●")


def _find_all_positions(text_cf: str, anchor: str) -> list[int]:
    needle = anchor.casefold()
    out: list[int] = []
    i = 0
    while True:
        j = text_cf.find(needle, i)
        if j == -1:
            return out
        out.append(j)
        i = j + len(needle)


def _count_bullets_in(text: str, start: int, end: int) -> int:
    n = 0
    for raw in text[start:end].splitlines():
        line = raw.lstrip()
        if line and line[0] in BULLET_CHARS:
            n += 1
    return n


def score(truth: dict, ext: RawExtraction) -> DimensionResult:
    text = ext.text
    if not text.strip():
        return DimensionResult(name="bullets", score=0.0, findings=["empty text"])
    text_cf = text.casefold()

    pairs: list[tuple[str, int]] = []
    for w in truth.get("work", []):
        pairs.append((w["title"], int(w.get("bullet_count", 0))))
    for e in truth.get("education", []):
        pairs.append((e["institution"], int(e.get("bullet_count", 0))))
    for p in truth.get("projects", []):
        pairs.append((p["name"], int(p.get("bullet_count", 0))))

    if not pairs:
        return DimensionResult(name="bullets", score=1.0)

    located: list[tuple[int, str, int]] = []
    missing: list[str] = []
    for anchor, exp in pairs:
        idx = text_cf.find(anchor.casefold())
        if idx == -1:
            missing.append(anchor)
        else:
            located.append((idx, anchor, exp))
    located.sort(key=lambda t: t[0])

    sect_positions = sorted(
        text_cf.find(h.casefold())
        for h in truth.get("sections", [])
        if text_cf.find(h.casefold()) != -1
    )

    findings: list[str] = [f"anchor not found: {m!r}" for m in missing]
    per_anchor: dict[str, float] = {m: 0.0 for m in missing}

    for i, (pos, anchor, expected) in enumerate(located):
        next_anchor_pos = located[i + 1][0] if i + 1 < len(located) else len(text)
        next_sect = next((s for s in sect_positions if s > pos), len(text))
        end = min(next_anchor_pos, next_sect)

        observed = _count_bullets_in(text, pos, end)
        if expected == 0:
            if observed == 0:
                per_anchor[anchor] = 1.0
            else:
                per_anchor[anchor] = 0.5
                findings.append(
                    f"bullets under {anchor!r}: expected 0, got {observed}"
                )
            continue

        diff = abs(observed - expected)
        if diff == 0:
            per_anchor[anchor] = 1.0
        elif diff == 1:
            per_anchor[anchor] = 0.75
            findings.append(
                f"bullets under {anchor!r}: expected ~{expected}, got {observed} (off by 1)"
            )
        elif diff == 2:
            per_anchor[anchor] = 0.4
            findings.append(
                f"bullets under {anchor!r}: expected ~{expected}, got {observed} (off by 2)"
            )
        else:
            per_anchor[anchor] = 0.0
            findings.append(
                f"bullets under {anchor!r}: expected ~{expected}, got {observed}"
            )

    score_vals = list(per_anchor.values())
    return DimensionResult(
        name="bullets",
        score=sum(score_vals) / len(score_vals) if score_vals else 1.0,
        findings=findings,
        details={"per_anchor": per_anchor},
    )
