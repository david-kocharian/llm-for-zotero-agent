export type MineruSourceUiState =
  | "cached"
  | "idle"
  | "processing"
  | "failed";

export type MineruSourceAction = "select" | "start" | "pause" | "retry";

export type MineruSourceStatusSnapshot =
  | {
      status?: "idle" | "processing" | "failed" | "cached";
    }
  | undefined;

export type MineruSourceOptionState = {
  state: MineruSourceUiState;
  action: MineruSourceAction;
  hideTextSource: boolean;
};

export function resolveMineruSourceOptionState(input: {
  hasUsableMineru: boolean;
  itemStatus?: MineruSourceStatusSnapshot;
}): MineruSourceOptionState {
  const status = input.itemStatus?.status;
  const hasUsableMineru = input.hasUsableMineru || status === "cached";

  if (status === "processing") {
    return {
      state: "processing",
      action: "pause",
      hideTextSource: hasUsableMineru,
    };
  }

  if (status === "failed") {
    return {
      state: "failed",
      action: "retry",
      hideTextSource: hasUsableMineru,
    };
  }

  if (hasUsableMineru) {
    return {
      state: "cached",
      action: "select",
      hideTextSource: true,
    };
  }

  return {
    state: "idle",
    action: "start",
    hideTextSource: false,
  };
}
