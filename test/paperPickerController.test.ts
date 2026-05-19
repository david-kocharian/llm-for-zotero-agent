import { assert } from "chai";
import { describe, it } from "mocha";
import { createPaperPickerController } from "../src/modules/contextPanel/setupHandlers/controllers/paperPickerController";
import { MAX_SELECTED_PAPER_CONTEXTS } from "../src/modules/contextPanel/constants";
import {
  selectedPaperContextCache,
  selectedPaperPreviewExpandedCache,
} from "../src/modules/contextPanel/state";
import type { PaperContextRef } from "../src/modules/contextPanel/types";

function makeRegularItem(index: number): Zotero.Item {
  const itemId = 1_000 + index;
  const attachmentId = 2_000 + index;
  return {
    id: itemId,
    firstCreator: "Tester",
    isAttachment: () => false,
    isRegularItem: () => true,
    getAttachments: () => [attachmentId],
    getField: (field: string) => {
      switch (field) {
        case "title":
          return `Picker Paper ${index}`;
        case "firstCreator":
          return "Tester";
        case "year":
          return "2026";
        default:
          return "";
      }
    },
  } as unknown as Zotero.Item;
}

function makeAttachment(index: number): Zotero.Item {
  return {
    id: 2_000 + index,
    parentID: 1_000 + index,
    attachmentContentType: "application/pdf",
    isAttachment: () => true,
    isRegularItem: () => false,
    getAttachments: () => [],
    getField: (field: string) => (field === "title" ? `Picker Paper ${index} PDF` : ""),
  } as unknown as Zotero.Item;
}

describe("paper picker controller", function () {
  it("allows 30 manually selected paper contexts and rejects the 31st", function () {
    const originalZotero = (globalThis as typeof globalThis & { Zotero?: unknown })
      .Zotero;
    const itemId = 42;
    const items = Array.from({ length: MAX_SELECTED_PAPER_CONTEXTS + 1 }, (_, index) =>
      makeRegularItem(index + 1),
    );
    const attachments = new Map<number, Zotero.Item>();
    for (let index = 1; index <= MAX_SELECTED_PAPER_CONTEXTS + 1; index += 1) {
      attachments.set(2_000 + index, makeAttachment(index));
    }
    const statuses: Array<{ message: string; level: string }> = [];

    (globalThis as typeof globalThis & { Zotero?: unknown }).Zotero = {
      Items: {
        get(id: number) {
          return attachments.get(id) || null;
        },
      },
    };
    selectedPaperContextCache.delete(itemId);
    selectedPaperPreviewExpandedCache.delete(itemId);

    try {
      const controller = createPaperPickerController({
        body: {} as Element,
        panelRoot: {} as HTMLElement,
        inputBox: {} as HTMLTextAreaElement,
        paperPicker: null,
        paperPickerList: null,
        getItem: () => ({ id: itemId } as Zotero.Item),
        getCurrentLibraryID: () => 1,
        isWebChatMode: () => false,
        resolveAutoLoadedPaperContext: () => null,
        getManualPaperContextsForItem: () =>
          selectedPaperContextCache.get(itemId) || [],
        isPaperContextMineru: () => false,
        getTextContextConversationKey: () => null,
        persistDraftInputForCurrentConversation: () => undefined,
        updatePaperPreviewPreservingScroll: () => undefined,
        updateSelectedTextPreviewPreservingScroll: () => undefined,
        setStatusMessage: (message, level) =>
          statuses.push({ message, level }),
        log: () => undefined,
      });

      controller.addZoteroItemsAsPaperContext(
        items.slice(0, MAX_SELECTED_PAPER_CONTEXTS),
      );
      assert.lengthOf(
        selectedPaperContextCache.get(itemId) as PaperContextRef[],
        MAX_SELECTED_PAPER_CONTEXTS,
      );

      controller.addZoteroItemsAsPaperContext([items[MAX_SELECTED_PAPER_CONTEXTS]]);
      assert.lengthOf(
        selectedPaperContextCache.get(itemId) as PaperContextRef[],
        MAX_SELECTED_PAPER_CONTEXTS,
      );
      assert.deepInclude(statuses, {
        message: `Paper Context up to ${MAX_SELECTED_PAPER_CONTEXTS}`,
        level: "error",
      });
    } finally {
      selectedPaperContextCache.delete(itemId);
      selectedPaperPreviewExpandedCache.delete(itemId);
      (globalThis as typeof globalThis & { Zotero?: unknown }).Zotero =
        originalZotero;
    }
  });
});
