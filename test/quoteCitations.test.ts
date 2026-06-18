import { assert } from "chai";
import {
  buildQuoteAnchorPromptBlock,
  buildQuoteCitation,
  buildSelectedTextQuoteCitations,
  extractQuoteCitationsFromToolContent,
  findUnresolvedQuoteCitationPlaceholderIds,
  replaceQuoteCitationPlaceholdersForMarkdown,
  sanitizeInvalidStructuredSourceMarkers,
} from "../src/modules/contextPanel/quoteCitations";
import { renderMarkdown } from "../src/utils/markdown";

describe("quoteCitations", function () {
  it("generates stable ids from quote text, citation label, and context item", function () {
    const first = buildQuoteCitation({
      quoteText: "The models will offer a set of categories.",
      citationLabel: "(Montague et al., 2012)",
      contextItemId: 123,
    });
    const second = buildQuoteCitation({
      quoteText: "The models will offer a set of categories.",
      citationLabel: "(Montague et al., 2012)",
      contextItemId: 123,
    });

    assert.isDefined(first);
    assert.equal(first?.id, second?.id);
    assert.match(first?.id || "", /^Q_[a-z0-9]+$/);
  });

  it("builds selected PDF text anchors and prompt tokens", function () {
    const anchors = buildSelectedTextQuoteCitations(
      ["quoted PDF passage", "note text"],
      ["pdf", "note"],
      [
        {
          itemId: 10,
          contextItemId: 11,
          title: "Paper",
          firstCreator: "Smith",
          year: "2024",
        },
        undefined,
      ],
    );

    assert.lengthOf(anchors, 1);
    assert.equal(anchors[0].citationLabel, "(Smith, 2024)");
    const prompt = buildQuoteAnchorPromptBlock(anchors).join("\n");
    assert.include(prompt, `[[quote:${anchors[0].id}]]`);
    assert.include(prompt, "quoteText");
  });

  it("replaces known markdown placeholders with canonical blockquote citations", function () {
    const citation = buildQuoteCitation({
      quoteText: "A stable quote.",
      citationLabel: "(Lee, 2025)",
      contextItemId: 22,
    });
    assert.isDefined(citation);

    const rendered = replaceQuoteCitationPlaceholdersForMarkdown(
      `Evidence:\n\n[[quote:${citation!.id}]]`,
      [citation!],
    );

    assert.include(rendered, "> A stable quote.");
    assert.include(rendered, "(Lee, 2025)");
    assert.notInclude(rendered, "[[quote:");
  });

  it("renders anchored quotes in the original source language inside Chinese answers", function () {
    const citation = buildQuoteCitation({
      quoteText: "Memory engrams are highly dynamic during consolidation.",
      citationLabel: "(Tomé, 2024)",
      contextItemId: 22,
    });
    assert.isDefined(citation);

    const rendered = replaceQuoteCitationPlaceholdersForMarkdown(
      `中文解释：\n\n[[quote:${citation!.id}]]\n\n这说明记忆痕迹会变化。`,
      [citation!],
    );

    assert.include(
      rendered,
      "> Memory engrams are highly dynamic during consolidation.",
    );
    assert.include(rendered, "中文解释");
    assert.notInclude(rendered, "> 记忆痕迹");
  });

  it("preserves Chinese quotes when Chinese is the original source text", function () {
    const citation = buildQuoteCitation({
      quoteText: "记忆痕迹在巩固过程中具有高度动态性。",
      citationLabel: "(王, 2024)",
      contextItemId: 22,
    });
    assert.isDefined(citation);

    const rendered = replaceQuoteCitationPlaceholdersForMarkdown(
      `证据：\n\n[[quote:${citation!.id}]]`,
      [citation!],
    );

    assert.include(rendered, "> 记忆痕迹在巩固过程中具有高度动态性。");
    assert.include(rendered, "(王, 2024)");
  });

  it("preserves unmatched source-backed blockquotes as plain quoted text", function () {
    const citation = buildQuoteCitation({
      quoteText: "Memory engrams are highly dynamic during consolidation.",
      citationLabel: "(Tomé, 2024)",
      contextItemId: 22,
    });
    assert.isDefined(citation);

    const rendered = replaceQuoteCitationPlaceholdersForMarkdown(
      "解释：\n\n> 记忆痕迹在巩固过程中具有高度动态性。\n\n(Tomé, 2024)\n\n继续。",
      [citation!],
    );

    assert.include(rendered, "解释");
    assert.include(rendered, "继续");
    assert.include(rendered, "> 记忆痕迹在巩固过程中具有高度动态性。");
    assert.include(rendered, "(Tomé, 2024)");
    assert.notInclude(rendered, "[[quote:");
  });

  it("keeps quote lead-ins from becoming blank when a manual quote is unmatched", function () {
    const rendered = replaceQuoteCitationPlaceholdersForMarkdown(
      "CNNs apply the same computation across every pixel in an image — as the authors put it:\n\n> This is prohibitively expensive for large images or video.\n\n(Mnih et al., 2014)\n\nThis motivates recurrent attention.",
      [],
      { resolved: "preserve", unresolved: "omit" },
    );

    assert.include(rendered, "as the authors put it:");
    assert.include(
      rendered,
      "> This is prohibitively expensive for large images or video.",
    );
    assert.include(rendered, "(Mnih et al., 2014)");
    assert.include(rendered, "This motivates recurrent attention.");
  });

  it("canonicalizes exact manual source-backed blockquotes through trusted anchors", function () {
    const citation = buildQuoteCitation({
      quoteText: "Memory engrams are highly dynamic during consolidation.",
      citationLabel: "(Tomé, 2024)",
      contextItemId: 22,
    });
    assert.isDefined(citation);

    const display = replaceQuoteCitationPlaceholdersForMarkdown(
      "Evidence:\n\n> Memory engrams are highly dynamic during consolidation.\n\n(Tomé, 2024)",
      [citation!],
      { resolved: "preserve" },
    );
    const exported = replaceQuoteCitationPlaceholdersForMarkdown(
      "Evidence:\n\n> Memory engrams are highly dynamic during consolidation.\n\n(Tomé, 2024)",
      [citation!],
    );

    assert.include(display, `[[quote:${citation!.id}]]`);
    assert.notInclude(display, "> Memory engrams");
    assert.include(exported, "> Memory engrams are highly dynamic");
    assert.include(exported, "(Tomé, 2024)");
  });

  it("does not double-blockquote anchored quotes already wrapped in quote syntax", function () {
    const citation = buildQuoteCitation({
      quoteText: "First source paragraph.\n\nSecond source paragraph.",
      citationLabel: "(Lee, 2025)",
      contextItemId: 22,
    });
    assert.isDefined(citation);

    const rendered = replaceQuoteCitationPlaceholdersForMarkdown(
      `Evidence:\n\n> [[quote:${citation!.id}]]`,
      [citation!],
    );
    const html = renderMarkdown(rendered);

    assert.notInclude(rendered, "> >");
    assert.notInclude(html, "<blockquote><blockquote>");
    assert.include(html, "<p>First source paragraph.</p>");
    assert.include(html, "<p>Second source paragraph.</p>");
  });

  it("omits unresolved placeholders on external text surfaces", function () {
    const preserved = replaceQuoteCitationPlaceholdersForMarkdown(
      "Evidence: [[quote:Q_missing]]",
      [],
    );
    const omitted = replaceQuoteCitationPlaceholdersForMarkdown(
      "Evidence: [[quote:Q_missing]]",
      [],
      { unresolved: "omit" },
    );
    const legacyOmitted = replaceQuoteCitationPlaceholdersForMarkdown(
      "Evidence: [[quote:Q_missing]]",
      [],
      { unresolved: "unavailable" },
    );

    assert.include(preserved, "[[quote:Q_missing]]");
    assert.equal(omitted, "Evidence: ");
    assert.equal(legacyOmitted, "Evidence: ");
    assert.notInclude(omitted, "[[quote:");
    assert.notInclude(omitted, "[quote unavailable]");
  });

  it("detects unresolved quote placeholders before omission", function () {
    const citation = buildQuoteCitation({
      quoteText: "Resolved quote.",
      citationLabel: "(Lee, 2025)",
      contextItemId: 22,
    });
    assert.isDefined(citation);

    const unresolved = findUnresolvedQuoteCitationPlaceholderIds(
      `[[quote:${citation!.id}]] [[quote:Q_missing]] [[quote:Q_missing]]`,
      [citation!],
    );

    assert.deepEqual(unresolved, ["Q_missing"]);
  });

  it("repairs leaked source metadata markers into plain quote citations", function () {
    const leaked =
      '    "our model predicted that memory engrams are highly dynamic, with neurons being removed from and added to the engram over the course of memory consolidation" [[source=(Tomé, 2024), section=Dynamic and selective engrams emerge with memory consolidation, chunk=8]]\n\n' +
      "Critically, they show that dynamic engrams explain behavior.";

    const sanitized = sanitizeInvalidStructuredSourceMarkers(leaked);

    assert.include(sanitized, "> our model predicted");
    assert.include(sanitized, "(Tomé, 2024)");
    assert.notInclude(sanitized, "[[source=");
    assert.notInclude(sanitized, "section=");
    assert.notInclude(sanitized, "chunk=");
  });

  it("preserves leaked source metadata quotes after full quote sanitization", function () {
    const rendered = replaceQuoteCitationPlaceholdersForMarkdown(
      '"our results provide evidence that the activity of dynamic engrams..." [[source=(Tomé, 2024), section=Dynamic and selective engrams emerge with memory consolidation, chunk=28]]',
      [],
      { resolved: "preserve", unresolved: "omit" },
    );

    assert.include(
      rendered,
      "> our results provide evidence that the activity of dynamic engrams...",
    );
    assert.include(rendered, "(Tomé, 2024)");
    assert.notInclude(rendered, "[[source=");
    assert.notInclude(rendered, "section=");
    assert.notInclude(rendered, "chunk=");
  });

  it("extracts quote citations from nested tool content and JSON text payloads", function () {
    const citation = buildQuoteCitation({
      quoteText: "Tool quote.",
      citationLabel: "(Patel, 2026)",
      contextItemId: 33,
      itemId: 3,
    });
    assert.isDefined(citation);
    const content = [
      {
        type: "text",
        text: JSON.stringify({
          result: {
            quoteCitations: [citation],
          },
        }),
      },
    ];

    const extracted = extractQuoteCitationsFromToolContent(content);

    assert.lengthOf(extracted, 1);
    assert.equal(extracted[0].id, citation!.id);
    assert.equal(extracted[0].citationLabel, "(Patel, 2026)");
  });
});
