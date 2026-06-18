import {
  type ActionRequestContext,
  resolvePaperScopedCommandInput,
  type PaperScopedActionCollectionCandidate,
  type PaperScopedActionProfile,
  type PaperScopedActionTagCandidate,
} from "../../../../agent/actions";

export type ActionChatMode = "paper" | "library";
export type InlineActionCommand = {
  actionName: string;
  params: string;
};

const PAGED_LIBRARY_ACTION_NAMES = new Set([
  "audit_library",
  "organize_unfiled",
  "auto_tag",
]);
const DEFAULT_PAGED_ACTION_PAGE_SIZE = 20;
const PAGED_COLLECTION_SCOPE_PROFILE: PaperScopedActionProfile = {
  targetMode: "multi",
  allowedScopes: ["collection"],
  defaultEmptyInput: "prompt",
  paperRequirement: "bibliographic",
  supportsLimit: false,
};

type PagedActionCollectionClause = {
  query: string;
};

type ScopedActionIntentCandidate = {
  name: string;
  inputSchema: object;
  paperScopeProfile?: PaperScopedActionProfile;
};

export type ActionIntentResolution =
  | {
      kind: "action";
      actionName: string;
      input: Record<string, unknown>;
      userQuery: string;
    }
  | { kind: "none" }
  | { kind: "error"; actionName?: string; error: string };

export function isPagedLibraryActionForMode(
  actionName: string,
  mode: ActionChatMode,
): boolean {
  return mode === "library" && PAGED_LIBRARY_ACTION_NAMES.has(actionName);
}

export function parseInlineActionCommand(
  text: string,
): InlineActionCommand | null {
  const match = /^\/([A-Za-z][A-Za-z0-9_-]*)(?:\s+([\s\S]*))?$/.exec(
    text.trim(),
  );
  if (!match) return null;
  return {
    actionName: match[1],
    params: match[2]?.trim() || "",
  };
}

export function shouldExecuteAgentActionImmediatelyFromSlash(
  actionName: string,
  mode: ActionChatMode,
  hasPaperScopeProfile: boolean,
): boolean {
  return (
    isPagedLibraryActionForMode(actionName, mode) ||
    (mode === "paper" && hasPaperScopeProfile)
  );
}

export function parseCommandParams(
  actionName: string,
  params: string,
  mode: ActionChatMode,
): Record<string, unknown> {
  const isPagedLibraryAction = isPagedLibraryActionForMode(actionName, mode);
  const input: Record<string, unknown> = isPagedLibraryAction
    ? {
        scope: "all",
        pageSize: DEFAULT_PAGED_ACTION_PAGE_SIZE,
      }
    : {};
  if (params.trim()) {
    input.userQuery = params.trim();
  }
  if (!params) return input;
  const lower = params.toLowerCase();
  const pageSizeMatch = /(?:page\s*size|per\s*page|show)\s+(\d+)/i.exec(params);
  if (pageSizeMatch && isPagedLibraryAction) {
    input.pageSize = parseInt(pageSizeMatch[1], 10);
    return input;
  }
  const firstNMatch =
    /(?:for\s+)?(?:first|top)\s+(\d+)\s*(?:items?|papers?)?/i.exec(params);
  if (firstNMatch) {
    input.limit = parseInt(firstNMatch[1], 10);
    return input;
  }
  const limitMatch = /(?:limit|cap)\s+(\d+)/i.exec(params);
  if (limitMatch) {
    input.limit = parseInt(limitMatch[1], 10);
    return input;
  }
  const lastNMatch = /(?:for\s+)?last\s+(\d+)\s*(?:items?|papers?)?/i.exec(
    params,
  );
  if (lastNMatch) {
    input.limit = parseInt(lastNMatch[1], 10);
    return input;
  }
  if (extractPagedActionCollectionQuery(params)) return input;
  if (
    lower.includes("whole library") ||
    lower.includes("for all") ||
    lower === "all"
  ) {
    input.scope = "all";
    return input;
  }
  const bareNumber = /^(\d+)$/.exec(params.trim());
  if (bareNumber) {
    input.limit = parseInt(bareNumber[1], 10);
  }
  return input;
}

export function extractPagedActionCollectionQuery(
  params: string,
): string | null {
  return matchPagedActionCollectionClause(params)?.query || null;
}

function matchPagedActionCollectionClause(
  params: string,
): PagedActionCollectionClause | null {
  const match = /^(?:for\s+)?collection(?:\s+(.+))?$/i.exec(params.trim());
  if (!match) return null;
  return { query: match[1]?.trim() || "" };
}

export function mapPagedCollectionScopeInput(
  actionName: string,
  collectionId: number,
): Record<string, unknown> | null {
  if (!Number.isFinite(collectionId) || collectionId <= 0) return null;
  const normalizedCollectionId = Math.floor(collectionId);
  if (actionName === "auto_tag") {
    return {
      scope: "collection",
      collectionIds: [normalizedCollectionId],
    };
  }
  if (actionName === "audit_library") {
    return {
      scope: "collection",
      collectionId: normalizedCollectionId,
    };
  }
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function actionSchemaProperties(
  action: Pick<ScopedActionIntentCandidate, "inputSchema">,
): Record<string, unknown> {
  const schema = action.inputSchema;
  if (!isPlainObject(schema) || !isPlainObject(schema.properties)) return {};
  return schema.properties;
}

function actionSchemaScopeEnum(
  action: Pick<ScopedActionIntentCandidate, "inputSchema">,
): string[] {
  const scope = actionSchemaProperties(action).scope;
  if (!isPlainObject(scope) || !Array.isArray(scope.enum)) return [];
  return scope.enum.filter(
    (entry): entry is string => typeof entry === "string",
  );
}

function actionSupportsCollectionScope(
  action: ScopedActionIntentCandidate,
): boolean {
  if (action.paperScopeProfile?.allowedScopes.includes("collection")) {
    return true;
  }
  const properties = actionSchemaProperties(action);
  return (
    Boolean(properties.collectionId) &&
    actionSchemaScopeEnum(action).includes("collection")
  );
}

function actionSupportsTagScope(action: ScopedActionIntentCandidate): boolean {
  return Boolean(action.paperScopeProfile?.allowedScopes.includes("tag"));
}

function mapCollectionScopeInput(
  action: ScopedActionIntentCandidate,
  collectionId: number,
): Record<string, unknown> | null {
  if (!Number.isFinite(collectionId) || collectionId <= 0) return null;
  const normalizedCollectionId = Math.floor(collectionId);
  if (action.paperScopeProfile?.allowedScopes.includes("collection")) {
    return {
      scope: "collection",
      collectionIds: [normalizedCollectionId],
    };
  }
  if (actionSupportsCollectionScope(action)) {
    return {
      scope: "collection",
      collectionId: normalizedCollectionId,
    };
  }
  return null;
}

function normalizeNaturalActionText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^\p{L}\p{N}/\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isExplanatoryActionQuestion(text: string): boolean {
  const normalized = normalizeNaturalActionText(text);
  return (
    /^(what|how|why)\s+(is|are|does|do|can|should|would)\b/u.test(normalized) ||
    /^(explain|describe|tell me about)\b/u.test(normalized)
  );
}

function actionAliases(actionName: string): string[] {
  const spaced = actionName.replace(/[_-]+/g, " ");
  const aliases = new Set<string>([actionName, spaced]);
  if (actionName === "auto_tag") {
    aliases.add("auto tag");
    aliases.add("autotag");
  }
  if (actionName === "audit_library") {
    aliases.add("audit library");
    aliases.add("audit");
  }
  return Array.from(aliases)
    .map((entry) => normalizeNaturalActionText(entry))
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
}

function stripIntentPrefix(text: string): string {
  return text
    .trim()
    .replace(
      /^(?:please\s+)?(?:(?:can|could|would)\s+you\s+)?(?:(?:run|start|launch|use|do|perform|execute)\s+)?/i,
      "",
    )
    .trim();
}

function stripLeadingScopePreposition(text: string): string {
  return text
    .trim()
    .replace(/^(?:on|in|for|from|within)\s+/i, "")
    .trim();
}

function findSlashActionIntent(
  text: string,
  actionByName: Map<string, ScopedActionIntentCandidate>,
): {
  action: ScopedActionIntentCandidate;
  params: string;
  explicitSlash: true;
} | null {
  const match = /\/([A-Za-z][A-Za-z0-9_-]*)(?:\s+([\s\S]*))?/u.exec(text);
  if (!match) return null;
  const action = actionByName.get(match[1]);
  if (!action) return null;
  return {
    action,
    params: match[2]?.trim() || "",
    explicitSlash: true,
  };
}

function findNamedActionIntent(
  text: string,
  actions: ScopedActionIntentCandidate[],
): {
  action: ScopedActionIntentCandidate;
  params: string;
  explicitSlash: false;
} | null {
  const stripped = stripIntentPrefix(text);
  const normalized = normalizeNaturalActionText(stripped);
  if (!normalized) return null;
  for (const action of actions) {
    for (const alias of actionAliases(action.name)) {
      if (normalized === alias) {
        return { action, params: "", explicitSlash: false };
      }
      if (normalized.startsWith(`${alias} `)) {
        const rawParams = stripped.slice(alias.length).trim();
        return {
          action,
          params: stripLeadingScopePreposition(rawParams),
          explicitSlash: false,
        };
      }
    }
  }
  return null;
}

function selectedCollectionIds(
  requestContext: ActionRequestContext | undefined,
): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const entry of requestContext?.selectedCollectionContexts || []) {
    const id = Number(entry.collectionId);
    if (!Number.isFinite(id) || id <= 0) continue;
    const normalized = Math.floor(id);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function selectedTagScopeInput(
  requestContext: ActionRequestContext | undefined,
): Record<string, unknown> | null {
  const tagNames: string[] = [];
  const tagScopes: Array<"allTagged" | "untagged"> = [];
  let includeAutomaticTags = false;
  for (const entry of requestContext?.selectedTagContexts || []) {
    if (entry.scope === "allTagged" || entry.scope === "untagged") {
      if (!tagScopes.includes(entry.scope)) tagScopes.push(entry.scope);
    } else if (entry.name?.trim()) {
      tagNames.push(entry.name.trim());
    }
    if (entry.includeAutomatic === true) includeAutomaticTags = true;
  }
  if (!tagNames.length && !tagScopes.length) return null;
  return {
    scope: "tag",
    ...(tagNames.length ? { tagNames } : {}),
    ...(tagScopes.length ? { tagScopes } : {}),
    ...(includeAutomaticTags ? { includeAutomaticTags: true } : {}),
  };
}

function mapSelectedCollectionScopeInput(
  action: ScopedActionIntentCandidate,
  requestContext: ActionRequestContext | undefined,
): ActionIntentResolution {
  const collectionIds = selectedCollectionIds(requestContext);
  if (!collectionIds.length) {
    return {
      kind: "error",
      actionName: action.name,
      error: `No selected collection scope is available for ${action.name}.`,
    };
  }
  if (action.paperScopeProfile?.allowedScopes.includes("collection")) {
    return {
      kind: "action",
      actionName: action.name,
      input: { scope: "collection", collectionIds },
      userQuery: "",
    };
  }
  if (actionSupportsCollectionScope(action)) {
    if (collectionIds.length > 1) {
      return {
        kind: "error",
        actionName: action.name,
        error: `${action.name} supports one selected collection at a time.`,
      };
    }
    return {
      kind: "action",
      actionName: action.name,
      input: { scope: "collection", collectionId: collectionIds[0] },
      userQuery: "",
    };
  }
  return {
    kind: "error",
    actionName: action.name,
    error: `${action.name} does not support collection scope.`,
  };
}

function mapSelectedTagScopeInput(
  action: ScopedActionIntentCandidate,
  requestContext: ActionRequestContext | undefined,
): ActionIntentResolution {
  if (!actionSupportsTagScope(action)) {
    return {
      kind: "error",
      actionName: action.name,
      error: `${action.name} does not support tag scope.`,
    };
  }
  const input = selectedTagScopeInput(requestContext);
  if (!input) {
    return {
      kind: "error",
      actionName: action.name,
      error: `No selected tag scope is available for ${action.name}.`,
    };
  }
  return { kind: "action", actionName: action.name, input, userQuery: "" };
}

function hasSelectedScopeContext(
  requestContext: ActionRequestContext | undefined,
): boolean {
  return Boolean(
    requestContext?.selectedCollectionContexts?.length ||
    requestContext?.selectedTagContexts?.length,
  );
}

type ScopePhrase =
  | { kind: "none" }
  | { kind: "selected"; scope: "collection" | "tag" | "selection" }
  | { kind: "collection"; query: string }
  | { kind: "tag"; query: string }
  | { kind: "all" };

function extractScopePhrase(params: string): ScopePhrase {
  const trimmed = stripLeadingScopePreposition(params);
  if (!trimmed) return { kind: "none" };
  const normalized = normalizeNaturalActionText(trimmed);
  if (
    normalized === "all" ||
    normalized === "all library" ||
    normalized === "all papers" ||
    normalized === "all items" ||
    normalized === "whole library" ||
    normalized === "entire library"
  ) {
    return { kind: "all" };
  }
  if (normalized === "collection" || normalized === "folder") {
    return { kind: "collection", query: "" };
  }
  if (normalized === "tag") {
    return { kind: "tag", query: "" };
  }
  if (
    /^(?:this|current|selected)(?:\s+(?:this|current|selected))*\s+(?:folder|collection)s?$/u.test(
      normalized,
    )
  ) {
    return { kind: "selected", scope: "collection" };
  }
  if (
    /^(?:this|current|selected)(?:\s+(?:this|current|selected))*\s+tags?$/u.test(
      normalized,
    )
  ) {
    return { kind: "selected", scope: "tag" };
  }
  if (
    normalized === "selection" ||
    normalized === "selected context" ||
    normalized === "selected scope"
  ) {
    return { kind: "selected", scope: "selection" };
  }
  if (
    /\b(?:collection|folder)\s+(?:about|related\s+to|containing|for)\s+/iu.test(
      trimmed,
    )
  ) {
    return { kind: "none" };
  }
  const collectionMatch =
    /(?:^|\b(?:for|in|on|within|from)\s+)(?:collection|folder)\s+([\s\S]+)$/i.exec(
      trimmed,
    );
  if (collectionMatch?.[1]?.trim()) {
    return { kind: "collection", query: collectionMatch[1].trim() };
  }
  const tagMatch = /(?:^|\b(?:for|in|on|within|from)\s+)tag\s+([\s\S]+)$/i.exec(
    trimmed,
  );
  if (tagMatch?.[1]?.trim()) {
    return { kind: "tag", query: tagMatch[1].trim() };
  }
  return { kind: "none" };
}

function hasCandidateScopeTokenOverlap(params: {
  text: string;
  collectionCandidates: PaperScopedActionCollectionCandidate[];
  tagCandidates: PaperScopedActionTagCandidate[];
}): boolean {
  const ignoredTokens = new Set([
    "about",
    "action",
    "audit",
    "auto",
    "collection",
    "current",
    "folder",
    "library",
    "papers",
    "please",
    "scope",
    "selected",
    "tag",
    "this",
  ]);
  const tokens = new Set(
    normalizeNaturalActionText(params.text)
      .split(/\s+/)
      .filter((token) => token.length > 2 && !ignoredTokens.has(token)),
  );
  if (!tokens.size) return false;
  const candidateTokenMatch = (value: string | undefined): boolean =>
    normalizeNaturalActionText(value || "")
      .split(/\s+/)
      .some((token) => token.length > 2 && tokens.has(token));
  return (
    params.collectionCandidates.some(
      (entry) =>
        candidateTokenMatch(entry.name) || candidateTokenMatch(entry.path),
    ) || params.tagCandidates.some((entry) => candidateTokenMatch(entry.name))
  );
}

function shouldDeferExplicitSlashParamsToSemanticResolver(params: {
  text: string;
  collectionCandidates: PaperScopedActionCollectionCandidate[];
  tagCandidates: PaperScopedActionTagCandidate[];
}): boolean {
  const normalized = normalizeNaturalActionText(params.text);
  if (!normalized) return false;
  if (
    /^(?:\d+|page\s*size|per\s*page|show|first|top|limit|cap|last)\b/u.test(
      normalized,
    )
  ) {
    return false;
  }
  if (
    normalized === "all" ||
    normalized === "all library" ||
    normalized === "all papers" ||
    normalized === "all items" ||
    normalized === "whole library" ||
    normalized === "entire library"
  ) {
    return false;
  }
  if (
    /\b(?:about|collection|current|folder|scope|selected|selection|tag)\b/u.test(
      normalized,
    )
  ) {
    return true;
  }
  return hasCandidateScopeTokenOverlap(params);
}

function resolveNamedCollectionScope(params: {
  action: ScopedActionIntentCandidate;
  query: string;
  collectionCandidates: PaperScopedActionCollectionCandidate[];
}): ActionIntentResolution {
  if (!params.query.trim()) {
    return {
      kind: "error",
      actionName: params.action.name,
      error: 'No collection name provided. Use "collection <name>".',
    };
  }
  const profile = params.action.paperScopeProfile?.allowedScopes.includes(
    "collection",
  )
    ? params.action.paperScopeProfile
    : PAGED_COLLECTION_SCOPE_PROFILE;
  const resolved = resolvePaperScopedCommandInput(
    `collection ${params.query}`,
    undefined,
    profile,
    params.collectionCandidates,
    [],
  );
  if (resolved.kind === "error") {
    return {
      kind: "error",
      actionName: params.action.name,
      error: resolved.error,
    };
  }
  if (resolved.kind !== "input") {
    return {
      kind: "error",
      actionName: params.action.name,
      error: `Could not resolve collection "${params.query}".`,
    };
  }
  const collectionId =
    resolved.input.collectionIds?.[0] ?? resolved.input.collectionId;
  const input = mapCollectionScopeInput(params.action, Number(collectionId));
  if (!input) {
    return {
      kind: "error",
      actionName: params.action.name,
      error: `${params.action.name} does not support collection scope.`,
    };
  }
  return {
    kind: "action",
    actionName: params.action.name,
    input,
    userQuery: "",
  };
}

function resolveNamedTagScope(params: {
  action: ScopedActionIntentCandidate;
  query: string;
  requestContext: ActionRequestContext | undefined;
  collectionCandidates: PaperScopedActionCollectionCandidate[];
  tagCandidates: PaperScopedActionTagCandidate[];
}): ActionIntentResolution {
  if (!params.query.trim()) {
    return {
      kind: "error",
      actionName: params.action.name,
      error: 'No tag name provided. Use "tag <name>".',
    };
  }
  const profile = params.action.paperScopeProfile;
  if (!profile?.allowedScopes.includes("tag")) {
    return {
      kind: "error",
      actionName: params.action.name,
      error: `${params.action.name} does not support tag scope.`,
    };
  }
  const resolved = resolvePaperScopedCommandInput(
    `tag ${params.query}`,
    params.requestContext,
    profile,
    params.collectionCandidates,
    params.tagCandidates,
  );
  if (resolved.kind === "error") {
    return {
      kind: "error",
      actionName: params.action.name,
      error: resolved.error,
    };
  }
  if (resolved.kind !== "input") {
    return {
      kind: "error",
      actionName: params.action.name,
      error: `Could not resolve tag "${params.query}".`,
    };
  }
  return {
    kind: "action",
    actionName: params.action.name,
    input: resolved.input as Record<string, unknown>,
    userQuery: "",
  };
}

function mergeActionInput(
  baseInput: Record<string, unknown>,
  scopeInput: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...baseInput, ...scopeInput };
  const hasExplicitTargets = Boolean(
    scopeInput.itemIds ||
    scopeInput.collectionIds ||
    scopeInput.tagNames ||
    scopeInput.tagScopes,
  );
  if (
    hasExplicitTargets &&
    scopeInput.scope === undefined &&
    merged.scope === "all"
  ) {
    delete merged.scope;
  }
  return merged;
}

export function resolveNaturalLanguageActionIntent(params: {
  text: string;
  mode: ActionChatMode;
  actions: ScopedActionIntentCandidate[];
  requestContext?: ActionRequestContext;
  collectionCandidates: PaperScopedActionCollectionCandidate[];
  tagCandidates?: PaperScopedActionTagCandidate[];
}): ActionIntentResolution {
  const rawText = params.text.trim();
  if (!rawText || params.mode !== "library") return { kind: "none" };
  if (isExplanatoryActionQuestion(rawText)) return { kind: "none" };

  const actionByName = new Map(
    params.actions.map((action) => [action.name, action]),
  );
  const intent =
    findSlashActionIntent(rawText, actionByName) ||
    findNamedActionIntent(rawText, params.actions);
  if (!intent) return { kind: "none" };

  const action = intent.action;
  const scopePhrase = extractScopePhrase(intent.params);
  const hasScope =
    scopePhrase.kind !== "none" ||
    hasSelectedScopeContext(params.requestContext);
  if (!intent.explicitSlash && !hasScope) return { kind: "none" };

  const baseInput = parseCommandParams(action.name, intent.params, params.mode);
  let scoped: ActionIntentResolution = { kind: "none" };
  if (scopePhrase.kind === "collection") {
    scoped = resolveNamedCollectionScope({
      action,
      query: scopePhrase.query,
      collectionCandidates: params.collectionCandidates,
    });
  } else if (scopePhrase.kind === "tag") {
    scoped = resolveNamedTagScope({
      action,
      query: scopePhrase.query,
      requestContext: params.requestContext,
      collectionCandidates: params.collectionCandidates,
      tagCandidates: params.tagCandidates || [],
    });
  } else if (scopePhrase.kind === "selected") {
    if (scopePhrase.scope === "tag") {
      scoped = mapSelectedTagScopeInput(action, params.requestContext);
    } else if (scopePhrase.scope === "collection") {
      scoped = mapSelectedCollectionScopeInput(action, params.requestContext);
    } else if (action.paperScopeProfile) {
      const resolved = resolvePaperScopedCommandInput(
        "selection",
        params.requestContext,
        action.paperScopeProfile,
        params.collectionCandidates,
        params.tagCandidates || [],
      );
      scoped =
        resolved.kind === "input"
          ? {
              kind: "action",
              actionName: action.name,
              input: resolved.input as Record<string, unknown>,
              userQuery: "",
            }
          : resolved.kind === "error"
            ? { kind: "error", actionName: action.name, error: resolved.error }
            : mapSelectedCollectionScopeInput(action, params.requestContext);
    } else {
      scoped = mapSelectedCollectionScopeInput(action, params.requestContext);
    }
  } else if (scopePhrase.kind === "all") {
    scoped = {
      kind: "action",
      actionName: action.name,
      input: { scope: "all" },
      userQuery: "",
    };
  } else if (hasSelectedScopeContext(params.requestContext)) {
    if (action.paperScopeProfile) {
      const resolved = resolvePaperScopedCommandInput(
        "selection",
        params.requestContext,
        action.paperScopeProfile,
        params.collectionCandidates,
        params.tagCandidates || [],
      );
      scoped =
        resolved.kind === "input"
          ? {
              kind: "action",
              actionName: action.name,
              input: resolved.input as Record<string, unknown>,
              userQuery: "",
            }
          : resolved.kind === "error"
            ? { kind: "error", actionName: action.name, error: resolved.error }
            : mapSelectedCollectionScopeInput(action, params.requestContext);
    } else {
      scoped = mapSelectedCollectionScopeInput(action, params.requestContext);
    }
  } else if (intent.explicitSlash) {
    if (
      intent.params.trim() &&
      shouldDeferExplicitSlashParamsToSemanticResolver({
        text: intent.params,
        collectionCandidates: params.collectionCandidates,
        tagCandidates: params.tagCandidates || [],
      })
    ) {
      return { kind: "none" };
    }
    scoped = {
      kind: "action",
      actionName: action.name,
      input: {},
      userQuery: "",
    };
  }

  if (scoped.kind === "none") {
    if (scopePhrase.kind !== "none") {
      return {
        kind: "error",
        actionName: action.name,
        error: `${action.name} does not support that scope.`,
      };
    }
    return { kind: "none" };
  }
  if (scoped.kind === "error") return scoped;
  return {
    kind: "action",
    actionName: scoped.actionName,
    input: mergeActionInput(baseInput, scoped.input),
    userQuery: intent.explicitSlash ? intent.params : intent.params || rawText,
  };
}

export type PagedCollectionScopeResolution =
  | { kind: "input"; input: Record<string, unknown> }
  | { kind: "none"; input: Record<string, unknown> }
  | { kind: "error"; error: string };

export function resolvePagedCollectionScopeInput(params: {
  actionName: string;
  rawParams: string;
  baseInput: Record<string, unknown>;
  collectionCandidates: PaperScopedActionCollectionCandidate[];
}): PagedCollectionScopeResolution {
  const collectionClause = matchPagedActionCollectionClause(params.rawParams);
  if (!collectionClause) return { kind: "none", input: params.baseInput };
  const collectionQuery = collectionClause.query;
  if (!collectionQuery) {
    return {
      kind: "error",
      error: 'No collection name provided. Use "collection <name>".',
    };
  }

  if (params.actionName === "organize_unfiled") {
    return {
      kind: "error",
      error:
        "organize_unfiled does not support collection scope; run it without a collection source.",
    };
  }

  const resolved = resolvePaperScopedCommandInput(
    `collection ${collectionQuery}`,
    undefined,
    PAGED_COLLECTION_SCOPE_PROFILE,
    params.collectionCandidates,
    [],
  );
  if (resolved.kind === "error") {
    return resolved;
  }
  if (resolved.kind !== "input") {
    return {
      kind: "error",
      error: `Could not resolve collection "${collectionQuery}".`,
    };
  }
  const collectionId =
    resolved.input.collectionIds?.[0] ?? resolved.input.collectionId;
  const collectionInput = mapPagedCollectionScopeInput(
    params.actionName,
    Number(collectionId),
  );
  if (!collectionInput) {
    return {
      kind: "error",
      error: `${params.actionName} does not support collection scope.`,
    };
  }
  return {
    kind: "input",
    input: {
      ...params.baseInput,
      ...collectionInput,
    },
  };
}
