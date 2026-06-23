import { assert } from "chai";

import { shouldShowAssistantFooterActions } from "../src/modules/contextPanel/chat";

describe("assistant footer action visibility", function () {
  it("hides footer actions while the assistant response is streaming", function () {
    assert.isFalse(shouldShowAssistantFooterActions({ streaming: true }));
  });

  it("shows footer actions after the assistant response finishes", function () {
    assert.isTrue(shouldShowAssistantFooterActions({ streaming: false }));
  });

  it("hides footer actions for compact marker messages", function () {
    assert.isFalse(
      shouldShowAssistantFooterActions({
        streaming: false,
        compactMarker: true,
      }),
    );
  });
});
