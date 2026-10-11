from __future__ import annotations

from .base import LinkAnnotation, RawExtraction


class PyPdfBackend:
    name = "pypdf"

    def extract(self, pdf_path: str) -> RawExtraction:
        try:
            from pypdf import PdfReader
        except Exception as e:
            return RawExtraction(self.name, error=f"import failed: {e}")

        try:
            reader = PdfReader(pdf_path)
        except Exception as e:
            return RawExtraction(self.name, error=f"open failed: {e}")

        text_parts: list[str] = []
        links: list[LinkAnnotation] = []

        for page_num, page in enumerate(reader.pages):
            try:
                text_parts.append(page.extract_text() or "")
            except Exception:
                text_parts.append("")

            annots = page.get("/Annots")
            if not annots:
                continue
            try:
                annots = annots.get_object()
            except Exception:
                continue
            for a in annots:
                try:
                    obj = a.get_object()
                except Exception:
                    continue
                if obj.get("/Subtype") != "/Link":
                    continue
                action = obj.get("/A")
                if not action:
                    continue
                try:
                    action = action.get_object()
                except Exception:
                    pass
                uri = action.get("/URI") if hasattr(action, "get") else None
                if uri:
                    links.append(LinkAnnotation(url=str(uri), page=page_num))

        text = "\n".join(text_parts)
        return RawExtraction(
            backend_name=self.name,
            text=text,
            layout_lines=text.splitlines(),
            links=links,
        )
