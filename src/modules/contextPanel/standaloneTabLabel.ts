import { resolveNoteEditingTitle } from "./noteEditing";

export type StandalonePaperTabLabel =
  | "Item note"
  | "Paper chat"
  | "Standalone note"
  | "Web chat";

export function resolveStandalonePaperTabLabel(options?: {
  paperSlotItem?: Zotero.Item | null;
  isWebChat?: boolean;
}): StandalonePaperTabLabel {
  if (options?.isWebChat) return "Web chat";
  const item = options?.paperSlotItem as any;
  if (!item?.isNote?.()) return "Paper chat";
  const parentID = Number(item.parentID || 0);
  return Number.isFinite(parentID) && parentID > 0
    ? "Item note"
    : "Standalone note";
}

export function resolveStandaloneNoteWindowTitle(
  item: Zotero.Item | null | undefined,
): string | null {
  if (!(item as any)?.isNote?.()) return null;
  const parentID = Number((item as any)?.parentID || 0);
  const noteKind =
    Number.isFinite(parentID) && parentID > 0 ? "item" : "standalone";
  const title = resolveNoteEditingTitle(item) || "Untitled Note";
  return `${noteKind === "item" ? "Item note" : "Standalone note"}: ${title}`;
}
