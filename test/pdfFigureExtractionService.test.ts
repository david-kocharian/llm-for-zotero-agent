import { assert } from "chai";
import { PdfFigureExtractionService } from "../src/agent/services/pdfFigureExtractionService";
import {
  PDF_FIGURE_CROP_ALGORITHM_VERSION,
  PDF_FIGURE_CROP_CACHE_VERSION,
  buildPdfFigureCropManifestHash,
  buildPdfFigureCropPdfFingerprint,
} from "../src/modules/contextPanel/pdfFigureCropCache";
import type { AgentToolContext } from "../src/agent/types";

describe("PdfFigureExtractionService", function () {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const globalScope = globalThis as typeof globalThis & {
    IOUtils?: unknown;
  };
  let originalIOUtils: unknown;
  let files: Map<string, Uint8Array>;
  let writeFile: (path: string, value: string) => void;

  const paperContext = {
    itemId: 11,
    contextItemId: 22,
    title: "Figure Paper",
    firstCreator: "Miller",
    year: "2025",
    mineruCacheDir: "/tmp/mineru-paper",
  };
  const manifest = {
    sections: [],
    allFigures: [
      {
        label: "Figure 1",
        baseLabel: "Figure 1",
        path: "images/fig1.png",
        caption: "Figure 1. First precise result.",
        page: 2,
        section: "Results",
      },
    ],
    allTables: [],
    totalChars: 100,
  };

  const context: AgentToolContext = {
    request: {
      conversationKey: 77,
      mode: "agent",
      userText: "",
      libraryID: 1,
    },
    item: null,
    currentAnswerText: "",
    modelName: "gpt-5.5",
  };

  beforeEach(function () {
    originalIOUtils = globalScope.IOUtils;
    files = new Map<string, Uint8Array>();
    writeFile = (path: string, value: string) =>
      files.set(path, encoder.encode(value));
    writeFile("/tmp/mineru-paper/manifest.json", JSON.stringify(manifest));
    globalScope.IOUtils = {
      read: async (path: string) => {
        const bytes = files.get(path);
        if (!bytes) throw new Error(`missing ${path}`);
        return bytes;
      },
      write: async (path: string, bytes: Uint8Array) => {
        files.set(path, bytes);
      },
      makeDirectory: async () => undefined,
      getChildren: async () => [],
    };
  });

  afterEach(function () {
    if (originalIOUtils === undefined) {
      delete globalScope.IOUtils;
    } else {
      globalScope.IOUtils = originalIOUtils;
    }
  });

  function currentManifestHash(): string {
    return buildPdfFigureCropManifestHash(manifest);
  }

  function currentPdfFingerprint(): string {
    return buildPdfFigureCropPdfFingerprint(paperContext);
  }

  function writeCropCache(cache: Record<string, unknown>): void {
    writeFile(
      "/tmp/mineru-paper/figure_crops/figure_geometry.json",
      JSON.stringify(cache),
    );
  }

  function cachedFigure(cropPath: string) {
    return {
      id: "figure-1-p2",
      label: "Figure 1",
      baseLabel: "Figure 1",
      pageNumber: 2,
      cropPath,
      captionText: "Figure 1. First precise result.",
      rect: { left: 57, top: 80, width: 451, height: 331 },
      confidence: 0.9,
      source: "pdf-image-object" as const,
      warnings: [],
      mineruImagePaths: [],
    };
  }

  it("returns verified cached crops before source-PDF extraction", async function () {
    const cropPath = "/tmp/mineru-paper/figure_crops/crops/figure-1-p2.png";
    files.set(cropPath, encoder.encode("png"));
    writeCropCache({
      version: PDF_FIGURE_CROP_CACHE_VERSION,
      attachmentId: 22,
      manifestHash: currentManifestHash(),
      pdfFingerprint: currentPdfFingerprint(),
      renderScale: 1.8,
      algorithmVersion: PDF_FIGURE_CROP_ALGORITHM_VERSION,
      generatedAt: 1,
      expectedFigures: [
        {
          label: "Figure 1",
          baseLabel: "Figure 1",
          pageNumber: 2,
          status: "ok",
          cropPath,
        },
      ],
      missingFigures: [],
      entries: [cachedFigure(cropPath)],
    });
    let rawCalled = false;

    const result = await new PdfFigureExtractionService({
      extractFiguresFromSourcePdf: async () => {
        rawCalled = true;
        throw new Error("source extraction should not run for cached crops");
      },
    } as never).extractFigures({
      input: { query: "explain Figure 1" },
      context,
      paperContexts: [paperContext],
    });

    assert.isFalse(rawCalled);
    assert.equal(result.status, "ok");
    assert.deepEqual(
      result.figures?.map((figure) => figure.cropPath),
      [cropPath],
    );
    assert.deepEqual(
      result.artifacts?.map((artifact) => artifact.storedPath),
      [cropPath],
    );
  });

  it("salvages legacy crop metadata when crop files exist and attachment matches", async function () {
    const cropPath = "/tmp/mineru-paper/figure_crops/crops/figure-1-p2.png";
    const staleExpectedPath =
      "/var/folders/tmp/llm-for-zotero-raw-figures/work/01_figure_1.png";
    files.set(cropPath, encoder.encode("png"));
    writeCropCache({
      version: 1,
      attachmentId: 22,
      manifestHash: "cd1b3122",
      pdfFingerprint: "bd04a030",
      renderScale: 1.8,
      algorithmVersion: 1,
      generatedAt: 1,
      expectedFigures: [
        {
          label: "Figure 1",
          baseLabel: "Figure 1",
          pageNumber: 2,
          status: "ok",
          cropPath: staleExpectedPath,
        },
      ],
      missingFigures: [],
      entries: [cachedFigure(cropPath)],
    });
    let rawCalled = false;

    const result = await new PdfFigureExtractionService({
      extractFiguresFromSourcePdf: async () => {
        rawCalled = true;
        throw new Error("source extraction should not run for salvaged crops");
      },
    } as never).extractFigures({
      input: { query: "explain Figure 1" },
      context,
      paperContexts: [paperContext],
    });

    assert.isFalse(rawCalled);
    assert.equal(result.status, "ok");
    assert.deepEqual(
      result.figures?.map((figure) => figure.cropPath),
      [cropPath],
    );
    const rewritten = JSON.parse(
      decoder.decode(
        files.get("/tmp/mineru-paper/figure_crops/figure_geometry.json"),
      ),
    );
    assert.equal(rewritten.version, PDF_FIGURE_CROP_CACHE_VERSION);
    assert.equal(rewritten.algorithmVersion, PDF_FIGURE_CROP_ALGORITHM_VERSION);
    assert.equal(rewritten.manifestHash, currentManifestHash());
    assert.equal(rewritten.pdfFingerprint, currentPdfFingerprint());
    assert.equal(rewritten.expectedFigures[0].cropPath, cropPath);
  });

  it("regenerates when cached crop files are missing", async function () {
    const staleCropPath =
      "/tmp/mineru-paper/figure_crops/crops/missing-figure-1-p2.png";
    const regeneratedCropPath =
      "/tmp/mineru-paper/figure_crops/crops/figure-1-p2.png";
    writeCropCache({
      version: PDF_FIGURE_CROP_CACHE_VERSION,
      attachmentId: 22,
      manifestHash: currentManifestHash(),
      pdfFingerprint: currentPdfFingerprint(),
      renderScale: 1.8,
      algorithmVersion: PDF_FIGURE_CROP_ALGORITHM_VERSION,
      generatedAt: 1,
      entries: [cachedFigure(staleCropPath)],
    });
    let rawCalled = false;

    const result = await new PdfFigureExtractionService({
      extractFiguresFromSourcePdf: async () => {
        rawCalled = true;
        return [cachedFigure(regeneratedCropPath)];
      },
    } as never).extractFigures({
      input: { query: "explain Figure 1" },
      context,
      paperContexts: [paperContext],
    });

    assert.isTrue(rawCalled);
    assert.equal(result.status, "ok");
    assert.deepEqual(
      result.figures?.map((figure) => figure.cropPath),
      [regeneratedCropPath],
    );
  });

  it("uses raw source-PDF extraction as the normal figure path", async function () {
    let rawCalled = false;
    let fallbackCalled = false;
    const result = await new PdfFigureExtractionService({
      extractFiguresFromSourcePdf: async (params: {
        query: string;
        mineruCacheDir: string;
        pages?: number[];
      }) => {
        rawCalled = true;
        assert.equal(params.query, "explain Figure 1");
        assert.equal(params.mineruCacheDir, "/tmp/mineru-paper");
        assert.deepEqual(params.pages, [1]);
        return [
          {
            id: "figure-1-p2",
            label: "Figure 1",
            baseLabel: "Figure 1",
            pageNumber: 2,
            cropPath: "/tmp/mineru-paper/figure_crops/crops/figure-1-p2.png",
            captionText: "Figure 1. First precise result.",
            rect: { left: 57, top: 80, width: 451, height: 331 },
            confidence: 0.9,
            source: "pdf-image-object" as const,
            warnings: [],
            mineruImagePaths: [],
          },
        ];
      },
      preparePagesForFigureExtraction: async () => {
        fallbackCalled = true;
        throw new Error("old fallback should not be called");
      },
    } as never).extractFigures({
      input: { query: "explain Figure 1", pages: [1] },
      context,
      paperContexts: [paperContext],
    });

    assert.isTrue(rawCalled);
    assert.isFalse(fallbackCalled);
    assert.equal(result.status, "ok");
    assert.deepEqual(
      result.figures?.map((figure) => ({
        label: figure.label,
        source: figure.source,
        cropPath: figure.cropPath,
        mineruImagePaths: figure.mineruImagePaths,
      })),
      [
        {
          label: "Figure 1",
          source: "pdf-image-object",
          cropPath: "/tmp/mineru-paper/figure_crops/crops/figure-1-p2.png",
          mineruImagePaths: [],
        },
      ],
    );
    const cacheBytes = files.get(
      "/tmp/mineru-paper/figure_crops/figure_geometry.json",
    );
    assert.instanceOf(cacheBytes, Uint8Array);
    const cache = JSON.parse(decoder.decode(cacheBytes));
    assert.equal(cache.version, 2);
    assert.equal(cache.algorithmVersion, 9);
    assert.equal(cache.entries[0].source, "pdf-image-object");
  });

  it("returns and caches expected and missing figures from raw source-PDF extraction", async function () {
    const result = await new PdfFigureExtractionService({
      extractFiguresFromSourcePdf: async () => ({
        figures: [
          {
            id: "figure-1-p2",
            label: "Figure 1",
            baseLabel: "Figure 1",
            pageNumber: 2,
            captionPageNumber: 2,
            cropPath: "/tmp/mineru-paper/figure_crops/crops/figure-1-p2.png",
            captionText: "Figure 1. First precise result.",
            rect: { left: 57, top: 80, width: 451, height: 331 },
            confidence: 0.9,
            source: "pdf-image-object" as const,
            warnings: [],
            mineruImagePaths: [],
          },
        ],
        expectedFigures: [
          {
            label: "Figure 1",
            baseLabel: "Figure 1",
            pageNumber: 2,
            captionPageNumber: 2,
            status: "ok",
            cropPath: "/tmp/mineru-paper/figure_crops/crops/figure-1-p2.png",
          },
          {
            label: "Figure 2",
            baseLabel: "Figure 2",
            pageNumber: 4,
            captionPageNumber: 5,
            status: "no_confident_candidate",
          },
        ],
        missingFigures: [
          {
            label: "Figure 2",
            baseLabel: "Figure 2",
            pageNumber: 4,
            captionPageNumber: 5,
            status: "no_confident_candidate",
          },
        ],
        warnings: ["Missing requested figure crops: Figure 2"],
      }),
    } as never).extractFigures({
      input: { query: "explain all figures" },
      context,
      paperContexts: [paperContext],
    });

    assert.equal(result.status, "ok");
    assert.deepEqual(
      result.missingFigures?.map((figure) => figure.label),
      ["Figure 2"],
    );
    assert.include(result.guidance || "", "partial results");
    const cache = JSON.parse(
      decoder.decode(
        files.get("/tmp/mineru-paper/figure_crops/figure_geometry.json"),
      ),
    );
    assert.deepEqual(
      cache.missingFigures.map((figure: { label: string }) => figure.label),
      ["Figure 2"],
    );
  });

  it("does not silently fall back when raw source-PDF extraction returns no crops", async function () {
    let fallbackCalled = false;
    const result = await new PdfFigureExtractionService({
      extractFiguresFromSourcePdf: async () => [],
      preparePagesForFigureExtraction: async () => {
        fallbackCalled = true;
        return {
          target: { source: "library", title: "Figure Paper" },
          pages: [],
        };
      },
    } as never).extractFigures({
      input: { query: "explain Figure 1" },
      context,
      paperContexts: [paperContext],
    });

    assert.equal(result.status, "no_figures");
    assert.isFalse(fallbackCalled);
    assert.match(result.warnings?.join("\n") || "", /No requested source-PDF/);
  });

  it("does not fall back to rendered PDF page crops when source-PDF extraction is unavailable", async function () {
    let fallbackCalled = false;
    const result = await new PdfFigureExtractionService({
      preparePagesForFigureExtraction: async () => {
        fallbackCalled = true;
        return {
          target: { source: "library", title: "Figure Paper" },
          pages: [
            {
              pageIndex: 1,
              pageLabel: "2",
              width: 800,
              height: 1000,
              textBoxes: [],
              imageBoxes: [],
              inkBoxes: [{ left: 40, top: 80, width: 500, height: 320 }],
              cropToPngBytes: async () => encoder.encode("fallback-png"),
            },
          ],
        };
      },
    } as never).extractFigures({
      input: { query: "explain Figure 1" },
      context,
      paperContexts: [paperContext],
    });

    assert.equal(result.status, "no_figures");
    assert.isFalse(fallbackCalled);
    assert.deepEqual(result.figures, []);
    assert.deepEqual(result.artifacts, []);
    assert.match(
      result.warnings?.join("\n") || "",
      /Source-PDF figure extraction is unavailable/i,
    );
    assert.include(result.guidance || "", "switch to text-only mode");
  });

  it("does not fall back to rendered PDF page crops when source-PDF extraction fails before producing crops", async function () {
    let fallbackCalled = false;
    const result = await new PdfFigureExtractionService({
      extractFiguresFromSourcePdf: async () => {
        throw new Error("fetch HTTP404; Zotero.HTTP404");
      },
      preparePagesForFigureExtraction: async (params: { pages: number[] }) => {
        fallbackCalled = true;
        assert.deepEqual(params.pages, [1]);
        return {
          target: { source: "library", title: "Figure Paper" },
          pages: [
            {
              pageIndex: 1,
              pageLabel: "2",
              width: 800,
              height: 1000,
              textBoxes: [],
              imageBoxes: [],
              inkBoxes: [{ left: 40, top: 80, width: 500, height: 320 }],
              cropToPngBytes: async () => encoder.encode("fallback-png"),
            },
          ],
        };
      },
    } as never).extractFigures({
      input: { query: "explain Figure 1" },
      context,
      paperContexts: [paperContext],
    });

    assert.equal(result.status, "no_figures");
    assert.isFalse(fallbackCalled);
    assert.deepEqual(result.figures, []);
    assert.deepEqual(result.artifacts, []);
    assert.match(
      result.warnings?.join("\n") || "",
      /Could not run source-PDF figure extraction: fetch HTTP404; Zotero.HTTP404/,
    );
    assert.include(result.guidance || "", "switch to text-only mode");
  });
});
