import { assert } from "chai";
import { buildAgentContextBudgetState } from "../src/agent/context/budgetPolicy";
import { compactAgentTranscript } from "../src/agent/context/transcriptCompactor";
import type { AgentModelMessage } from "../src/agent/types";

describe("agent transcript compactor", function () {
  it("creates rehydratable handles for dropped tool messages", function () {
    const messages: AgentModelMessage[] = [
      { role: "user", content: "old catalog request" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "old-call",
            name: "library_search",
            arguments: { entity: "items", mode: "list" },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "old-call",
        name: "library_search",
        content: JSON.stringify({
          totalCount: 2,
          returnedCount: 2,
          results: [
            { itemId: 1, title: "Paper A" },
            { itemId: 2, title: "Paper B" },
          ],
        }),
      },
      { role: "assistant", content: "old answer" },
      { role: "user", content: "current request" },
      { role: "assistant", content: "current answer" },
    ];
    const baseBudget = buildAgentContextBudgetState({
      messages,
      model: "claude-haiku-4-5",
      inputTokenCap: 32_000,
      forceCompact: true,
    });
    const budget = {
      ...baseBudget,
      recentTailTokens: 1,
      summaryTokens: 120,
      policy: {
        ...baseBudget.policy,
        minRecentMessages: 2,
      },
    };
    const result = compactAgentTranscript({
      messages,
      budget,
      force: true,
      conversationKey: 9,
      resourceSignature: "scope-a",
    });

    assert.isTrue(result.compacted);
    assert.lengthOf(result.handleRecords, 1);
    assert.match(result.handleRecords[0].handle, /^trh_/);
    assert.lengthOf(
      (result.handleRecords[0].content as { results: unknown[] }).results,
      2,
    );
    assert.include(
      String(result.summaryMessage?.content),
      result.handleRecords[0].handle,
    );
  });
});
