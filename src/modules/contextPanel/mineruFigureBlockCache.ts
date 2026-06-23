import { joinLocalPath } from "../../utils/localPath";
import {
  buildMineruFigureBlocks,
  findMineruFigureBlockByImagePath,
  validateFigureBlockEmbeds,
  type FigureBlockEmbedValidationResult,
  type MineruFigureBlock,
} from "./mineruFigureBlocks";
import {
  readMineruContentListFromDir,
  type MineruManifest,
} from "./mineruCache";

type IOUtilsLike = {
  read?: (path: string) => Promise<Uint8Array>;
};

export type LoadedMineruFigureBlocks = {
  cacheDir: string;
  blocks: MineruFigureBlock[];
};

function getIOUtils(): IOUtilsLike | undefined {
  return (globalThis as unknown as { IOUtils?: IOUtilsLike }).IOUtils;
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
  return joinLocalPath(cacheDir, ...relativePath.split(/[\\/]+/).filter(Boolean));
}

export function absolutizeMineruFigureBlock(
  block: MineruFigureBlock,
  cacheDir: string,
): MineruFigureBlock {
  return {
    ...block,
    imagePaths: block.imagePaths.map((path) => toAbsoluteMineruPath(cacheDir, path)),
  };
}

export async function loadMineruFigureBlocksFromCacheDir(
  cacheDir: string,
  encoding = "utf-8",
): Promise<MineruFigureBlock[]> {
  const fullMd =
    (await readTextFile(joinLocalPath(cacheDir, "full.md"), encoding)) ||
    (await synthesizeMarkdownFromManifest(cacheDir, encoding));
  if (!fullMd.trim()) return [];
  const contentList = await readMineruContentListFromDir(cacheDir);
  const manifest = await readJsonFile<MineruManifest>(
    joinLocalPath(cacheDir, "manifest.json"),
    encoding,
  );
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
  encoding?: string;
}): Promise<FigureBlockEmbedValidationResult | null> {
  if (!params.content.trim()) return null;
  const loaded = await loadMineruFigureBlocksFromCacheDirs(
    params.cacheDirs,
    params.encoding,
  );
  for (const entry of loaded) {
    const result = validateFigureBlockEmbeds({
      content: params.content,
      requestText: params.requestText,
      blocks: entry.blocks,
    });
    if (!result) continue;
    const availablePaths = result.availablePaths.map((path) =>
      toAbsoluteMineruPath(entry.cacheDir, path),
    );
    const label =
      result.block.labelHints[0] ||
      result.block.sectionHeading ||
      "figure block";
    return {
      ...result,
      block: absolutizeMineruFigureBlock(result.block, entry.cacheDir),
      availablePaths,
      message:
        `Incomplete MinerU figure block: ${label} has ${result.availableCount} adjacent image${result.availableCount === 1 ? "" : "s"}, ` +
        `but this note embeds ${result.embeddedCount}. Embed every image in source order` +
        (result.severity === "advisory"
          ? " or explicitly state the block boundary/panel mapping ambiguity"
          : "") +
        `. Available paths: ${availablePaths.join(", ")}`,
    };
  }
  return null;
}

export async function findMineruImageBlockInCacheDirs(params: {
  imagePath: string;
  cacheDirs: string[];
  encoding?: string;
}): Promise<{ cacheDir: string; block: MineruFigureBlock } | null> {
  const loaded = await loadMineruFigureBlocksFromCacheDirs(
    params.cacheDirs,
    params.encoding,
  );
  for (const entry of loaded) {
    const block = findMineruFigureBlockByImagePath(params.imagePath, entry.blocks);
    if (!block) continue;
    return {
      cacheDir: entry.cacheDir,
      block: absolutizeMineruFigureBlock(block, entry.cacheDir),
    };
  }
  return null;
}
