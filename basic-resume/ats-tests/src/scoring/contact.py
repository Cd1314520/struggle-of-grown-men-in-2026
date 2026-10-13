from __future__ import annotations

import re

from ..backends.base import RawExtraction
from ..util import DimensionResult, contains_normalized, normalize


EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
# Loose: matches +1 (555) 010-0100, 555-010-0100, etc.
PHONE_RE = re.compile(r"(?:\+?\d{1,2}[\s\-.])?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}")
LINKEDIN_RE = re.compile(r"linkedin\.com/in/[A-Za-z0-9\-_/]+", re.I)


def _digits(s: str) -> str:
    return re.sub(r"\D", "", s)


def score(truth: dict, ext: RawExtraction) -> DimensionResult:
    text = ext.text
    findings: list[str] = []
    checks: list[tuple[str, bool]] = []

    # Name
    name_ok = contains_normalized(text, truth["contact"]["name"])
    checks.append(("name", name_ok))
    if not name_ok:
        findings.append(f"name not found: {truth['contact']['name']!r}")

    # Email — both expected literal and any regex hit
    expected_email = truth["contact"]["email"]
    email_literal = contains_normalized(text, expected_email)
    emails_found = EMAIL_RE.findall(text)
    email_ok = email_literal or any(
        e.lower() == expected_email.lower() for e in emails_found
    )
    checks.append(("email", email_ok))
    if not email_ok:
        findings.append(
            f"email {expected_email!r} not found; regex saw {emails_found}"
        )

    # Phone — digit-compare so format differences don't matter
    expected_phone_digits = _digits(truth["contact"]["phone"])
    phones_found = PHONE_RE.findall(text)
    phone_ok = any(
        expected_phone_digits.endswith(_digits(p)[-10:])
        and len(_digits(p)) >= 10
        for p in phones_found
    )
    # also accept literal match (handles split-by-space cases)
    if not phone_ok and expected_phone_digits[-10:] in _digits(text):
        phone_ok = True
    checks.append(("phone", phone_ok))
    if not phone_ok:
        findings.append(f"phone digits {expected_phone_digits} not recoverable")

    # Location
    loc_ok = contains_normalized(text, truth["contact"]["location"])
    checks.append(("location", loc_ok))
    if not loc_ok:
        findings.append(f"location not found: {truth['contact']['location']!r}")

    # LinkedIn
    expected_li = truth["contact"]["linkedin"]
    li_literal = contains_normalized(text, expected_li)
    li_regex = bool(LINKEDIN_RE.search(normalize(text)))
    li_ok = li_literal or li_regex
    checks.append(("linkedin", li_ok))
    if not li_ok:
        findings.append(f"linkedin not found: {expected_li!r}")

    # Optional fields are only counted if expected.
    for opt in ("github", "personal_site"):
        expected = truth["contact"].get(opt, "")
        if expected:
            ok = contains_normalized(text, expected)
            checks.append((opt, ok))
            if not ok:
                findings.append(f"{opt} not found: {expected!r}")

    hits = sum(1 for _, ok in checks if ok)
    total = len(checks)
    return DimensionResult(
        name="contact",
        score=hits / total if total else 1.0,
        findings=findings,
        details={"checks": dict(checks)},
    )
