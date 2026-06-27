import { joinLocalPath } from "../../utils/localPath";
import type { PaperContextRef } from "../../shared/types";
import {
  buildMineruFigureBlocks,
  allowsTextOnlyFigureNoteAfterExtractionFailure,
  findMineruFigureBlockByImagePath,
  getManifestFigureBaseLabel,
  requiresCompleteFigureCropCoverage,
  validateFigureBlockEmbeds,
  type FigureBlockEmbedValidationResult,
  type MineruFigureBlock,
  type MineruFigureBlockKind,
} from "./mineruFigureBlocks";
import {
  readMineruContentListFromDir,
  type MineruManifest,
} from "./mineruCache";
import {
  PDF_FIGURE_CROP_DIR,
  PDF_FIGURE_CROP_METADATA_FILE,
  getPdfFigureCropCacheFreshness,
  type PdfFigureCropFreshness,
  type PdfFigureCropFreshnessReason,
  type PdfFigureCropCache,
} from "./pdfFigureCropCache";

type IOUtilsLike = {
  read?: (path: string) => Promise<Uint8Array>;
};

export type LoadedMineruFigureBlocks = {
  cacheDir: string;
  blocks: MineruFigureBlock[];
};

type CropCacheState = {
  cache: PdfFigureCropCache | null;
  freshness: PdfFigureCropFreshness;
};

function normalizeCacheDir(value: string): string {
  return `${value || ""}`.trim();
}

function findPaperContextForCacheDir(
  cacheDir: string,
  paperContexts: PaperContextRef[] | undefined,
): PaperContextRef | undefined {
  const normalized = normalizeCacheDir(cacheDir);
  return (paperContexts || []).find(
    (paperContext) =>
      normalizeCacheDir(paperContext.mineruCacheDir || "") === normalized,
  );
}

function figureCropMetadataBlock(cacheDir: string): MineruFigureBlock {
  return {
    blockId: `figure-crop-metadata:${cacheDir}`,
    kind: "figure",
    imagePaths: [],
    markdownStart: 0,
    markdownEnd: 0,
    contextStart: 0,
    contextEnd: 0,
    labelHints: ["source-PDF figure crop metadata"],
    captionHints: [],
    sectionHeading: null,
    confidence: "high",
    ambiguous: false,
  };
}

function cropMetadataIssueMessage(
  reason: PdfFigureCropFreshnessReason,
): string {
  const issue =
    reason === "missing" ? "metadata is missing" : "metadata is stale";
  return (
    `Cannot save an all-figures note because source-PDF figure crop ${issue}. ` +
    `Call paper_read mode:'figures' again before saving a complete all-figures note, ` +
    `or ask explicitly for a partial note.`
  );
}

function buildCropMetadataGuard(
  cacheDir: string,
  reason: PdfFigureCropFreshnessReason,
): FigureBlockEmbedValidationResult {
  return {
    block: figureCropMetadataBlock(cacheDir),
    embeddedCount: 0,
    availableCount: 0,
    availablePaths: [],
    severity: "block",
    message: cropMetadataIssueMessage(reason),
  };
}

function getIOUtils(): IOUtilsLike | undefined {
  return (globalThis as unknown as { IOUtils?: IOUtilsLike }).IOUtils;
}

function uniqueStrings(values: Iterable<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = `${raw || ""}`.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function normalizePathKey(path: string): string {
  return `${path || ""}`
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "");
}

function collectManifestPageHints(
  manifest: MineruManifest | null,
): Map<string, number> {
  const pages = new Map<string, number>();
  const entries = [
    ...(manifest?.allFigures || []),
    ...(manifest?.allTables || []),
    ...(manifest?.sections || []).flatMap((section) => [
      ...(section.figures || []),
      ...(section.tables || []),
    ]),
  ];
  for (const entry of entries) {
    const path = normalizePathKey(entry.path);
    const page = Number(entry.page);
    if (!path || !Number.isFinite(page)) continue;
    pages.set(path, Math.floor(page));
  }
  return pages;
}

function collectContentListPageHints(
  contentList: Array<{ img_path?: string; page_idx?: number }> | undefined,
): Map<string, number> {
  const pages = new Map<string, number>();
  for (const entry of contentList || []) {
    const path = normalizePathKey(entry.img_path || "");
    const page = Number(entry.page_idx);
    if (!path || !Number.isFinite(page)) continue;
    pages.set(path, Math.floor(page));
  }
  return pages;
}

function normalizeCachedFigureBlocks(
  blocks: MineruFigureBlock[],
  manifest: MineruManifest | null,
  contentList?: Array<{ img_path?: string; page_idx?: number }>,
): MineruFigureBlock[] {
  const manifestPageByPath = collectManifestPageHints(manifest);
  const contentListPageByPath = collectContentListPageHints(contentList);
  const validKinds = new Set<MineruFigureBlockKind>([
    "figure",
    "table",
    "image",
    "mixed",
  ]);
  return blocks
    .filter(
      (block) => Array.isArray(block.imagePaths) && block.imagePaths.length,
    )
    .map((block, index) => {
      const imagePaths = block.imagePaths
        .map((path) => `${path || ""}`.trim())
        .filter(Boolean);
      const manifestPages = imagePaths
        .map((path) => {
          const key = normalizePathKey(path);
          return contentListPageByPath.get(key) ?? manifestPageByPath.get(key);
        })
        .filter((page): page is number => Number.isFinite(page));
      const canonicalLabels = (block.labelHints || []).flatMap((label) => {
        const canonical = getManifestFigureBaseLabel(label);
        return canonical === label ? [label] : [canonical, label];
      });
      return {
        ...block,
        blockId: `${block.blockId || `${index}:${imagePaths[0] || index}`}`,
        kind: validKinds.has(block.kind) ? block.kind : "image",
        imagePaths,
        markdownStart: Number.isFinite(block.markdownStart)
          ? block.markdownStart
          : 0,
        markdownEnd: Number.isFinite(block.markdownEnd) ? block.markdownEnd : 0,
        contextStart: Number.isFinite(block.contextStart)
          ? block.contextStart
          : 0,
        contextEnd: Number.isFinite(block.contextEnd) ? block.contextEnd : 0,
        labelHints: uniqueStrings(canonicalLabels),
        captionHints: uniqueStrings(block.captionHints || []),
        sectionHeading: block.sectionHeading || null,
        ...(manifestPages.length
          ? {
              pageStart: Math.min(...manifestPages),
              pageEnd: Math.max(...manifestPages),
            }
          : {}),
        confidence: block.confidence === "low" ? "low" : "high",
        ambiguous: Boolean(block.ambiguous),
      };
    });
}

async function readTextFile(
  filePath: string,
  encoding: string,
): Promise<string | null> {
  const io = getIOUtils();
  if (!io?.read) return null;
  try {
    return new TextDecoder(encoding).decode(await io.read(filePath));
  } catch {
    return null;
  }
}

async function readJsonFile<T>(
  filePath: string,
  encoding: string,
): Promise<T | null> {
  const text = await readTextFile(filePath, encoding);
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function readCropCacheState(params: {
  cacheDir: string;
  encoding: string;
  paperContexts?: PaperContextRef[];
}): Promise<CropCacheState> {
  const manifest = await readJsonFile<MineruManifest>(
    joinLocalPath(params.cacheDir, "manifest.json"),
    params.encoding,
  );
  const rawCache = await readJsonFile<PdfFigureCropCache>(
    joinLocalPath(
      params.cacheDir,
      PDF_FIGURE_CROP_DIR,
      PDF_FIGURE_CROP_METADATA_FILE,
    ),
    params.encoding,
  );
  const freshness = getPdfFigureCropCacheFreshness(rawCache, {
    manifest,
    paperContext: findPaperContextForCacheDir(
      params.cacheDir,
      params.paperContexts,
    ),
  });
  return {
    cache: freshness.ok ? rawCache : null,
    freshness,
  };
}

export function toAbsoluteMineruPath(
  cacheDir: string,
  relativePath: string,
): string {
  if (
    /^[a-z][a-z0-9+.-]*:\/\//i.test(relativePath) ||
    /^[A-Za-z]:[\\/]/.test(relativePath) ||
    /^[\\/]/.test(relativePath)
  ) {
    return relativePath;
  }
  return joinLocalPath(
    cacheDir,
    ...relativePath.split(/[\\/]+/).filter(Boolean),
  );
}

export function absolutizeMineruFigureBlock(
  block: MineruFigureBlock,
  cacheDir: string,
): MineruFigureBlock {
  return {
    ...block,
    imagePaths: block.imagePaths.map((path) =>
      toAbsoluteMineruPath(cacheDir, path),
    ),
  };
}

export async function loadMineruFigureBlocksFromCacheDir(
  cacheDir: string,
  encoding = "utf-8",
): Promise<MineruFigureBlock[]> {
  const manifest = await readJsonFile<MineruManifest>(
    joinLocalPath(cacheDir, "manifest.json"),
    encoding,
  );
  if (manifest?.figureBlocks?.length) {
    const contentList = await readMineruContentListFromDir(cacheDir);
    return normalizeCachedFigureBlocks(
      manifest.figureBlocks,
      manifest,
      contentList,
    );
  }
  const fullMd =
    (await readTextFile(joinLocalPath(cacheDir, "full.md"), encoding)) ||
    (await synthesizeMarkdownFromManifest(cacheDir, encoding));
  if (!fullMd.trim()) return [];
  const contentList = await readMineruContentListFromDir(cacheDir);
  return buildMineruFigureBlocks({
    fullMd,
    contentList,
    manifestLike: manifest || undefined,
  });
}

async function synthesizeMarkdownFromManifest(
  cacheDir: string,
  encoding: string,
): Promise<string> {
  const manifest = await readJsonFile<MineruManifest>(
    joinLocalPath(cacheDir, "manifest.json"),
    encoding,
  );
  const paths = [
    ...(manifest?.allFigures || []).map((entry) => entry.path),
    ...(manifest?.allTables || []).map((entry) => entry.path),
  ].filter(Boolean);
  return paths.map((path) => `![](${path})`).join("\n\n");
}

export async function loadMineruFigureBlocksFromCacheDirs(
  cacheDirs: string[],
  encoding = "utf-8",
): Promise<LoadedMineruFigureBlocks[]> {
  const loaded: LoadedMineruFigureBlocks[] = [];
  const seen = new Set<string>();
  for (const rawCacheDir of cacheDirs) {
    const cacheDir = rawCacheDir.trim();
    if (!cacheDir || seen.has(cacheDir)) continue;
    seen.add(cacheDir);
    const blocks = await loadMineruFigureBlocksFromCacheDir(cacheDir, encoding);
    if (blocks.length) loaded.push({ cacheDir, blocks });
  }
  return loaded;
}

export async function validateMineruFigureBlockEmbedsForCacheDirs(params: {
  content: string;
  requestText: string;
  cacheDirs: string[];
  paperContexts?: PaperContextRef[];
  encoding?: string;
}): Promise<FigureBlockEmbedValidationResult | null> {
  if (!params.content.trim()) return null;
  const seenCacheDirs = new Set<string>();
  const cacheStates = new Map<string, CropCacheState>();
  const encoding = params.encoding || "utf-8";
  const requiresCompleteCoverage = requiresCompleteFigureCropCoverage(
    params.content,
    params.requestText,
  );
  const allowsTextOnlyAfterFailure =
    allowsTextOnlyFigureNoteAfterExtractionFailure(
      params.content,
      params.requestText,
    );
  for (const rawCacheDir of params.cacheDirs) {
    const cacheDir = rawCacheDir.trim();
    if (!cacheDir || seenCacheDirs.has(cacheDir)) continue;
    seenCacheDirs.add(cacheDir);
    const cropState = await readCropCacheState({
      cacheDir,
      encoding,
      paperContexts: params.paperContexts,
    });
    cacheStates.set(cacheDir, cropState);
    if (
      requiresCompleteCoverage &&
      !allowsTextOnlyAfterFailure &&
      !cropState.freshness.ok
    ) {
      return buildCropMetadataGuard(cacheDir, cropState.freshness.reason);
    }
    const cropCache = cropState.cache;
    if (!cropCache?.missingFigures?.length) continue;
    const result = validateFigureBlockEmbeds({
      content: params.content,
      requestText: params.requestText,
      blocks: [],
      extractedFigures: cropCache.entries || [],
      missingFigures: cropCache.missingFigures || [],
    });
    if (!result) continue;
    return {
      ...result,
      block: absolutizeMineruFigureBlock(result.block, cacheDir),
      availablePaths: result.availablePaths.map((path) =>
        toAbsoluteMineruPath(cacheDir, path),
      ),
      message: result.message,
    };
  }
  const loaded = await loadMineruFigureBlocksFromCacheDirs(
    params.cacheDirs,
    params.encoding,
  );
  for (const entry of loaded) {
    let cropState = cacheStates.get(entry.cacheDir);
    if (!cropState) {
      cropState = await readCropCacheState({
        cacheDir: entry.cacheDir,
        encoding,
        paperContexts: params.paperContexts,
      });
      cacheStates.set(entry.cacheDir, cropState);
    }
    const cropCache = cropState.cache;
    const result = validateFigureBlockEmbeds({
      content: params.content,
      requestText: params.requestText,
      blocks: entry.blocks,
      extractedFigures: cropCache?.entries || [],
      missingFigures: cropCache?.missingFigures || [],
    });
    if (!result) continue;
    const availablePaths = result.availablePaths.map((path) =>
      toAbsoluteMineruPath(entry.cacheDir, path),
    );
    return {
      ...result,
      block: absolutizeMineruFigureBlock(result.block, entry.cacheDir),
      availablePaths,
      message: result.message,
    };
  }
  return null;
}
