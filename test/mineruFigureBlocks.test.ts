import { assert } from "chai";
import {
  buildMineruFigureBlocks,
  findMineruFigureBlockByImagePath,
  getManifestFigureBaseLabel,
  resolveMineruFigureBlocksForQuery,
  validateFigureBlockEmbeds,
  type MineruContentListEntry,
} from "../src/modules/contextPanel/mineruFigureBlocks";

describe("mineruFigureBlocks", function () {
  function build(
    fullMd: string,
    contentList: MineruContentListEntry[] = [],
  ) {
    return buildMineruFigureBlocks({ fullMd, contentList });
  }

  it("normalizes figure and table panel labels to base labels", function () {
    assert.equal(getManifestFigureBaseLabel("Fig. 1a"), "Figure 1");
    assert.equal(getManifestFigureBaseLabel("Figure 1B"), "Figure 1");
    assert.equal(getManifestFigureBaseLabel("Table 2c"), "Table 2");
    assert.equal(
      getManifestFigureBaseLabel("Supplementary Fig. S7b"),
      "Supplementary Figure S7",
    );
  });

  it("groups adjacent captionless images into one high-confidence block", function () {
    const blocks = build(
      [
        "# Results",
        "The model has three panels.",
        "",
        "![](images/a.jpg)",
        "",
        "![](images/b.jpg)",
        "",
        "![](images/c.jpg)",
        "",
        "The text resumes here.",
      ].join("\n"),
      [
        { type: "text", text_level: 1, text: "Results", page_idx: 0 },
        { type: "image", img_path: "images/a.jpg", page_idx: 1 },
        { type: "image", img_path: "images/b.jpg", page_idx: 1 },
        { type: "image", img_path: "images/c.jpg", page_idx: 1 },
      ],
    );

    assert.lengthOf(blocks, 1);
    assert.deepEqual(blocks[0].imagePaths, [
      "images/a.jpg",
      "images/b.jpg",
      "images/c.jpg",
    ]);
    assert.equal(blocks[0].confidence, "high");
    assert.isFalse(blocks[0].ambiguous);
  });

  it("does not split a block on caption-like text between images", function () {
    const blocks = build(
      [
        "# Results",
        "![](images/a.jpg)",
        "",
        "Figure 2. Three-panel decision-network schematic.",
        "",
        "![](images/b.jpg)",
        "",
        "![](images/c.jpg)",
      ].join("\n"),
      [
        { type: "text", text_level: 1, text: "Results", page_idx: 0 },
        {
          type: "image",
          img_path: "images/a.jpg",
          image_caption: ["Figure 2. Three-panel decision-network schematic."],
          page_idx: 1,
        },
        { type: "image", img_path: "images/b.jpg", page_idx: 1 },
        { type: "image", img_path: "images/c.jpg", page_idx: 1 },
      ],
    );

    assert.lengthOf(blocks, 1);
    assert.deepEqual(blocks[0].imagePaths, [
      "images/a.jpg",
      "images/b.jpg",
      "images/c.jpg",
    ]);
    assert.include(blocks[0].labelHints, "Figure 2");
    assert.include(blocks[0].captionHints[0], "Three-panel");
  });

  it("splits adjacent images when captions identify different figures", function () {
    const blocks = build(
      [
        "# Results",
        "![Fig 1](images/fig1.jpg)",
        "",
        "![Fig 2](images/fig2.jpg)",
      ].join("\n"),
      [
        { type: "text", text_level: 1, text: "Results", page_idx: 0 },
        {
          type: "image",
          img_path: "images/fig1.jpg",
          image_caption: ["Figure 1. First result."],
          page_idx: 1,
        },
        {
          type: "image",
          img_path: "images/fig2.jpg",
          image_caption: ["Figure 2. Second result."],
          page_idx: 1,
        },
      ],
    );

    assert.lengthOf(blocks, 2);
    assert.deepEqual(blocks.map((block) => block.imagePaths), [
      ["images/fig1.jpg"],
      ["images/fig2.jpg"],
    ]);
  });

  it("marks captionless page-spanning blocks as low confidence", function () {
    const blocks = build(
      ["# Results", "![](images/a.jpg)", "", "![](images/b.jpg)"].join("\n"),
      [
        { type: "text", text_level: 1, text: "Results", page_idx: 0 },
        { type: "image", img_path: "images/a.jpg", page_idx: 1 },
        { type: "image", img_path: "images/b.jpg", page_idx: 2 },
      ],
    );

    assert.lengthOf(blocks, 1);
    assert.equal(blocks[0].confidence, "low");
    assert.isTrue(blocks[0].ambiguous);
  });

  it("resolves panel requests to the full figure block with a panel hint", function () {
    const blocks = build(
      ["# Results", "![](images/a.jpg)", "", "![](images/b.jpg)"].join("\n"),
      [
        { type: "text", text_level: 1, text: "Results", page_idx: 0 },
        {
          type: "image",
          img_path: "images/a.jpg",
          image_caption: ["Figure 2. Choice attractor."],
          page_idx: 1,
        },
        { type: "image", img_path: "images/b.jpg", page_idx: 1 },
      ],
    );

    const result = resolveMineruFigureBlocksForQuery(
      "Explain Figure 2c",
      blocks,
    );

    assert.equal(result.panelHint, "c");
    assert.lengthOf(result.blocks, 1);
    assert.deepEqual(result.blocks[0].imagePaths, [
      "images/a.jpg",
      "images/b.jpg",
    ]);
  });

  it("looks up a full block from any member image path", function () {
    const blocks = build(
      ["# Results", "![](images/a.jpg)", "", "![](images/b.jpg)"].join("\n"),
    );

    const block = findMineruFigureBlockByImagePath("images/b.jpg", blocks);

    assert.isNotNull(block);
    assert.deepEqual(block?.imagePaths, ["images/a.jpg", "images/b.jpg"]);
  });

  it("blocks incomplete high-confidence embeds and accepts complete embeds", function () {
    const blocks = build(
      [
        "# Results",
        "![](images/a.jpg)",
        "",
        "![](images/b.jpg)",
        "",
        "![](images/c.jpg)",
      ].join("\n"),
      [
        { type: "text", text_level: 1, text: "Results", page_idx: 0 },
        {
          type: "image",
          img_path: "images/a.jpg",
          image_caption: ["Figure 2. Full compound figure."],
          page_idx: 1,
        },
        { type: "image", img_path: "images/b.jpg", page_idx: 1 },
        { type: "image", img_path: "images/c.jpg", page_idx: 1 },
      ],
    );

    const incomplete = validateFigureBlockEmbeds({
      content: "![Figure 2](images/a.jpg)\n\n## Figure 2",
      requestText: "write a note about Figure 2",
      blocks,
    });
    assert.equal(incomplete?.severity, "block");
    assert.include(incomplete?.message || "", "Figure 2");
    assert.equal(incomplete?.embeddedCount, 1);
    assert.equal(incomplete?.availableCount, 3);

    const complete = validateFigureBlockEmbeds({
      content: [
        "![Figure 2a](images/a.jpg)",
        "![Figure 2b](images/b.jpg)",
        "![Figure 2c](images/c.jpg)",
        "## Figure 2",
      ].join("\n"),
      requestText: "write a note about Figure 2",
      blocks,
    });
    assert.isNull(complete);
  });

  it("allows low-confidence incomplete embeds only when the note states ambiguity", function () {
    const blocks = build(
      ["# Results", "![](images/a.jpg)", "", "![](images/b.jpg)"].join("\n"),
      [
        { type: "text", text_level: 1, text: "Results", page_idx: 0 },
        {
          type: "image",
          img_path: "images/a.jpg",
          image_caption: ["Figure 2. Ambiguous page-spanning figure."],
          page_idx: 1,
        },
        { type: "image", img_path: "images/b.jpg", page_idx: 2 },
      ],
    );

    const missingAmbiguity = validateFigureBlockEmbeds({
      content: "![Figure 2](images/a.jpg)\n\n## Figure 2",
      requestText: "write a note about Figure 2",
      blocks,
    });
    assert.equal(missingAmbiguity?.severity, "advisory");

    const statedAmbiguity = validateFigureBlockEmbeds({
      content:
        "![Figure 2](images/a.jpg)\n\n## Figure 2\n\nPanel mapping is uncertain because the MinerU block boundary is ambiguous.",
      requestText: "write a note about Figure 2",
      blocks,
    });
    assert.isNull(statedAmbiguity);
  });
});
