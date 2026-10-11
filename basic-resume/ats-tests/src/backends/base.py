from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


@dataclass
class LinkAnnotation:
    url: str
    page: int


@dataclass
class RawExtraction:
    """What a single backend pulled out of the PDF.

    text:          plain reading-order text (whatever the backend gives by default)
    layout_lines:  list[str] preserving line breaks; columns may have collapsed
    links:         PDF link annotations (URL targets)
    backend_name:  short identifier for the report
    error:         non-None if extraction failed; other fields will be empty
    """

    backend_name: str
    text: str = ""
    layout_lines: list[str] = field(default_factory=list)
    links: list[LinkAnnotation] = field(default_factory=list)
    error: str | None = None


class Backend(Protocol):
    name: str

    def extract(self, pdf_path: str) -> RawExtraction: ...
