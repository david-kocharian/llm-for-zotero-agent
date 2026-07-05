import { AUTO_SCROLL_BOTTOM_THRESHOLD } from "./constants";

type ChatScrollMode = "followBottom" | "manual";

type ChatScrollAnchor = {
  kind: "quote" | "message";
  quoteCitationId?: string;
  citationSyncKey?: string;
  messageRole?: string;
  messageTimestamp?: string;
  viewportOffsetTop: number;
};

export interface ChatScrollSnapshot {
  mode: ChatScrollMode;
  scrollTop: number;
  updatedAt: number;
  anchor?: ChatScrollAnchor;
}

type ScrollGuardRestoreMode = "absolute" | "relative";

const chatScrollSnapshots = new Map<number, ChatScrollSnapshot>();
const pendingChatScrollRestores = new Map<
  number,
  {
    snapshot: ChatScrollSnapshot;
    expiresAt: number;
    appliedBodies: WeakSet<Element>;
  }
>();
const followBottomCatchupRequests = new Map<number, number>();
const FOLLOW_BOTTOM_CATCHUP_GRACE_MS = 1200;
const PENDING_RESTORE_TTL_MS = 3000;

let scrollUpdatesSuspended = false;

export function isScrollUpdateSuspended(): boolean {
  return scrollUpdatesSuspended;
}

function normalizeConversationKey(conversationKey: number): number | null {
  const normalized = Math.floor(Number(conversationKey || 0));
  return Number.isFinite(normalized) && normalized > 0 ? normalized : null;
}

function getMaxScrollTop(chatBox: HTMLDivElement): number {
  return Math.max(0, chatBox.scrollHeight - chatBox.clientHeight);
}

function isChatViewportVisible(chatBox: HTMLDivElement): boolean {
  return chatBox.clientHeight > 0 && chatBox.getClientRects().length > 0;
}

function clampScrollTop(chatBox: HTMLDivElement, scrollTop: number): number {
  return Math.max(0, Math.min(getMaxScrollTop(chatBox), scrollTop));
}

function isNearBottom(chatBox: HTMLDivElement): boolean {
  const distanceFromBottom =
    chatBox.scrollHeight - chatBox.clientHeight - chatBox.scrollTop;
  return distanceFromBottom <= AUTO_SCROLL_BOTTOM_THRESHOLD;
}

function getElementRect(element: Element): DOMRect | null {
  const rect = element.getBoundingClientRect?.();
  if (!rect) return null;
  if (!Number.isFinite(rect.top) || !Number.isFinite(rect.bottom)) {
    return null;
  }
  return rect;
}

function isRectVisibleInViewport(rect: DOMRect, viewport: DOMRect): boolean {
  return rect.bottom > viewport.top && rect.top < viewport.bottom;
}

function datasetValue(element: Element | null, key: string): string {
  const value = (element as HTMLElement | null)?.dataset?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function closestElement(
  element: Element | null,
  selector: string,
): Element | null {
  if (!element || typeof element.closest !== "function") return null;
  try {
    return element.closest(selector);
  } catch (_err) {
    return null;
  }
}

function queryElements(root: Element, selector: string): Element[] {
  try {
    return Array.from(
      root.querySelectorAll(selector) as unknown as ArrayLike<Element>,
    );
  } catch (_err) {
    return [];
  }
}

function getMessageAnchorForElement(element: Element): {
  messageRole?: string;
  messageTimestamp?: string;
} {
  const wrapper = closestElement(element, ".llm-message-wrapper");
  const role = datasetValue(wrapper, "messageRole");
  const timestamp = datasetValue(wrapper, "messageTimestamp");
  return {
    messageRole: role || undefined,
    messageTimestamp: timestamp || undefined,
  };
}

function buildQuoteAnchor(
  element: Element,
  viewport: DOMRect,
): ChatScrollAnchor | null {
  const quoteCard = closestElement(element, ".llm-quote-card") || element;
  const quoteCitationId = datasetValue(quoteCard, "quoteCitationId");
  const citationSyncKey =
    datasetValue(element, "citationSyncKey") ||
    datasetValue(
      closestElement(element, "[data-citation-sync-key]"),
      "citationSyncKey",
    );
  if (!quoteCitationId && !citationSyncKey) return null;
  const rect = getElementRect(quoteCard);
  if (!rect || !isRectVisibleInViewport(rect, viewport)) return null;
  return {
    kind: "quote",
    quoteCitationId: quoteCitationId || undefined,
    citationSyncKey: citationSyncKey || undefined,
    ...getMessageAnchorForElement(quoteCard),
    viewportOffsetTop: rect.top - viewport.top,
  };
}

function buildMessageAnchor(
  element: Element,
  viewport: DOMRect,
): ChatScrollAnchor | null {
  const messageRole = datasetValue(element, "messageRole");
  const messageTimestamp = datasetValue(element, "messageTimestamp");
  if (!messageRole || !messageTimestamp) return null;
  const rect = getElementRect(element);
  if (!rect || !isRectVisibleInViewport(rect, viewport)) return null;
  return {
    kind: "message",
    messageRole,
    messageTimestamp,
    viewportOffsetTop: rect.top - viewport.top,
  };
}

function scoreVisibleAnchor(element: Element, viewport: DOMRect): number {
  const rect = getElementRect(element);
  if (!rect) return Number.POSITIVE_INFINITY;
  if (rect.top <= viewport.top && rect.bottom > viewport.top) {
    return Math.max(0, viewport.top - rect.top) / 1000;
  }
  return Math.abs(rect.top - viewport.top) + 1;
}

function findBestVisibleChatAnchor(
  chatBox: HTMLDivElement,
): ChatScrollAnchor | undefined {
  const viewport = getElementRect(chatBox);
  if (!viewport) return undefined;

  const quoteCandidates = [
    ...queryElements(chatBox, ".llm-quote-card"),
    ...queryElements(chatBox, "[data-citation-sync-key]"),
  ];
  let bestQuote: {
    element: Element;
    anchor: ChatScrollAnchor;
    score: number;
  } | null = null;
  const seenQuoteCandidates = new Set<Element>();
  for (const candidate of quoteCandidates) {
    const quoteCard = closestElement(candidate, ".llm-quote-card") || candidate;
    if (seenQuoteCandidates.has(quoteCard)) continue;
    seenQuoteCandidates.add(quoteCard);
    const anchor = buildQuoteAnchor(candidate, viewport);
    if (!anchor) continue;
    const score = scoreVisibleAnchor(quoteCard, viewport);
    if (!bestQuote || score < bestQuote.score) {
      bestQuote = { element: quoteCard, anchor, score };
    }
  }
  if (bestQuote) return bestQuote.anchor;

  let bestMessage: { anchor: ChatScrollAnchor; score: number } | null = null;
  for (const candidate of queryElements(chatBox, ".llm-message-wrapper")) {
    const anchor = buildMessageAnchor(candidate, viewport);
    if (!anchor) continue;
    const score = scoreVisibleAnchor(candidate, viewport);
    if (!bestMessage || score < bestMessage.score) {
      bestMessage = { anchor, score };
    }
  }
  return bestMessage?.anchor;
}

function findChatAnchorForElement(
  chatBox: HTMLDivElement,
  element: Element | null | undefined,
): ChatScrollAnchor | undefined {
  if (!element) return undefined;
  const viewport = getElementRect(chatBox);
  if (!viewport) return undefined;
  const quoteAnchor = buildQuoteAnchor(element, viewport);
  if (quoteAnchor) return quoteAnchor;
  const messageElement = closestElement(element, ".llm-message-wrapper");
  if (messageElement) {
    const messageAnchor = buildMessageAnchor(messageElement, viewport);
    if (messageAnchor) return messageAnchor;
  }
  return undefined;
}

function findMessageWrapperForAnchor(
  chatBox: HTMLDivElement,
  anchor: ChatScrollAnchor,
): Element | null {
  if (!anchor.messageRole || !anchor.messageTimestamp) return null;
  return (
    queryElements(chatBox, ".llm-message-wrapper").find(
      (element) =>
        datasetValue(element, "messageRole") === anchor.messageRole &&
        datasetValue(element, "messageTimestamp") === anchor.messageTimestamp,
    ) || null
  );
}

function findQuoteElementForAnchor(
  chatBox: HTMLDivElement,
  anchor: ChatScrollAnchor,
): Element | null {
  const messageScope = findMessageWrapperForAnchor(chatBox, anchor);
  const roots = messageScope ? [messageScope] : [chatBox];
  if (anchor.quoteCitationId) {
    for (const root of roots) {
      const match = queryElements(root, ".llm-quote-card").find(
        (element) =>
          datasetValue(element, "quoteCitationId") === anchor.quoteCitationId,
      );
      if (match) return match;
    }
  }
  if (anchor.citationSyncKey) {
    for (const root of roots) {
      const match = queryElements(root, "[data-citation-sync-key]").find(
        (element) =>
          datasetValue(element, "citationSyncKey") === anchor.citationSyncKey,
      );
      if (match) return closestElement(match, ".llm-quote-card") || match;
    }
  }
  return null;
}

function findElementForAnchor(
  chatBox: HTMLDivElement,
  anchor: ChatScrollAnchor,
): Element | null {
  if (anchor.kind === "quote") {
    return findQuoteElementForAnchor(chatBox, anchor);
  }
  return findMessageWrapperForAnchor(chatBox, anchor);
}

function restoreChatScrollAnchor(
  chatBox: HTMLDivElement,
  anchor: ChatScrollAnchor | undefined,
): boolean {
  if (!anchor) return false;
  const target = findElementForAnchor(chatBox, anchor);
  if (!target) return false;
  const viewport = getElementRect(chatBox);
  const targetRect = getElementRect(target);
  if (!viewport || !targetRect) return false;
  const currentOffset = targetRect.top - viewport.top;
  const delta = currentOffset - anchor.viewportOffsetTop;
  chatBox.scrollTop = clampScrollTop(chatBox, chatBox.scrollTop + delta);
  return true;
}

export function buildChatScrollSnapshot(
  chatBox: HTMLDivElement,
  preferredAnchorElement?: Element | null,
): ChatScrollSnapshot {
  const mode: ChatScrollMode = preferredAnchorElement
    ? "manual"
    : isNearBottom(chatBox)
      ? "followBottom"
      : "manual";
  const anchor =
    mode === "manual"
      ? findChatAnchorForElement(chatBox, preferredAnchorElement) ||
        findBestVisibleChatAnchor(chatBox)
      : undefined;
  return {
    mode,
    scrollTop: clampScrollTop(chatBox, chatBox.scrollTop),
    updatedAt: Date.now(),
    anchor,
  };
}

export function buildFollowBottomScrollSnapshot(
  chatBox: HTMLDivElement,
): ChatScrollSnapshot {
  return {
    mode: "followBottom",
    scrollTop: clampScrollTop(chatBox, chatBox.scrollHeight),
    updatedAt: Date.now(),
  };
}

export function hasActiveFollowBottomCatchupRequest(
  conversationKey: number,
): boolean {
  const normalized = normalizeConversationKey(conversationKey);
  if (!normalized) return false;
  const expiresAt = followBottomCatchupRequests.get(normalized);
  if (!expiresAt) return false;
  if (expiresAt > Date.now()) return true;
  followBottomCatchupRequests.delete(normalized);
  return false;
}

export function requestFollowBottomCatchup(conversationKey: number): void {
  const normalized = normalizeConversationKey(conversationKey);
  if (!normalized) return;
  followBottomCatchupRequests.set(
    normalized,
    Date.now() + FOLLOW_BOTTOM_CATCHUP_GRACE_MS,
  );
}

export function cancelFollowBottomCatchup(conversationKey: number): void {
  const normalized = normalizeConversationKey(conversationKey);
  if (!normalized) return;
  followBottomCatchupRequests.delete(normalized);
}

export function getChatScrollSnapshot(
  conversationKey: number,
): ChatScrollSnapshot | undefined {
  const normalized = normalizeConversationKey(conversationKey);
  return normalized ? chatScrollSnapshots.get(normalized) : undefined;
}

export function setFollowBottomChatScrollSnapshot(
  conversationKey: number,
  chatBox: HTMLDivElement,
): void {
  const normalized = normalizeConversationKey(conversationKey);
  if (!normalized) return;
  pendingChatScrollRestores.delete(normalized);
  chatScrollSnapshots.set(normalized, buildFollowBottomScrollSnapshot(chatBox));
}

export function persistChatScrollSnapshotForConversationKey(
  conversationKey: number,
  chatBox: HTMLDivElement,
): void {
  const normalized = normalizeConversationKey(conversationKey);
  if (!normalized) return;
  if (!isChatViewportVisible(chatBox)) return;
  chatScrollSnapshots.set(normalized, buildChatScrollSnapshot(chatBox));
}

export function persistPendingChatScrollRestoreForConversationKey(
  conversationKey: number,
  chatBox: HTMLDivElement,
  preferredAnchorElement?: Element | null,
): void {
  const normalized = normalizeConversationKey(conversationKey);
  if (!normalized) return;
  if (!isChatViewportVisible(chatBox)) return;
  const snapshot = buildChatScrollSnapshot(chatBox, preferredAnchorElement);
  chatScrollSnapshots.set(normalized, snapshot);
  pendingChatScrollRestores.set(normalized, {
    snapshot,
    expiresAt: Date.now() + PENDING_RESTORE_TTL_MS,
    appliedBodies: new WeakSet<Element>(),
  });
}

export function persistChatScrollSnapshotFromBody(body: Element): void {
  const root = body.querySelector("#llm-main") as HTMLElement | null;
  const conversationKey = normalizeConversationKey(
    Number(root?.dataset?.itemId || 0),
  );
  if (!conversationKey) return;
  const chatBox = body.querySelector("#llm-chat-box") as HTMLDivElement | null;
  if (!chatBox || !chatBox.childElementCount) return;
  persistChatScrollSnapshotForConversationKey(conversationKey, chatBox);
}

export function persistPendingChatScrollRestoreFromBody(body: Element): void {
  const root = body.querySelector("#llm-main") as HTMLElement | null;
  const conversationKey = normalizeConversationKey(
    Number(root?.dataset?.itemId || 0),
  );
  if (!conversationKey) return;
  const chatBox = body.querySelector("#llm-chat-box") as HTMLDivElement | null;
  if (!chatBox || !chatBox.childElementCount) return;
  persistPendingChatScrollRestoreForConversationKey(conversationKey, chatBox);
}

export function persistPendingChatScrollRestoreForElement(
  body: Element,
  targetElement: Element | null | undefined,
): void {
  const root = body.querySelector("#llm-main") as HTMLElement | null;
  const conversationKey = normalizeConversationKey(
    Number(root?.dataset?.itemId || 0),
  );
  if (!conversationKey) return;
  const chatBox = body.querySelector("#llm-chat-box") as HTMLDivElement | null;
  if (!chatBox || !chatBox.childElementCount) return;
  persistPendingChatScrollRestoreForConversationKey(
    conversationKey,
    chatBox,
    targetElement,
  );
}

export function consumePendingChatScrollRestore(
  conversationKey: number,
  body?: Element | null,
): ChatScrollSnapshot | undefined {
  const normalized = normalizeConversationKey(conversationKey);
  if (!normalized) return undefined;
  const pending = pendingChatScrollRestores.get(normalized);
  if (!pending) return undefined;
  if (pending.expiresAt < Date.now()) {
    pendingChatScrollRestores.delete(normalized);
    return undefined;
  }
  if (body) {
    if (pending.appliedBodies.has(body)) return undefined;
    pending.appliedBodies.add(body);
  }
  return pending.snapshot;
}

export const consumePendingChatScrollRestoreForTests =
  consumePendingChatScrollRestore;

export function applyChatScrollSnapshot(
  chatBox: HTMLDivElement,
  snapshot: ChatScrollSnapshot,
): void {
  scrollUpdatesSuspended = true;
  if (snapshot.mode === "followBottom") {
    chatBox.scrollTop = chatBox.scrollHeight;
  } else if (!restoreChatScrollAnchor(chatBox, snapshot.anchor)) {
    chatBox.scrollTop = clampScrollTop(chatBox, snapshot.scrollTop);
  }
  Promise.resolve().then(() => {
    scrollUpdatesSuspended = false;
  });
}

export function restoreChatScrollSnapshotForConversationKey(
  conversationKey: number,
  chatBox: HTMLDivElement,
): boolean {
  const snapshot = getChatScrollSnapshot(conversationKey);
  if (!snapshot) return false;
  applyChatScrollSnapshot(chatBox, snapshot);
  persistChatScrollSnapshotForConversationKey(conversationKey, chatBox);
  return true;
}

export function withScrollGuard(
  chatBox: HTMLDivElement | null,
  conversationKey: number | null,
  fn: () => void,
  restoreMode: ScrollGuardRestoreMode = "absolute",
): void {
  if (!chatBox || conversationKey === null) {
    fn();
    return;
  }
  const wasNearBottom = isNearBottom(chatBox);
  const savedScrollTop = chatBox.scrollTop;
  const savedMaxScrollTop = getMaxScrollTop(chatBox);

  scrollUpdatesSuspended = true;
  try {
    fn();
  } finally {
    if (wasNearBottom) {
      chatBox.scrollTop = chatBox.scrollHeight;
    } else if (restoreMode === "relative" && savedMaxScrollTop > 0) {
      const nextMaxScrollTop = getMaxScrollTop(chatBox);
      const progress = Math.min(
        1,
        Math.max(0, savedScrollTop / savedMaxScrollTop),
      );
      chatBox.scrollTop = Math.round(nextMaxScrollTop * progress);
    } else {
      chatBox.scrollTop = savedScrollTop;
    }
    persistChatScrollSnapshotForConversationKey(conversationKey, chatBox);
    Promise.resolve().then(() => {
      scrollUpdatesSuspended = false;
    });
  }
}

export function clearChatScrollSnapshotsForTests(): void {
  chatScrollSnapshots.clear();
  pendingChatScrollRestores.clear();
  followBottomCatchupRequests.clear();
  scrollUpdatesSuspended = false;
}
