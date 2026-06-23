---
id: analyze-figures
description: Analyze figures, tables, and diagrams from papers
version: 4
contexts: single-paper
activation: auto
match: /\b(figure|fig\.?|table|diagram|chart|graph|plot|schematic|illustration)\s*\d/i
match: /\banalyze?\b.*\b(figure|fig\.?|table|diagram|image|chart)\b/i
match: /\b(figure|fig\.?|table|diagram)\b.*\b(about|explain|describe|show|mean|depict)\b/i
match: /\b(what|how|why|can you)\b.*\b(figure|fig\.?|table|diagram|chart)\b/i
---

<!--
  SKILL: Analyze Figures

  This skill activates when you ask about a specific figure, table, or
  diagram in a paper (e.g., "explain Figure 2", "what does Table 1 show?").

  You can customize:
  - Analysis depth: change how the agent interprets visual content
  - MinerU vs PDF fallback: adjust which path is preferred
  - Note saving: modify how figure analyses are saved to notes

  Your changes are preserved across plugin updates.
  To reset to default, delete this file — it will be recreated on next restart.
-->

## Analyzing Figures and Tables — use MinerU cache, not raw PDF

When the user asks about a figure, table, or diagram in a paper, use the most efficient path to access it.

### When MinerU cache is available (mineruCacheDir shown in paper context)

This is the fast path — MinerU has already extracted figures as image files.

**Step 1 — Read the manifest:**
Use `file_io({ action:'read', filePath:'{mineruCacheDir}/manifest.json' })` to see all sections with their figure lists, page numbers, and charStart/charEnd ranges.

**Step 2 — Find the figure in the manifest:**
The manifest lists figures per section with labels (e.g. "Fig. 1"), image paths, captions, and page numbers. Locate the target figure and note which section it belongs to.
For MinerU figures/tables, adjacent image runs in `full.md` are the primary block boundary.
For Figure 1, Fig. 1b, or any panel request, read the whole adjacent image block plus the full caption/figure text before answering.
Panel suffixes and captions are hints only; do not assume image order proves panel identity.
If the user asks only for Figure 1b, you may focus the explanation on the requested panel evidence, but still inspect the full adjacent block and do not imply one image represents the whole Figure 1.

**Step 3 — Read the section text:**
Use `file_io({ action:'read', filePath:'{mineruCacheDir}/full.md', offset:<charStart>, length:<charEnd - charStart> })` to read just the section containing the figure. This gives you the caption and surrounding discussion.

**Step 4 — Read the image directly:**
Use `file_io({ action:'read', filePath:'{mineruCacheDir}/<figure_path>' })` to load the image.
The path comes from the manifest's figure entry.
If the path belongs to a MinerU adjacent image block, `file_io` returns ordered metadata/artifacts for the whole block.
Image-capable models can inspect the artifacts directly — use the images together with the caption and surrounding text.

**Step 5 — Combine image + text:**
Use both the image and the section text (caption + discussion) to give a complete answer.

### When MinerU cache is NOT available

Fall back to PDF tools:

1. `paper_read({ mode:'visual', query:'<figure/table label>' })` to find which page(s) contain it and get the page image for visual analysis
2. `paper_read({ mode:'targeted', query:'<figure/table label and surrounding discussion>' })` for surrounding discussion text

### Key rules

- **NEVER** use OCR tools, Python scripts, Swift, Tesseract, or shell commands to analyze images. Visual models see images directly.
- **NEVER** attempt to install packages (PIL, cv2, etc.) to process images.
- Prefer MinerU cache over raw PDF — it's faster and gives better quality.
- Always include the figure caption and surrounding context in your analysis, not just the image.
- For MinerU compound figures, read the whole adjacent image block and the complete figure text before drawing conclusions.
- Text-only models can use ordered paths, captions, section text, and page hints, but must not make unsupported visual claims.
- For tables: the MinerU markdown usually contains the table as structured text — read that directly instead of rendering images.

### Saving figure analysis to notes

When the user asks to save your figure analysis to a note (e.g., "save it", "put that in a note", "create a note", "write to obsidian"), the Write Note skill handles the full workflow. Key rules:

- **Always embed the analyzed figure image** in the note — mandatory, not optional. A note explaining Figure 2 must show Figure 2.
- For any multi-image MinerU block, embed every available adjacent image path that you analyzed, in source order. If any image path is missing/unreadable, say that explicitly in the note.
- Place the image at the start of the relevant section, before the explanation text.
- If you analyzed multiple figures, embed all of them.
- If MinerU cache was not available (you used `paper_read({ mode:'visual' })` instead), the figure image cannot be embedded — mention this.
