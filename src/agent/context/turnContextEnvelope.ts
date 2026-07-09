import type { AgentRuntimeRequest } from "../types";
import type {
  ActiveNoteContext,
  ChatAttachment,
  CollectionContextRef,
  NoteContextRef,
  PaperContextRef,
  SelectedTextSource,
  TagContextRef,
} from "../../shared/types";

export type TurnContextEnvelopeInput = Pick<
  AgentRuntimeRequest,
  | "activeItemId"
  | "attachments"
  | "conversationKind"
  | "fullTextPaperContexts"
  | "libraryID"
  | "pinnedPaperContexts"
  | "screenshots"
  | "selectedCollectionContexts"
  | "selectedPaperContexts"
  | "selectedTagContexts"
  | "selectedTextNoteContexts"
  | "selectedTextPaperContexts"
  | "selectedTextSources"
  | "selectedTexts"
> & {
  activeNoteContext?: ActiveNoteContext;
  activePaperContext?: PaperContextRef;
  activePaperTitle?: string;
  libraryName?: string;
};

export type TurnContextPaper = PaperContextRef & {
  roles: string[];
};

export type TurnContextEnvelope = {
  libraryID?: number;
  libraryName?: string;
  conversationKind?: "global" | "paper";
  activeItemId?: number;
  activePaperTitle?: string;
  papers: TurnContextPaper[];
  collections: CollectionContextRef[];
  tags: TagContextRef[];
  selectedTextCount: number;
  selectedTextSources: SelectedTextSource[];
  selectedTextPaperTitles: string[];
  selectedTextNotes: Array<{
    index: number;
    noteId?: number;
    title: string;
    noteKind: NoteContextRef["noteKind"];
    parentItemId?: number;
  }>;
  screenshotCount: number;
  attachments: ChatAttachment[];
  activeNote?: Pick<
    ActiveNoteContext,
    "noteId" | "noteKind" | "parentItemId" | "title"
  >;
};

function normalizeText(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

function paperKey(paper: PaperContextRef): string {
  const contextItemId = normalizeNumber(paper.contextItemId);
  if (contextItemId) return `context:${contextItemId}`;
  const itemId = normalizeNumber(paper.itemId);
  if (itemId) return `item:${itemId}`;
  return `title:${normalizeText(paper.title).toLowerCase()}`;
}

function mergePaperFields(
  existing: TurnContextPaper,
  next: PaperContextRef,
): TurnContextPaper {
  return {
    ...existing,
    itemId: existing.itemId || next.itemId,
    contextItemId: existing.contextItemId || next.contextItemId,
    title: existing.title || next.title,
    attachmentTitle: existing.attachmentTitle || next.attachmentTitle,
    citationKey: existing.citationKey || next.citationKey,
    firstCreator: existing.firstCreator || next.firstCreator,
    year: existing.year || next.year,
    contentSourceMode: existing.contentSourceMode || next.contentSourceMode,
    mineruCacheDir: existing.mineruCacheDir || next.mineruCacheDir,
  };
}

function pushPaper(
  papers: TurnContextPaper[],
  indexByKey: Map<string, number>,
  paper: PaperContextRef | undefined,
  role: string,
): void {
  if (!paper) return;
  const key = paperKey(paper);
  if (!key || key === "title:") return;
  const existingIndex = indexByKey.get(key);
  if (existingIndex !== undefined) {
    const existing = papers[existingIndex];
    papers[existingIndex] = {
      ...mergePaperFields(existing, paper),
      roles: existing.roles.includes(role)
        ? existing.roles
        : [...existing.roles, role],
    };
    return;
  }
  indexByKey.set(key, papers.length);
  papers.push({ ...paper, roles: [role] });
}

function normalizeCollections(
  collections: CollectionContextRef[] | undefined,
): CollectionContextRef[] {
  const seen = new Set<string>();
  const out: CollectionContextRef[] = [];
  for (const collection of collections || []) {
    const collectionId = normalizeNumber(collection.collectionId);
    const libraryID = normalizeNumber(collection.libraryID);
    if (!collectionId || !libraryID) continue;
    const key = `${libraryID}:${collectionId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...collection, collectionId, libraryID });
  }
  return out;
}

function normalizeTags(tags: TagContextRef[] | undefined): TagContextRef[] {
  const seen = new Set<string>();
  const out: TagContextRef[] = [];
  for (const tag of tags || []) {
    const libraryID = normalizeNumber(tag.libraryID);
    if (!libraryID) continue;
    const name = normalizeText(tag.name);
    const normalizedName = normalizeText(tag.normalizedName);
    const key = [
      libraryID,
      tag.scope || "",
      normalizedName || name.toLowerCase(),
      tag.includeAutomatic === true ? "auto" : "manual",
    ].join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ...tag,
      name,
      normalizedName: normalizedName || undefined,
      libraryID,
    });
  }
  return out;
}

export function buildTurnContextEnvelope(
  input: TurnContextEnvelopeInput,
): TurnContextEnvelope {
  const papers: TurnContextPaper[] = [];
  const indexByKey = new Map<string, number>();
  pushPaper(papers, indexByKey, input.activePaperContext, "active paper");
  for (const paper of input.selectedPaperContexts || []) {
    pushPaper(papers, indexByKey, paper, "selected");
  }
  for (const paper of input.fullTextPaperContexts || []) {
    pushPaper(papers, indexByKey, paper, "full-text");
  }
  for (const paper of input.pinnedPaperContexts || []) {
    pushPaper(papers, indexByKey, paper, "pinned");
  }

  const selectedTexts = Array.isArray(input.selectedTexts)
    ? input.selectedTexts
    : [];
  const selectedTextSources = selectedTexts.map(
    (_, index) => input.selectedTextSources?.[index] || "pdf",
  );
  const selectedTextPaperTitles = (input.selectedTextPaperContexts || [])
    .map((paper) => normalizeText(paper?.title))
    .filter(Boolean);
  const selectedTextNotes: TurnContextEnvelope["selectedTextNotes"] = [];
  (input.selectedTextNoteContexts || []).forEach((note, index) => {
    if (!note) return;
    const title = normalizeText(note.title);
    const noteId = normalizeNumber(note.noteItemId);
    const parentItemId = normalizeNumber(note.parentItemId);
    selectedTextNotes.push({
      index: index + 1,
      ...(noteId ? { noteId } : {}),
      title: title || (noteId ? `Note ${noteId}` : "Zotero note"),
      noteKind: note.noteKind,
      ...(parentItemId ? { parentItemId } : {}),
    });
  });
  const activeNote = input.activeNoteContext
    ? {
        noteId: input.activeNoteContext.noteId,
        title: input.activeNoteContext.title,
        noteKind: input.activeNoteContext.noteKind,
        parentItemId: input.activeNoteContext.parentItemId,
      }
    : undefined;

  return {
    libraryID: normalizeNumber(input.libraryID),
    libraryName: normalizeText(input.libraryName) || undefined,
    conversationKind: input.conversationKind,
    activeItemId: normalizeNumber(input.activeItemId),
    activePaperTitle: normalizeText(input.activePaperTitle) || undefined,
    papers,
    collections: normalizeCollections(input.selectedCollectionContexts),
    tags: normalizeTags(input.selectedTagContexts),
    selectedTextCount: selectedTexts.length,
    selectedTextSources,
    selectedTextPaperTitles,
    selectedTextNotes,
    screenshotCount: (input.screenshots || []).filter(Boolean).length,
    attachments: (input.attachments || []).filter(Boolean),
    activeNote,
  };
}

function renderField(label: string, value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  return typeof value === "string"
    ? `${label}="${value}"`
    : `${label}=${String(value)}`;
}

function renderFields(fields: Array<[string, unknown]>): string {
  return fields
    .map(([label, value]) => renderField(label, value))
    .filter(Boolean)
    .join(", ");
}

export function renderTurnContextEnvelopeForModel(
  envelope: TurnContextEnvelope,
): string {
  const lines: string[] = [];
  const libraryFields = renderFields([
    ["libraryID", envelope.libraryID],
    ["name", envelope.libraryName],
    ["scope", envelope.conversationKind],
    ["activeItemId", envelope.activeItemId],
    ["activePaperTitle", envelope.activePaperTitle],
  ]);
  if (libraryFields) lines.push(`Library scope: ${libraryFields}`);

  envelope.papers.forEach((paper, index) => {
    lines.push(
      `Paper ${index + 1}: ${renderFields([
        ["title", paper.title],
        ["creator", paper.firstCreator],
        ["year", paper.year],
        ["itemId", paper.itemId],
        ["contextItemId", paper.contextItemId],
        ["citationKey", paper.citationKey],
        ["source", paper.roles.join(", ")],
        ["attachmentTitle", paper.attachmentTitle],
        ["contentSourceMode", paper.contentSourceMode],
      ])}`,
    );
  });

  envelope.collections.forEach((collection, index) => {
    lines.push(
      `Collection ${index + 1}: ${renderFields([
        ["name", collection.name],
        ["collectionId", collection.collectionId],
        ["libraryID", collection.libraryID],
        ["source", "selected resource pool"],
      ])}`,
    );
  });

  envelope.tags.forEach((tag, index) => {
    lines.push(
      `Tag ${index + 1}: ${renderFields([
        ["name", tag.name],
        ["normalizedName", tag.normalizedName],
        ["scope", tag.scope],
        ["libraryID", tag.libraryID],
        ["includeAutomatic", tag.includeAutomatic === true ? true : undefined],
        ["source", "selected resource pool"],
      ])}`,
    );
  });

  if (envelope.selectedTextCount) {
    lines.push(
      `Selected text: count=${envelope.selectedTextCount}, sources=${envelope.selectedTextSources.join(", ")}`,
    );
    if (envelope.selectedTextPaperTitles.length) {
      lines.push(
        `Selected text papers: ${envelope.selectedTextPaperTitles.join("; ")}`,
      );
    }
    if (envelope.selectedTextNotes.length) {
      lines.push(
        `Selected text notes: ${envelope.selectedTextNotes
          .map((note) =>
            renderFields([
              ["index", note.index],
              ["title", note.title],
              ["noteId", note.noteId],
              ["noteKind", note.noteKind],
              ["parentItemId", note.parentItemId],
            ]),
          )
          .join(" | ")}`,
      );
    }
  }

  if (envelope.attachments.length) {
    lines.push(
      `Attachments: ${envelope.attachments
        .map(
          (attachment, index) =>
            `${index + 1}. ${renderFields([
              ["name", attachment.name],
              ["category", attachment.category],
              ["mimeType", attachment.mimeType],
              ["sizeBytes", attachment.sizeBytes],
            ])}`,
        )
        .join(" | ")}`,
    );
  }

  if (envelope.screenshotCount) {
    lines.push(`Screenshots: count=${envelope.screenshotCount}`);
  }

  if (envelope.activeNote) {
    lines.push(
      `Active note: ${renderFields([
        ["title", envelope.activeNote.title],
        ["noteId", envelope.activeNote.noteId],
        ["noteKind", envelope.activeNote.noteKind],
        ["parentItemId", envelope.activeNote.parentItemId],
      ])}`,
    );
  }

  if (!lines.length) return "";
  return [
    "Zotero context for this turn:",
    ...lines,
    'Resolve references like "these papers", "both papers", "this collection", "this tag", "the selected library", and ordinal phrases like "the second paper" from the context listed above. Do not infer missing resource identity from old thread history or local memory when the current turn lists resources.',
  ].join("\n");
}

export function buildVisibleTurnContextBlock(
  input: TurnContextEnvelopeInput,
): string {
  return renderTurnContextEnvelopeForModel(buildTurnContextEnvelope(input));
}
