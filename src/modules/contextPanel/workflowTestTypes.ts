import type { ResolvedContextSource, SendQuestionOptions } from "./types";
import type { QuoteCitation } from "../../shared/types";
import type { WorkflowTestFinalRequestSnapshot } from "./workflowTestHooks";

export type WorkflowTestFixture = {
  parentItemId: number;
  pdfAttachmentId: number;
  tempPdfPath: string;
};

export type WorkflowTestAttachmentFixture = {
  attachmentItemId: number;
  tempPath: string;
  title: string;
  filename: string;
  contentType: string;
};

export type WorkflowTestNoteFixture = WorkflowTestFixture & {
  noteItemId: number;
  noteText: string;
};

export type WorkflowTestStandaloneNoteFixture = {
  noteItemId: number;
  noteText: string;
};

export type WorkflowTestPanel = {
  panelId: string;
  itemId: number;
  contextSnapshot: ResolvedContextSource | null;
};

export type WorkflowTestDiagnostics = {
  panelId?: string;
  activeItemId?: number;
  conversationKey?: number;
  panelConversationKey?: number;
  conversationKind?: string;
  conversationSystem?: string;
  noteId?: number;
  noteKind?: string;
  noteParentItemId?: number;
  contextSnapshot?: ResolvedContextSource | null;
  chipText: string[];
  selectedContextLabels: string[];
  historyNewVisible?: boolean;
  historyToggleVisible?: boolean;
  inputValue?: string;
  statusText?: string;
  messageText?: string;
  lastSend: SendQuestionOptions | null;
  lastFinalRequest: WorkflowTestFinalRequestSnapshot | null;
};

export type WorkflowTestAssistantRenderResult = {
  renderedText: string;
  quoteCardBodies: string[];
};

export type WorkflowTestStandaloneDiagnostics = {
  activeTab?: "paper" | "open" | null;
  conversationKey?: number;
  activeItemId?: number;
  rawContextItemId?: number;
  basePaperItemId?: number;
  contextItemId?: number;
  conversationKind?: string;
  titleText?: string;
  chipText: string[];
  selectedContextLabels: string[];
  messageText?: string;
  paperTabText?: string;
  openTabText?: string;
  statusText?: string;
  lastSend: SendQuestionOptions | null;
  lastFinalRequest: WorkflowTestFinalRequestSnapshot | null;
};

export type WorkflowTestApi = {
  reset: () => Promise<void>;
  createPaperWithPdfFixture: (input: {
    title: string;
    pdfTitle: string;
  }) => Promise<WorkflowTestFixture>;
  createStandaloneAttachmentFixture: (input: {
    title: string;
    filename: string;
    contentType: string;
    text?: string;
  }) => Promise<WorkflowTestAttachmentFixture>;
  createItemNoteFixture: (input: {
    title: string;
    pdfTitle: string;
    noteHtml: string;
  }) => Promise<WorkflowTestNoteFixture>;
  createStandaloneNoteFixture: (input: {
    noteHtml: string;
  }) => Promise<WorkflowTestStandaloneNoteFixture>;
  renderPanelForItem: (itemId: number) => Promise<WorkflowTestPanel>;
  renderStartupPanelForItem: (itemId: number) => Promise<WorkflowTestPanel>;
  seedPanelStoredUserMessage: (
    panelId: string,
    text: string,
  ) => Promise<WorkflowTestDiagnostics>;
  clickPanelSystemToggle: (panelId: string) => Promise<WorkflowTestDiagnostics>;
  selectNoteEditorText: (panelId: string, text: string) => Promise<void>;
  ask: (panelId: string, text: string) => Promise<SendQuestionOptions>;
  renderAssistantForPanel: (
    panelId: string,
    input: {
      text: string;
      quoteCitations?: QuoteCitation[];
    },
  ) => Promise<WorkflowTestAssistantRenderResult>;
  openStandaloneForItem: (
    itemId: number,
  ) => Promise<WorkflowTestStandaloneDiagnostics>;
  clickStandaloneTab: (
    tab: "paper" | "open",
  ) => Promise<WorkflowTestStandaloneDiagnostics>;
  askStandalone: (text: string) => Promise<SendQuestionOptions>;
  getLastFinalRequest: () => WorkflowTestFinalRequestSnapshot | null;
  seedStandaloneUserMessage: (
    text: string,
  ) => Promise<WorkflowTestStandaloneDiagnostics>;
  notifyStandaloneItemChanged: (
    itemId: number | null,
  ) => Promise<WorkflowTestStandaloneDiagnostics>;
  addItemsAsStandaloneContext: (
    itemIds: number[],
  ) => Promise<WorkflowTestStandaloneDiagnostics>;
  getStandaloneDiagnostics: () => Promise<WorkflowTestStandaloneDiagnostics>;
  closeStandalone: () => Promise<void>;
  getLastSend: () => SendQuestionOptions | null;
  getDiagnostics: (panelId?: string) => Promise<WorkflowTestDiagnostics>;
  cleanupFixture: (
    fixture:
      | WorkflowTestFixture
      | WorkflowTestAttachmentFixture
      | WorkflowTestNoteFixture
      | WorkflowTestStandaloneNoteFixture,
  ) => Promise<void>;
};
