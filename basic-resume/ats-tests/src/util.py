from __future__ import annotations

import unicodedata
from dataclasses import dataclass, field
from typing import Any


@dataclass
class DimensionResult:
    """One scorer's output for one backend."""

    name: str
    score: float
    findings: list[str] = field(default_factory=list)
    details: dict[str, Any] = field(default_factory=dict)


def normalize(s: str) -> str:
    """NFKC normalize and collapse whitespace."""
    if s is None:
        return ""
    s = unicodedata.normalize("NFKC", s)
    return " ".join(s.split())


def contains_normalized(haystack: str, needle: str) -> bool:
    return normalize(needle).casefold() in normalize(haystack).casefold()


def fuzzy_contains(haystack: str, needle: str, threshold: int = 90) -> bool:
    """Substring-style fuzzy match. For short needles (<= 4 tokens) requires
    a stricter token_sort_ratio against windows of the haystack — otherwise
    `partial_token_set_ratio` happily accepts "Bachelor of Science" as a
    match for "Bachelor of Science, Computer Science"."""
    from rapidfuzz import fuzz

    h = normalize(haystack).casefold()
    n = normalize(needle).casefold()
    if not n:
        return True
    if n in h:
        return True

    needle_tokens = n.split()
    if len(needle_tokens) <= 4:
        hay_tokens = h.split()
        win = len(needle_tokens)
        for i in range(0, max(1, len(hay_tokens) - win + 1)):
            window = " ".join(hay_tokens[i : i + win])
            if fuzz.token_sort_ratio(n, window) >= threshold:
                return True
        return False
    return fuzz.partial_token_set_ratio(n, h) >= threshold
