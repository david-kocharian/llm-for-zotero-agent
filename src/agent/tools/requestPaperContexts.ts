import type { AgentRuntimeRequest } from "../types";
import type { PaperContextRef } from "../../shared/types";

export function collectRequestPaperContexts(
  request: AgentRuntimeRequest,
): PaperContextRef[] {
  const out: PaperContextRef[] = [];
  const seen = new Set<string>();
  const push = (entry: PaperContextRef | undefined) => {
    if (
      !entry ||
      !Number.isFinite(entry.itemId) ||
      !Number.isFinite(entry.contextItemId)
    ) {
      return;
    }
    const key = `${entry.itemId}:${entry.contextItemId}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(entry);
  };
  for (const entry of request.selectedTextPaperContexts || []) push(entry);
  for (const entry of request.selectedPaperContexts || []) push(entry);
  for (const entry of request.fullTextPaperContexts || []) push(entry);
  for (const entry of request.pinnedPaperContexts || []) push(entry);
  return out;
}
