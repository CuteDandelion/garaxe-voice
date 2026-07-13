#!/usr/bin/env python3
"""Render an immutable Garaxe evidence-first report snapshot to PDF."""

import json
import sys
from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import BaseDocTemplate, Frame, KeepTogether, PageBreak, PageTemplate, Paragraph, Spacer, Table, TableStyle

PAPER = HexColor("#F7F3EA")
INK = HexColor("#171714")
MUTED = HexColor("#6E6A61")
RULE = HexColor("#D8D1C5")
ACCENT = HexColor("#C65E42")
GREEN = HexColor("#6E8B72")


def text(value, fallback="Not available"):
    if value is None or value == "":
        return fallback
    return str(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br/>")


def first(snapshot, *keys, fallback=None):
    current = snapshot
    for key in keys:
        if not isinstance(current, dict):
            return fallback
        current = current.get(key)
    return current if current is not None else fallback


class ReportDoc(BaseDocTemplate):
    def __init__(self, filename, metadata):
        super().__init__(filename, pagesize=A4, leftMargin=19 * mm, rightMargin=19 * mm, topMargin=22 * mm, bottomMargin=19 * mm,
                         title=metadata.get("title", "Garaxe Voice Intelligence"), author="Garaxe Voice Intelligence")
        self.metadata = metadata
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="body")
        self.addPageTemplates(PageTemplate(id="garaxe", frames=[frame], onPage=self.decorate))

    def decorate(self, canvas, doc):
        # Make the paper wash the first page operation so it cannot inherit a
        # clipping path from a previous flowable.
        red, green, blue = PAPER.red, PAPER.green, PAPER.blue
        canvas._code.insert(0, f"q {red:.5f} {green:.5f} {blue:.5f} rg 0 0 {A4[0]:.3f} {A4[1]:.3f} re f Q")
        canvas.saveState()
        canvas.setFillColor(PAPER)
        canvas.rect(0, 0, A4[0], A4[1], fill=1, stroke=0)
        canvas.setStrokeColor(RULE)
        canvas.line(19 * mm, A4[1] - 15 * mm, A4[0] - 19 * mm, A4[1] - 15 * mm)
        canvas.setFont("Helvetica-Bold", 8)
        canvas.setFillColor(INK)
        canvas.drawString(19 * mm, A4[1] - 11 * mm, "garaxe.voice")
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(MUTED)
        canvas.drawRightString(A4[0] - 19 * mm, A4[1] - 11 * mm, f"VOICE INTELLIGENCE  /  {self.metadata.get('version', 'V2')}")
        canvas.line(19 * mm, 13 * mm, A4[0] - 19 * mm, 13 * mm)
        canvas.drawString(19 * mm, 8.5 * mm, str(self.metadata.get("generatedAt", "Generated report"))[:32])
        canvas.drawRightString(A4[0] - 19 * mm, 8.5 * mm, str(doc.page))
        canvas.restoreState()


def styles():
    base = getSampleStyleSheet()
    return {
        "eyebrow": ParagraphStyle("eyebrow", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=7.5, leading=10, textColor=MUTED, spaceAfter=7, letterSpacing=1.1),
        "title": ParagraphStyle("title", parent=base["Title"], fontName="Times-Roman", fontSize=31, leading=34, textColor=INK, alignment=TA_LEFT, spaceAfter=12),
        "lead": ParagraphStyle("lead", parent=base["BodyText"], fontName="Helvetica", fontSize=10.5, leading=16, textColor=INK, spaceAfter=13),
        "h2": ParagraphStyle("h2", parent=base["Heading2"], fontName="Times-Roman", fontSize=20, leading=23, textColor=INK, spaceBefore=10, spaceAfter=7),
        "h3": ParagraphStyle("h3", parent=base["Heading3"], fontName="Helvetica-Bold", fontSize=10, leading=14, textColor=INK, spaceAfter=5),
        "body": ParagraphStyle("body", parent=base["BodyText"], fontName="Helvetica", fontSize=8.8, leading=13.5, textColor=INK, spaceAfter=6),
        "small": ParagraphStyle("small", parent=base["BodyText"], fontName="Helvetica", fontSize=7.8, leading=11.5, textColor=INK, spaceAfter=4),
        "quote": ParagraphStyle("quote", parent=base["BodyText"], fontName="Times-Italic", fontSize=12.5, leading=17, textColor=INK, leftIndent=5 * mm, borderColor=ACCENT, borderWidth=2, borderPadding=(0, 0, 0, 7 * mm), spaceAfter=6),
        "meta": ParagraphStyle("meta", parent=base["BodyText"], fontName="Helvetica", fontSize=7, leading=10, textColor=MUTED),
    }


def metric_table(snapshot, themes):
    quality = first(snapshot, "dataset", "qualityReport", fallback={}) or {}
    counts = first(snapshot, "dataset", "counts", fallback={}) or {}
    data = [["REVIEWS INCLUDED", "THEMES PUBLISHED", "SOURCES", "CURATION REVISION"], [
        text(quality.get("included", counts.get("included", 0)), "0"), text(len(themes), "0"),
        text(first(snapshot, "dataset", "sourceCount", fallback=0), "0"), text(first(snapshot, "curation", "revision", fallback=0), "0")]]
    table = Table(data, colWidths=[43 * mm] * 4, rowHeights=[8 * mm, 10 * mm])
    table.setStyle(TableStyle([
        ("TEXTCOLOR", (0, 0), (-1, 0), MUTED), ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("FONTSIZE", (0, 0), (-1, 0), 6.2),
        ("TEXTCOLOR", (0, 1), (-1, 1), INK), ("FONTNAME", (0, 1), (-1, 1), "Times-Roman"), ("FONTSIZE", (0, 1), (-1, 1), 14),
        ("LINEABOVE", (0, 0), (-1, 0), 0.6, RULE), ("LINEBELOW", (0, 1), (-1, 1), 0.6, RULE), ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    return table


def bar_chart(items, label_key, value_key, width=172 * mm, height=50 * mm, maximum_items=8):
    rows = sorted(items, key=lambda item: item.get(value_key, 0), reverse=True)[:maximum_items]
    if not rows:
        return Paragraph("Not enough data for this chart.", styles()["meta"])
    maximum = max(max(float(item.get(value_key, 0)) for item in rows), 1)
    label_width = 49 * mm
    chart_width = width - label_width - 12 * mm
    table_rows = []
    for item in rows:
        label = str(item.get(label_key, "Unknown"))[:30]
        value = float(item.get(value_key, 0))
        filled = max(0.1 * mm, chart_width * value / maximum)
        empty = max(0.1 * mm, chart_width - filled)
        bar = Table([["", ""]], colWidths=[filled, empty], rowHeights=[2.2 * mm])
        bar.setStyle(TableStyle([("BACKGROUND", (0, 0), (0, 0), ACCENT), ("BACKGROUND", (1, 0), (1, 0), RULE),
                                  ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                                  ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
        table_rows.append([label, bar, str(int(value))])
    row_height = max(5 * mm, height / len(rows))
    table = Table(table_rows, colWidths=[label_width, chart_width, 12 * mm], rowHeights=[row_height] * len(rows))
    table.setStyle(TableStyle([("FONTNAME", (0, 0), (-1, -1), "Helvetica"), ("FONTSIZE", (0, 0), (-1, -1), 7),
                               ("TEXTCOLOR", (0, 0), (-1, -1), INK), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                               ("ALIGN", (2, 0), (2, -1), "RIGHT"), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                               ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0),
                               ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    return table


def action_table(actions, themes, s):
    names = {theme.get("id"): theme.get("name") for theme in themes}
    rows = [[Paragraph("PRIORITY", s["meta"]), Paragraph("ACTION", s["meta"]), Paragraph("HOW TO MEASURE", s["meta"])]]
    for action in actions:
        cited = ", ".join(names.get(identifier, identifier) for identifier in action.get("themeIds", []))
        rows.append([
            Paragraph(text(action.get("priority"), "next").upper(), s["small"]),
            Paragraph(f"<b>{text(action.get('title'))}</b><br/>{text(action.get('rationale'))}<br/><font color='#6E6A61'>Evidence: {text(cited)}</font>", s["small"]),
            Paragraph(text(action.get("successMeasure")), s["small"]),
        ])
    table = Table(rows, colWidths=[20 * mm, 92 * mm, 60 * mm], repeatRows=1)
    table.setStyle(TableStyle([
        ("LINEABOVE", (0, 0), (-1, 0), 0.6, INK), ("LINEBELOW", (0, 0), (-1, 0), 0.6, INK),
        ("LINEBELOW", (0, 1), (-1, -1), 0.35, RULE), ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 4 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 3 * mm), ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm)]))
    return table


def evidence_meta(item):
    parts = [item.get("entity"), item.get("provider"), f"{item.get('rating')} stars" if item.get("rating") is not None else None,
             str(item.get("sourceCreatedAt"))[:10] if item.get("sourceCreatedAt") else None, f"review {item.get('reviewId')}" if item.get("reviewId") else None]
    return " / ".join(str(part) for part in parts if part)


def build_story(snapshot):
    s = styles()
    narrative = snapshot.get("narrative") or {}
    themes = snapshot.get("themes") or []
    charts = snapshot.get("charts") or {}
    story = [Spacer(1, 8 * mm), Paragraph("EXECUTIVE VOICE BRIEF / IMMUTABLE SNAPSHOT", s["eyebrow"]),
             Paragraph(text(narrative.get("headline"), "What customers are telling you."), s["title"]),
             Paragraph(text(narrative.get("executiveSummary"), "No executive interpretation was available."), s["lead"]), metric_table(snapshot, themes)]
    provenance = narrative.get("provenance") or {}
    story.extend([Spacer(1, 4 * mm), Paragraph(f"SUMMARY PROVENANCE / {text(provenance.get('generator'), 'unknown').upper()} / {text(provenance.get('model'), 'curated interpretations')}", s["meta"])])

    opportunities = narrative.get("opportunities") or []
    risks = narrative.get("risks") or []
    if opportunities or risks:
        columns = []
        for title, items in (("OPPORTUNITIES", opportunities), ("RISKS TO ADDRESS", risks)):
            content = [Paragraph(title, s["eyebrow"])] + [Paragraph(f"• {text(item)}", s["small"]) for item in items]
            columns.append(content)
        story.extend([Spacer(1, 7 * mm), Table([columns], colWidths=[86 * mm, 86 * mm], style=TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 8 * mm)]))])

    actions = narrative.get("actions") or []
    if actions:
        story.extend([Spacer(1, 7 * mm), Paragraph("RECOMMENDED ACTIONS", s["eyebrow"]), action_table(actions, themes, s)])

    story.extend([PageBreak(), Spacer(1, 6 * mm), Paragraph("SIGNAL LANDSCAPE", s["eyebrow"]),
                  Paragraph("Which issues recur—and how the reviewed dataset is distributed.", s["h2"]),
                  Paragraph("THEME PREVALENCE / UNIQUE SUPPORTING REVIEWS", s["eyebrow"]),
                  bar_chart(charts.get("themePrevalence", []), "name", "reviewCount"), Spacer(1, 6 * mm),
                  Paragraph("RATING DISTRIBUTION", s["eyebrow"]),
                  bar_chart([{**item, "label": f"{item.get('rating')} stars"} for item in charts.get("ratingDistribution", [])], "label", "count", height=38 * mm),
                  Spacer(1, 5 * mm), Paragraph("REVIEW TIMELINE", s["eyebrow"]),
                  bar_chart(charts.get("reviewTimeline", []), "period", "count", height=38 * mm)])

    story.extend([PageBreak(), Spacer(1, 6 * mm), Paragraph("APPROVED THEMES", s["eyebrow"]),
                  Paragraph("Human-reviewed conclusions with the complete source feedback kept one interaction away.", s["body"])])
    for index, theme in enumerate(themes, 1):
        evidence = theme.get("evidence") or []
        header = [Paragraph(f"{index:02d} / {text(theme.get('type'), 'theme').upper()} / {text(theme.get('confidence'), 'confidence')}", s["eyebrow"]),
                  Paragraph(text(theme.get("name"), "Unnamed theme"), s["h2"]), Paragraph(text(theme.get("summary"), "No interpretation supplied."), s["body"])]
        if evidence:
            representative = next((item for item in evidence if item.get("pinned")), evidence[0])
            header.extend([Paragraph(f'“{text(representative.get("quote"), "Evidence unavailable")}”', s["quote"]),
                           Paragraph(f"{len(set(item.get('reviewId') for item in evidence))} supporting reviews / {len(evidence)} exact excerpts", s["meta"])])
        story.extend([KeepTogether(header), Spacer(1, 5 * mm)])

    story.extend([PageBreak(), Spacer(1, 6 * mm), Paragraph("CUSTOMER FEEDBACK", s["eyebrow"]),
                  Paragraph("Full source comments behind every published theme", s["h2"]),
                  Paragraph("The highlighted excerpt is the exact span used as evidence. The full comment is preserved below it so the customer’s context is not reduced to a pattern label.", s["body"])])
    seen = set()
    for theme in themes:
        visible = theme.get("evidence") or []
        if not visible:
            continue
        story.append(Paragraph(text(theme.get("name"), "Theme"), s["h3"]))
        for item in visible:
            key = (theme.get("id"), item.get("signalId"))
            if key in seen:
                continue
            seen.add(key)
            full_comment = item.get("originalText") or item.get("quote")
            marker = "PINNED / " if item.get("pinned") else ""
            story.extend([KeepTogether([
                Paragraph(f'“{text(item.get("quote"))}”', s["quote"]),
                Paragraph(text(full_comment), s["body"]),
                Paragraph(f"{marker}{text(evidence_meta(item))} / signal {text(item.get('signalId'))}", s["meta"]),
            ]), Spacer(1, 4 * mm)])

    quality = first(snapshot, "dataset", "qualityReport", fallback={}) or {}
    story.extend([PageBreak(), Spacer(1, 6 * mm), Paragraph("METHODOLOGY & PROVENANCE", s["eyebrow"]),
                  Paragraph("How to read this report", s["h2"]),
                  Paragraph("This is an immutable snapshot of one completed analysis run and one ready curation revision. Charts are deterministic aggregations of frozen evidence. The executive brief is generated from approved themes and may not cite evidence outside the theme IDs recorded with each action.", s["body"]),
                  Paragraph(f"Pipeline: {text(first(snapshot, 'versions', 'pipeline'))}<br/>Synthesis: {text(first(snapshot, 'versions', 'synthesis'))}<br/>Report contract: {text(snapshot.get('schemaVersion'))}<br/>Included reviews: {text(quality.get('included'), '0')}<br/>Excluded reviews: {text(quality.get('excluded'), '0')}", s["small"])])
    return story


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: render-report.py OUTPUT.pdf")
    snapshot = json.load(sys.stdin)
    output = Path(sys.argv[1]).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    metadata = {"generatedAt": snapshot.get("generatedAt"), "version": snapshot.get("schemaVersion"), "title": first(snapshot, "narrative", "headline", fallback="Garaxe Voice Intelligence")}
    ReportDoc(str(output), metadata).build(build_story(snapshot))
    print(str(output))


if __name__ == "__main__":
    main()
