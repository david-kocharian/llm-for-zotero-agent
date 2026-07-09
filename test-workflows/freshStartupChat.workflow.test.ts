import { assert } from "chai";
import type {
  WorkflowTestApi,
  WorkflowTestFixture,
  WorkflowTestNoteFixture,
  WorkflowTestStandaloneNoteFixture,
} from "../src/modules/contextPanel/workflowTestTypes";

function getWorkflowTestApi(): WorkflowTestApi {
  const api = (Zotero as any).LLMForZotero?.api?.workflowTest;
  assert.isOk(api, "workflow test API should be installed");
  return api as WorkflowTestApi;
}

function diagnosticsMessage(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

describe("workflow: fresh startup chat", function () {
  this.timeout(45000);

  let api: WorkflowTestApi;
  const fixtures: Array<
    | WorkflowTestFixture
    | WorkflowTestNoteFixture
    | WorkflowTestStandaloneNoteFixture
  > = [];

  beforeEach(async function () {
    api = getWorkflowTestApi();
    await api.reset();
  });

  afterEach(async function () {
    await api.closeStandalone();
    while (fixtures.length) {
      const fixture = fixtures.pop();
      if (fixture) await api.cleanupFixture(fixture);
    }
    await api.reset();
  });

  it("opens an embedded paper panel on a blank draft instead of the old stored conversation", async function () {
    const fixture = await api.createPaperWithPdfFixture({
      title: "Workflow Fresh Startup Paper",
      pdfTitle: "Workflow Fresh Startup PDF",
    });
    fixtures.push(fixture);

    const oldPanel = await api.renderPanelForItem(fixture.parentItemId);
    const oldMarker = "workflow old paper startup marker";
    const oldDiagnostics = await api.seedPanelStoredUserMessage(
      oldPanel.panelId,
      oldMarker,
    );
    const oldKey = oldDiagnostics.conversationKey;
    assert.isOk(oldKey, diagnosticsMessage(oldDiagnostics));
    assert.include(
      oldDiagnostics.messageText || "",
      oldMarker,
      diagnosticsMessage(oldDiagnostics),
    );

    const startupPanel = await api.renderStartupPanelForItem(
      fixture.parentItemId,
    );
    const startupDiagnostics = await api.getDiagnostics(startupPanel.panelId);
    assert.equal(
      startupDiagnostics.conversationKind,
      "paper",
      diagnosticsMessage(startupDiagnostics),
    );
    assert.notEqual(
      startupDiagnostics.conversationKey,
      oldKey,
      diagnosticsMessage(startupDiagnostics),
    );
    assert.notInclude(
      startupDiagnostics.messageText || "",
      oldMarker,
      diagnosticsMessage(startupDiagnostics),
    );
  });

  it("opens an embedded standalone note on a blank library draft", async function () {
    const fixture = await api.createStandaloneNoteFixture({
      noteHtml: "<p>Workflow standalone startup note body.</p>",
    });
    fixtures.push(fixture);

    const oldPanel = await api.renderPanelForItem(fixture.noteItemId);
    const oldMarker = "workflow old standalone-note startup marker";
    const oldDiagnostics = await api.seedPanelStoredUserMessage(
      oldPanel.panelId,
      oldMarker,
    );
    const oldKey = oldDiagnostics.conversationKey;
    assert.isOk(oldKey, diagnosticsMessage(oldDiagnostics));

    const startupPanel = await api.renderStartupPanelForItem(
      fixture.noteItemId,
    );
    const startupDiagnostics = await api.getDiagnostics(startupPanel.panelId);
    assert.equal(
      startupDiagnostics.conversationKind,
      "global",
      diagnosticsMessage(startupDiagnostics),
    );
    assert.notEqual(
      startupDiagnostics.conversationKey,
      oldKey,
      diagnosticsMessage(startupDiagnostics),
    );
    assert.notInclude(
      startupDiagnostics.messageText || "",
      oldMarker,
      diagnosticsMessage(startupDiagnostics),
    );
  });

  it("labels standalone item-note windows with the note kind and note title", async function () {
    const fixture = await api.createItemNoteFixture({
      title: "Workflow Standalone Item Note Parent",
      pdfTitle: "Workflow Standalone Item Note PDF",
      noteHtml: "<p>Workflow item note title</p><p>Body.</p>",
    });
    fixtures.push(fixture);

    const diagnostics = await api.openStandaloneForItem(fixture.noteItemId);
    assert.equal(diagnostics.paperTabText, "Item note");
    assert.equal(
      diagnostics.titleText,
      "Item note: Workflow item note title",
      diagnosticsMessage(diagnostics),
    );
  });

  it("labels standalone standalone-note windows with the note kind and note title", async function () {
    const fixture = await api.createStandaloneNoteFixture({
      noteHtml: "<p>Workflow standalone note title</p><p>Body.</p>",
    });
    fixtures.push(fixture);

    const diagnostics = await api.openStandaloneForItem(fixture.noteItemId);
    assert.equal(diagnostics.paperTabText, "Standalone note");
    assert.equal(
      diagnostics.titleText,
      "Standalone note: Workflow standalone note title",
      diagnosticsMessage(diagnostics),
    );
  });
});
