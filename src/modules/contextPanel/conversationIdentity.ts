import {
  resolveConversationKeyForNoteFocus,
  resolvePreferredConversationSystem,
} from "./portalScope";

export function getConversationKey(item: Zotero.Item): number {
  const noteFocusConversationKey = resolveConversationKeyForNoteFocus(item, {
    conversationSystem: resolvePreferredConversationSystem({ item }),
  });
  if (noteFocusConversationKey) return noteFocusConversationKey;
  if (item.isAttachment() && item.parentID) {
    return item.parentID;
  }
  return item.id;
}
