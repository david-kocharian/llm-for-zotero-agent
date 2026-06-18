/**
 * Cross-cutting model restriction check.
 *
 * Returns true for models that are text-only and cannot process images,
 * PDFs, or any non-text content regardless of which provider tier they
 * belong to.
 */
function getModelNameCandidates(model: string): string[] {
  const normalized = model.trim().toLowerCase();
  if (!normalized) return [];
  const tail = normalized.split("/").pop() || "";
  return tail && tail !== normalized ? [normalized, tail] : [normalized];
}

function isDeepseekModel(candidate: string): boolean {
  return /^deepseek(?:$|[-.])/.test(candidate);
}

function isKnownDeepseekTextOnlyModel(candidate: string): boolean {
  return (
    /^deepseek-(?:chat|reasoner)(?:[.-]|$)/.test(candidate) ||
    /^deepseek-v4-(?:flash|pro)(?:[.-]|$)/.test(candidate)
  );
}

function isExplicitTextOnlyModel(candidate: string): boolean {
  return /text-only|embedding/.test(candidate);
}

export function isTextOnlyModel(model: string): boolean {
  const candidates = getModelNameCandidates(model);
  const deepseekCandidates = candidates.filter(isDeepseekModel);
  if (deepseekCandidates.length) {
    return deepseekCandidates.some(
      (candidate) =>
        isKnownDeepseekTextOnlyModel(candidate) ||
        isExplicitTextOnlyModel(candidate),
    );
  }
  return candidates.some(
    (candidate) =>
      /reasoner/.test(candidate) || isExplicitTextOnlyModel(candidate),
  );
}
