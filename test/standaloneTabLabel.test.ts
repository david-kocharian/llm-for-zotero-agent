import { assert } from "chai";
import { resolveStandalonePaperTabLabel } from "../src/modules/contextPanel/standaloneTabLabel";

describe("standaloneTabLabel", function () {
  const globalScope = globalThis as typeof globalThis & {
    Zotero?: {
      Items?: {
        get?: (id: number) => Zotero.Item | null;
      };
    };
  };
  let originalZotero: typeof globalScope.Zotero;

  const parentPaper = {
    id: 10,
    isRegularItem: () => true,
  } as unknown as Zotero.Item;

  const attachedNote = {
    id: 42,
    parentID: 10,
    isNote: () => true,
    getDisplayTitle: () => "Draft note",
    getField: () => "",
    getNoteTitle: () => "Draft note",
  } as unknown as Zotero.Item;

  const paperItem = {
    id: 88,
    isNote: () => false,
  } as unknown as Zotero.Item;

  beforeEach(function () {
    originalZotero = globalScope.Zotero;
    globalScope.Zotero = {
      ...(originalZotero || {}),
      Items: {
        get: (id: number) => (id === 10 ? parentPaper : null),
      },
    };
  });

  afterEach(function () {
    if (originalZotero) {
      globalScope.Zotero = originalZotero;
      return;
    }
    delete globalScope.Zotero;
  });

  const standaloneNote = {
    id: 43,
    isNote: () => true,
    getDisplayTitle: () => "Standalone draft",
    getField: () => "",
    getNoteTitle: () => "Standalone draft",
  } as unknown as Zotero.Item;

  it("labels an attached note paper slot as Item note", function () {
    assert.equal(
      resolveStandalonePaperTabLabel({ paperSlotItem: attachedNote }),
      "Item note",
    );
  });

  it("labels a standalone note slot as Standalone note", function () {
    assert.equal(
      resolveStandalonePaperTabLabel({ paperSlotItem: standaloneNote }),
      "Standalone note",
    );
  });

  it("labels a regular paper slot as Paper chat", function () {
    assert.equal(
      resolveStandalonePaperTabLabel({ paperSlotItem: paperItem }),
      "Paper chat",
    );
  });

  it("falls back to Paper chat when there is no paper-side context", function () {
    assert.equal(resolveStandalonePaperTabLabel(), "Paper chat");
    assert.equal(
      resolveStandalonePaperTabLabel({ paperSlotItem: null }),
      "Paper chat",
    );
  });

  it("overrides the paper slot label with Web chat while webchat is active", function () {
    assert.equal(
      resolveStandalonePaperTabLabel({
        paperSlotItem: attachedNote,
        isWebChat: true,
      }),
      "Web chat",
    );
  });

  it("preserves an item-note paper slot label while library chat is active", function () {
    const paperSlotItem = attachedNote;
    const labelWhileLibraryChat = resolveStandalonePaperTabLabel({
      paperSlotItem,
    });
    const labelAfterReturning = resolveStandalonePaperTabLabel({
      paperSlotItem,
    });

    assert.equal(labelWhileLibraryChat, "Item note");
    assert.equal(labelAfterReturning, "Item note");
  });

  it("preserves a regular paper-slot label while library chat is active", function () {
    const paperSlotItem = paperItem;
    const labelWhileLibraryChat = resolveStandalonePaperTabLabel({
      paperSlotItem,
    });
    const labelAfterReturning = resolveStandalonePaperTabLabel({
      paperSlotItem,
    });

    assert.equal(labelWhileLibraryChat, "Paper chat");
    assert.equal(labelAfterReturning, "Paper chat");
  });
});
