const CONTENT_LIKE_ARGUMENT_KEYS = new Set([
  "body",
  "code",
  "content",
  "contents",
  "data",
  "source",
  "text",
]);

export const MALFORMED_TOOL_ARGUMENTS_KEY =
  "__llmForZoteroMalformedToolArguments";

export type MalformedToolArgumentsDiagnostic = {
  [MALFORMED_TOOL_ARGUMENTS_KEY]: true;
  reason: "invalid_json";
  rawPreview: string;
  rawLength: number;
};

export function isContentLikeToolArgumentKey(key: string): boolean {
  const normalized = key
    .trim()
    .replace(/[-_\s]+/g, "")
    .toLowerCase();
  return CONTENT_LIKE_ARGUMENT_KEYS.has(normalized);
}

function redactContentLikeAssignments(raw: string): string {
  const contentKeyPattern = Array.from(CONTENT_LIKE_ARGUMENT_KEYS).join("|");
  const assignmentStartPattern = new RegExp(
    `(?:"|')?(?:${contentKeyPattern})(?:"|')?\\s*:\\s*`,
    "gi",
  );
  let redacted = "";
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = assignmentStartPattern.exec(raw))) {
    const valueStart = match.index + match[0].length;
    const valueEnd = findToolArgumentValueEnd(raw, valueStart);
    redacted += raw.slice(cursor, valueStart) + '"[redacted]"';
    cursor = valueEnd;
    assignmentStartPattern.lastIndex = valueEnd;
  }
  return redacted + raw.slice(cursor);
}

function findToolArgumentValueEnd(raw: string, valueStart: number): number {
  const quote = raw[valueStart];
  if (quote === '"' || quote === "'" || quote === "`") {
    for (let index = valueStart + 1; index < raw.length; index += 1) {
      if (raw[index] === "\\") {
        index += 1;
        continue;
      }
      if (raw[index] === quote) return index + 1;
    }
    return raw.length;
  }
  for (let index = valueStart; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === "}" || char === "]") return index;
    if (char === "," && startsNextToolArgumentField(raw, index)) return index;
  }
  return raw.length;
}

function startsNextToolArgumentField(raw: string, commaIndex: number): boolean {
  let index = commaIndex + 1;
  while (index < raw.length && /\s/.test(raw[index])) index += 1;
  const quote = raw[index];
  if (quote === '"' || quote === "'") {
    index += 1;
    while (index < raw.length && raw[index] !== quote) index += 1;
    if (raw[index] !== quote) return false;
    index += 1;
  } else {
    const keyMatch = /^[A-Za-z_$][\w$-]*/.exec(raw.slice(index));
    if (!keyMatch) return false;
    index += keyMatch[0].length;
  }
  while (index < raw.length && /\s/.test(raw[index])) index += 1;
  return raw[index] === ":";
}

export function redactToolArgumentPreview(
  raw: string,
  maxLength = 320,
): string {
  const redacted = redactContentLikeAssignments(raw).replace(/\s+/g, " ");
  if (redacted.length <= maxLength) return redacted;
  return `${redacted.slice(0, maxLength)}...[truncated ${
    redacted.length - maxLength
  } chars]`;
}

export function createMalformedToolArgumentsDiagnostic(
  raw: unknown,
): MalformedToolArgumentsDiagnostic {
  const text = typeof raw === "string" ? raw : String(raw ?? "");
  return {
    [MALFORMED_TOOL_ARGUMENTS_KEY]: true,
    reason: "invalid_json",
    rawPreview: redactToolArgumentPreview(text),
    rawLength: text.length,
  };
}

export function isMalformedToolArgumentsDiagnostic(
  value: unknown,
): value is MalformedToolArgumentsDiagnostic {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>)[MALFORMED_TOOL_ARGUMENTS_KEY] === true,
  );
}
