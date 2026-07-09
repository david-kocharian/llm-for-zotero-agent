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
