import { assert } from "chai";

import { redactToolArgumentPreview } from "../src/agent/toolArgumentDiagnostics";

describe("tool argument diagnostics", function () {
  it("redacts unquoted multi-word content-like malformed arguments", function () {
    const preview = redactToolArgumentPreview(
      "{ action: write, content: secret generated script body with token abc123 }",
    );

    assert.include(preview, "[redacted]");
    assert.notInclude(preview, "secret generated script body");
    assert.notInclude(preview, "token");
    assert.notInclude(preview, "abc123");
  });

  it("preserves sibling fields after redacting unquoted content-like values", function () {
    const preview = redactToolArgumentPreview(
      "{ action: write, content: secret generated script body, filePath: /tmp/out.py }",
    );

    assert.include(preview, "content: \"[redacted]\"");
    assert.include(preview, "filePath: /tmp/out.py");
    assert.notInclude(preview, "secret generated script body");
  });

  it("continues redacting quoted content-like malformed arguments", function () {
    const preview = redactToolArgumentPreview(
      '{"action":"write","content":"secret generated script body"',
    );

    assert.include(preview, '"content":"[redacted]"');
    assert.notInclude(preview, "secret generated script body");
  });
});
