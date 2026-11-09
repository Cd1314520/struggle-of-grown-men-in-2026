from __future__ import annotations

from .base import RawExtraction


class PdfMinerBackend:
    name = "pdfminer.six"

    def extract(self, pdf_path: str) -> RawExtraction:
        try:
            from pdfminer.high_level import extract_text
            from pdfminer.layout import LAParams
        except Exception as e:
            return RawExtraction(self.name, error=f"import failed: {e}")

        laparams = LAParams(
            char_margin=1.5,
            line_margin=0.4,
            word_margin=0.1,
            boxes_flow=0.5,
            detect_vertical=False,
        )
        try:
            text = extract_text(pdf_path, laparams=laparams) or ""
        except Exception as e:
            return RawExtraction(self.name, error=f"extract failed: {e}")

        lines = text.splitlines()
        return RawExtraction(
            backend_name=self.name,
            text=text,
            layout_lines=lines,
            links=[],
        )
