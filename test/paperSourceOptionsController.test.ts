import { assert } from "chai";
import { describe, it } from "mocha";
import { resolveMineruSourceOptionState } from "../src/modules/contextPanel/setupHandlers/controllers/paperSourceOptionsController";

describe("paper source MinerU option state", function () {
  it("offers an action MD row and keeps extracted text when MinerU is missing", function () {
    const state = resolveMineruSourceOptionState({
      hasUsableMineru: false,
    });

    assert.deepEqual(state, {
      state: "idle",
      action: "start",
      hideTextSource: false,
    });
  });

  it("selects MD and hides extracted text when MinerU is cached", function () {
    const state = resolveMineruSourceOptionState({
      hasUsableMineru: true,
    });

    assert.deepEqual(state, {
      state: "cached",
      action: "select",
      hideTextSource: true,
    });
  });

  it("treats a just-cached processing status as a usable MinerU source", function () {
    const state = resolveMineruSourceOptionState({
      hasUsableMineru: false,
      itemStatus: { status: "cached" },
    });

    assert.deepEqual(state, {
      state: "cached",
      action: "select",
      hideTextSource: true,
    });
  });

  it("turns a running parse into a pause action", function () {
    const state = resolveMineruSourceOptionState({
      hasUsableMineru: false,
      itemStatus: { status: "processing" },
    });

    assert.deepEqual(state, {
      state: "processing",
      action: "pause",
      hideTextSource: false,
    });
  });

  it("keeps extracted text hidden for a reparse over an existing cache", function () {
    const processing = resolveMineruSourceOptionState({
      hasUsableMineru: true,
      itemStatus: { status: "processing" },
    });
    const failed = resolveMineruSourceOptionState({
      hasUsableMineru: true,
      itemStatus: { status: "failed" },
    });

    assert.deepEqual(processing, {
      state: "processing",
      action: "pause",
      hideTextSource: true,
    });
    assert.deepEqual(failed, {
      state: "failed",
      action: "retry",
      hideTextSource: true,
    });
  });

  it("turns a failed missing-cache parse into a retry while keeping text available", function () {
    const state = resolveMineruSourceOptionState({
      hasUsableMineru: false,
      itemStatus: { status: "failed" },
    });

    assert.deepEqual(state, {
      state: "failed",
      action: "retry",
      hideTextSource: false,
    });
  });
});
