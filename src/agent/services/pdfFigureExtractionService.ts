import { type MineruManifest } from "../../modules/contextPanel/mineruCache";
import {
  PDF_FIGURE_CROP_ALGORITHM_VERSION,
  PDF_FIGURE_CROP_CACHE_VERSION,
  buildPdfFigureCropManifestHash,
  buildPdfFigureCropPdfFingerprint,
  getPdfFigureCropCacheFreshness,
  pdfFigureCropFileExists,
  readPdfFigureCropCacheFromDir,
  writePdfFigureCropCacheToDir,
  type ExpectedPdfFigure,
  type ExtractedPdfFigure,
  type PdfFigureCropCache,
} from "../../modules/contextPanel/pdfFigureCropCache";
import { joinLocalPath } from "../../utils/localPath";
import type { PaperReadFigureExtractionResult } from "../tools/read/paperRead";
import type { PdfTarget } from "../tools/read/pdfToolUtils";
import type { AgentToolArtifact, AgentToolContext } from "../types";
import type { PdfPageService } from "./pdfPageService";

const FIGURE_EXTRACTION_RENDER_SCALE = 1.8;

type FigureExtractionInput = {
  query?: string;
  pages?: number[];
  target?: PdfTarget;
};

type FigureExtractionParams = {
  input: FigureExtractionInput;
  context: AgentToolContext;
  paperContexts: NonNullable<PdfTarget["paperContext"]>[];
};

type FigureCropPageService = PdfPageService & {
  extractFiguresFromSourcePdf?: (params: {
    request: AgentToolContext["request"];
    paperContext?: NonNullable<PdfTarget["paperContext"]>;
    mineruCacheDir: string;
    query: string;
    pages?: number[];
    dpi?: number;
  }) => Promise<
    | ExtractedPdfFigure[]
    | {
        figures: ExtractedPdfFigure[];
        expectedFigures?: ExpectedPdfFigure[];
        missingFigures?: ExpectedPdfFigure[];
        warnings?: string[];
      }
  >;
};

function normalizeText(value: unknown): string {
  return `${value ?? ""}`.replace(/\s+/g, " ").trim();
}

function normalizePositiveInt(value: unknown): number {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

async function readTextFile(filePath: string): Promise<string | null> {
  const io = (globalThis as any).IOUtils;
  if (!io?.read) return null;
  try {
    const data = await io.read(filePath);
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return null;
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  const text = await readTextFile(filePath);
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function readMineruManifestFromDir(
  cacheDir: string,
): Promise<MineruManifest | null> {
  return readJsonFile<MineruManifest>(joinLocalPath(cacheDir, "manifest.json"));
}

function artifactForFigure(
  figure: ExtractedPdfFigure,
  paperContext: NonNullable<PdfTarget["paperContext"]>,
): AgentToolArtifact {
  return {
    kind: "image",
    mimeType: "image/png",
    storedPath: figure.cropPath,
    title: figure.label,
    pageIndex: figure.pageNumber - 1,
    pageLabel: `${figure.pageNumber}`,
    paperContext,
  };
}

function cropPathByFigureLabel(
  figures: ExtractedPdfFigure[],
): Map<string, string> {
  const paths = new Map<string, string>();
  for (const figure of figures) {
    for (const label of [figure.label, figure.baseLabel]) {
      const normalized = normalizeText(label).toLowerCase();
      if (normalized && !paths.has(normalized)) {
        paths.set(normalized, figure.cropPath);
      }
    }
  }
  return paths;
}

function refreshExpectedFigureCropPaths(
  expectedFigures: ExpectedPdfFigure[],
  figures: ExtractedPdfFigure[],
): ExpectedPdfFigure[] {
  if (!expectedFigures.length) return expectedFigures;
  const cropPaths = cropPathByFigureLabel(figures);
  return expectedFigures.map((figure) => {
    const cropPath =
      cropPaths.get(normalizeText(figure.label).toLowerCase()) ||
      cropPaths.get(normalizeText(figure.baseLabel).toLowerCase());
    return cropPath ? { ...figure, cropPath } : figure;
  });
}

async function readVerifiedCachedFigures(params: {
  cacheDir: string;
  attachmentId: number;
  manifest: MineruManifest | null;
  manifestHash: string;
  pdfFingerprint: string;
  paperContext: NonNullable<PdfTarget["paperContext"]>;
}): Promise<{
  figures: ExtractedPdfFigure[];
  expectedFigures: ExpectedPdfFigure[];
  missingFigures: ExpectedPdfFigure[];
} | null> {
  const cache = await readPdfFigureCropCacheFromDir(params.cacheDir);
  if (!cache?.entries?.length) return null;

  const attachmentMatches =
    normalizePositiveInt(cache.attachmentId) === params.attachmentId;
  if (!attachmentMatches) return null;

  const figures: ExtractedPdfFigure[] = [];
  for (const figure of cache.entries) {
    if (
      normalizeText(figure.cropPath) &&
      (await pdfFigureCropFileExists(figure.cropPath))
    ) {
      figures.push(figure);
    }
  }
  if (!figures.length) return null;

  const expectedFigures = refreshExpectedFigureCropPaths(
    cache.expectedFigures || [],
    figures,
  );
  const missingFigures = cache.missingFigures || [];
  const freshness = getPdfFigureCropCacheFreshness(cache, {
    manifest: params.manifest,
    paperContext: params.paperContext,
  });
  const shouldRewrite =
    !freshness.ok ||
    figures.length !== cache.entries.length ||
    expectedFigures.some(
      (figure, index) =>
        figure.cropPath !== cache.expectedFigures?.[index]?.cropPath,
    );

  if (shouldRewrite) {
    const rewritten: PdfFigureCropCache = {
      ...cache,
      version: PDF_FIGURE_CROP_CACHE_VERSION,
      attachmentId: params.attachmentId,
      manifestHash: params.manifestHash,
      pdfFingerprint: params.pdfFingerprint,
      renderScale: FIGURE_EXTRACTION_RENDER_SCALE,
      algorithmVersion: PDF_FIGURE_CROP_ALGORITHM_VERSION,
      generatedAt: Date.now(),
      expectedFigures,
      missingFigures,
      entries: figures,
    };
    try {
      await writePdfFigureCropCacheToDir(params.cacheDir, rewritten);
    } catch {
      // A metadata repair failure should not block already verified crop files.
    }
  }

  return { figures, expectedFigures, missingFigures };
}

export class PdfFigureExtractionService {
  constructor(private readonly pdfPageService: PdfPageService) {}

  async extractFigures(
    params: FigureExtractionParams,
  ): Promise<PaperReadFigureExtractionResult> {
    const query = params.input.query || params.context.request.userText || "";
    const figures: ExtractedPdfFigure[] = [];
    const artifacts: AgentToolArtifact[] = [];
    const warnings: string[] = [];
    const expectedFigures: ExpectedPdfFigure[] = [];
    const missingFigures: ExpectedPdfFigure[] = [];

    for (const paperContext of params.paperContexts) {
      const attachmentId = Math.floor(Number(paperContext.contextItemId || 0));
      const mineruCacheDir = normalizeText(paperContext.mineruCacheDir);
      if (!attachmentId || !mineruCacheDir) {
        warnings.push(`${paperContext.title || "Paper"} is not MinerU-ready.`);
        continue;
      }

      const manifest = await readMineruManifestFromDir(mineruCacheDir);
      const manifestHash = buildPdfFigureCropManifestHash(manifest);
      const pdfFingerprint = buildPdfFigureCropPdfFingerprint(paperContext);
      const cached = await readVerifiedCachedFigures({
        cacheDir: mineruCacheDir,
        attachmentId,
        manifest,
        manifestHash,
        pdfFingerprint,
        paperContext,
      });
      if (cached) {
        expectedFigures.push(...cached.expectedFigures);
        missingFigures.push(...cached.missingFigures);
        for (const figure of cached.figures) {
          figures.push(figure);
          artifacts.push(artifactForFigure(figure, paperContext));
        }
        continue;
      }
      const pageService = this.pdfPageService as FigureCropPageService;
      const rawSourcePdfExtractor = pageService.extractFiguresFromSourcePdf;
      const recordExtractionResult = async (result: {
        figures: ExtractedPdfFigure[];
        expectedFigures?: ExpectedPdfFigure[];
        missingFigures?: ExpectedPdfFigure[];
        warnings?: string[];
      }): Promise<boolean> => {
        const rawFigures = result.figures || [];
        const rawExpectedFigures = result.expectedFigures || [];
        const rawMissingFigures = result.missingFigures || [];
        expectedFigures.push(...rawExpectedFigures);
        missingFigures.push(...rawMissingFigures);
        if (result.warnings?.length) warnings.push(...result.warnings);
        if (!rawFigures.length) return false;
        for (const figure of rawFigures) {
          figures.push(figure);
          artifacts.push(artifactForFigure(figure, paperContext));
        }
        await writePdfFigureCropCacheToDir(mineruCacheDir, {
          version: PDF_FIGURE_CROP_CACHE_VERSION,
          attachmentId,
          manifestHash,
          pdfFingerprint,
          renderScale: FIGURE_EXTRACTION_RENDER_SCALE,
          algorithmVersion: PDF_FIGURE_CROP_ALGORITHM_VERSION,
          generatedAt: Date.now(),
          expectedFigures: rawExpectedFigures,
          missingFigures: rawMissingFigures,
          entries: rawFigures,
        });
        return true;
      };
      if (typeof rawSourcePdfExtractor !== "function") {
        warnings.push("Source-PDF figure extraction is unavailable.");
        continue;
      }

      try {
        const rawResult = await rawSourcePdfExtractor.call(
          this.pdfPageService,
          {
            request: params.context.request,
            paperContext,
            mineruCacheDir,
            query,
            pages: params.input.pages,
            dpi: 216,
          },
        );
        const rawFigures = Array.isArray(rawResult)
          ? rawResult
          : rawResult.figures || [];
        const rawExpectedFigures = Array.isArray(rawResult)
          ? rawFigures.map((figure) => ({
              label: figure.label,
              baseLabel: figure.baseLabel,
              pageNumber: figure.pageNumber,
              captionPageNumber: figure.captionPageNumber,
              status: "ok",
              cropPath: figure.cropPath,
              source: figure.source,
              confidence: figure.confidence,
            }))
          : rawResult.expectedFigures || [];
        const rawMissingFigures = Array.isArray(rawResult)
          ? []
          : rawResult.missingFigures || [];
        const recorded = await recordExtractionResult({
          figures: rawFigures,
          expectedFigures: rawExpectedFigures,
          missingFigures: rawMissingFigures,
          warnings: Array.isArray(rawResult) ? [] : rawResult.warnings || [],
        });
        if (!recorded) {
          warnings.push(
            `No requested source-PDF figure crops were produced for ${query}.`,
          );
        }
      } catch (error) {
        warnings.push(
          `Could not run source-PDF figure extraction: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return {
      mode: "figures",
      status: figures.length ? "ok" : "no_figures",
      query,
      guidance: figures.length
        ? missingFigures.length
          ? "Figure extraction returned partial results. Do not write an all-figures note unless the user explicitly accepts a partial note; embed only returned PDF crop paths and do not embed MinerU source image paths."
          : "Figure extraction succeeded. For figure notes, call note_write next and embed the returned cropPath with file:///; do not call paper_read again for the same figure and do not embed MinerU source image paths."
        : "No extracted figure crop was produced; switch to text-only mode for analysis, note taking, and follow-up artifacts: do not include figure images, rendered PDF page screenshots, MinerU source images, or extracted-image placeholders. Explicitly state that figure extraction failed or no extracted crops are available, and that explanations are based on captions, figure legends, and surrounding paper text. User-provided image inputs are unaffected.",
      figures,
      artifacts,
      expectedFigures,
      missingFigures,
      warnings,
    };
  }
}
