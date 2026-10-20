import type { ArtifactJson, RunEvent, RunRequest, RunStatus, RunView } from "../api/types";
import { TERMINAL_RUN_STATUSES } from "../api/types";

/**
 * The run's state, folded from its event stream in order. Pure: no React and no network, so the rules are
 * tested directly.
 *
 * Rules the reducer keeps:
 * - Events are applied once. An event whose sequence is at or below the last one applied is ignored, so a
 *   reconnect that replays from the cursor cannot repeat a line.
 * - Consecutive message chunks of one agent reply form one entry; any other entry ends it.
 * - A tool call is one row, updated in place as its status changes, not one row per update.
 * - A plan is one row, updated in place.
 * - Event types the sample does not know are ignored, as the run API's compatibility rules require.
 * - An input request's answer is shown by the field names it sent and whether each was provided. Values are never
 *   in the run's events, so none is read into the state.
 * - A request is open only while the run is live. Once the run's status is final, every request is closed,
 *   whatever the events said, so a card never waits for an answer that can no longer come.
 */

/** How a notice is shown. `blocked` is the run's own stop, shown with its reason first. */
export type NoticeTone = "info" | "success" | "warning" | "error" | "blocked";

/** A message entry: the joined text of one agent reply. `key` is stable for React. */
export interface MessageEntry {
  readonly kind: "message";
  readonly key: string;
  readonly seq: number;
  readonly text: string;
}

/** A tool call, one row for the call's id. `status` is the last status the agent reported. */
export interface ToolEntry {
  readonly kind: "tool";
  readonly key: string;
  readonly seq: number;
  readonly toolCallId: string;
  readonly title: string;
  readonly status: string | null;
  readonly toolKind: string | null;
}

/** The plan, one row that shows how many steps it has. */
export interface PlanEntry {
  readonly kind: "plan";
  readonly key: string;
  readonly seq: number;
  readonly steps: number;
}

/** A line about the run: a state change, a warning, an error or the run's stop. */
export interface NoticeEntry {
  readonly kind: "notice";
  readonly key: string;
  readonly seq: number;
  /** The event type that produced the line, so the timeline gives each kind its own row. */
  readonly type: string;
  readonly tone: NoticeTone;
  readonly text: string;
  readonly detail: string | null;
}

/** One row of the timeline. */
export type TimelineEntry = MessageEntry | ToolEntry | PlanEntry | NoticeEntry;

/** An artifact as the event stream announces it. Download links come from the artifacts route. */
export interface ArtifactNotice {
  readonly id: string;
  readonly name: string;
  readonly size: number;
}

/** The run state folded from its events. */
export interface RunState {
  /** The run's status: from the snapshot until the first event, then from the events. */
  readonly status: RunStatus | "unknown";
  /** The last sequence applied. Reconnects resume after it. */
  readonly lastSeq: number;
  /** The time of the first event, which starts the duration. */
  readonly startedAt: string | null;
  /** The time the run ended, from the terminal event. */
  readonly endedAt: string | null;
  readonly runtime: string | null;
  /** The computer the run is on. A replacement changes it. */
  readonly computerId: string | null;
  /** The usage the final reply reported, when the agent sent one. */
  readonly usage: Readonly<Record<string, unknown>> | null;
  readonly timeline: readonly TimelineEntry[];
  /** Requests still waiting for an answer, oldest first. Empty once the run's status is final. */
  readonly openRequests: readonly RunRequest[];
  readonly artifacts: readonly ArtifactNotice[];
  readonly result: string | null;
  /** The reason the run failed or was blocked, when it did. */
  readonly error: string | null;
  /** True while the last entry is a message entry that the next chunk extends. */
  readonly messageOpen: boolean;
}

/** The state before any event. */
export const INITIAL_RUN_STATE: RunState = {
  status: "unknown",
  lastSeq: 0,
  startedAt: null,
  endedAt: null,
  runtime: null,
  computerId: null,
  usage: null,
  timeline: [],
  openRequests: [],
  artifacts: [],
  result: null,
  error: null,
  messageOpen: false,
};

/**
 * Folds the run snapshot into the state, for the time before the first event arrives. Events always win:
 * once any event has been applied, the snapshot changes nothing.
 *
 * @param state The state so far.
 * @param run The run as `GET /v1/runs/{id}` returned it.
 */
export function withSnapshot(state: RunState, run: RunView): RunState {
  if (state.lastSeq > 0) return state;
  return closeRequestsWhenEnded({
    ...state,
    status: run.status,
    computerId: state.computerId ?? run.computer_id,
    startedAt: state.startedAt ?? run.started_at ?? run.created_at ?? null,
    runtime: state.runtime ?? run.runtime ?? null,
  });
}

/**
 * Fold one event into the state.
 *
 * @param state The state so far.
 * @param event The next event from the stream.
 */
export function applyEvent(state: RunState, event: RunEvent): RunState {
  if (event.seq <= state.lastSeq) return state;
  return closeRequestsWhenEnded(foldEvent(state, event));
}

/** Folds an event that is past the cursor. The caller has checked the sequence. */
function foldEvent(state: RunState, event: RunEvent): RunState {
  const base: RunState = { ...state, lastSeq: event.seq, startedAt: state.startedAt ?? event.at };
  const data = event.data;
  switch (event.type) {
    case "run.started": {
      const runtime = textOrNull(objectOf(data["computer"])?.["runtime"]) ?? base.runtime;
      return notice({ ...base, status: "running", runtime }, event, "info", "Computer started", runtime);
    }
    case "harness.started": {
      const detail = [textOrNull(data["name"]), textOrNull(data["version"])].filter((part) => part !== null).join(" ");
      return notice(base, event, "info", "Harness started", detail === "" ? null : detail);
    }
    case "run.progress":
      return progress(base, event);
    case "run.waiting_input": {
      const request = objectOf(data["request"]) as unknown as RunRequest | undefined;
      if (!request || typeof request.id !== "string") return base;
      const open = base.openRequests.filter((existing) => existing.id !== request.id);
      return notice(
        { ...base, status: "waiting_input", openRequests: [...open, request] },
        event,
        "warning",
        `Waiting for a person: ${textOf(request.title, request.kind)}`,
        reasonOf(request.meta),
      );
    }
    case "request.answered":
    case "run.input_answered":
      return answered(base, event);
    case "computer.paused":
      return notice(base, event, "info", "Computer paused", textOrNull(data["reason"]));
    case "computer.parked_deleted":
      return notice(base, event, "info", "Computer parked and deleted", textOrNull(data["reason"]));
    case "computer.resumed":
      return notice(base, event, "success", "Computer resumed", null);
    case "takeover.granted":
      return notice(base, event, "warning", `Take-over granted to ${textOf(data["holder"], "a person")}`, null);
    case "takeover.released": {
      const requestId = textOf(data["request_id"], "");
      return notice(
        { ...base, openRequests: base.openRequests.filter((request) => request.id !== requestId) },
        event,
        "info",
        `Take-over released (${textOf(data["reason"], "released")})`,
        null,
      );
    }
    case "tools.unavailable":
      return notice(base, event, "warning", "Tools unavailable", summaryOf(data));
    case "tools.available":
      return notice(base, event, "info", "Tools available", summaryOf(data));
    case "run.reminder":
      return notice(base, event, "info", "Reminder", textOrNull(data["text"]) ?? textOrNull(data["message"]));
    case "checkpoint.saved":
      return notice(base, event, "info", `Checkpoint saved (seq ${numberText(data["seq"])})`, null);
    case "checkpoint.failed":
      return notice(base, event, "error", "Checkpoint failed", textOrNull(data["code"]));
    case "computer.replaced": {
      const computerId = idOf(data["new"]) ?? base.computerId;
      return notice(
        { ...base, computerId },
        event,
        "warning",
        "Computer replaced",
        `From checkpoint ${numberText(data["checkpoint_seq"])}`,
      );
    }
    case "computer.lifetime_capped":
      return notice(base, event, "warning", `Computer lifetime capped at ${numberText(data["max_s"])} s`, null);
    case "artifact.added": {
      const artifact: ArtifactNotice = {
        id: textOf(data["id"], event.seq.toString()),
        name: textOf(data["name"], "artifact"),
        size: typeof data["size"] === "number" ? data["size"] : 0,
      };
      return notice(
        { ...base, artifacts: [...base.artifacts, artifact] },
        event,
        "info",
        `Artifact: ${artifact.name}`,
        null,
      );
    }
    case "artifact.collect_failed":
      return notice(base, event, "error", "Outbox could not be collected", textOrNull(data["code"]));
    case "run.completed":
      return notice(
        {
          ...base,
          status: "completed",
          result: textOrNull(data["result"]) ?? "",
          usage: objectOf(data["usage"]) ?? null,
          endedAt: event.at,
        },
        event,
        "success",
        "Run completed",
        null,
      );
    case "run.failed": {
      const error = textOf(data["error"], "The run failed");
      return notice({ ...base, status: "failed", error, endedAt: event.at }, event, "error", error, null);
    }
    case "run.cancelled":
      return notice({ ...base, status: "cancelled", endedAt: event.at }, event, "info", "Run cancelled", null);
    case "run.blocked": {
      const reason = textOf(data["reason"], "The run was blocked");
      return notice({ ...base, status: "blocked", error: reason, endedAt: event.at }, event, "blocked", reason, null);
    }
    case "recording.started":
      return notice(base, event, "info", "Recording started", null);
    case "recording.paused":
      return notice(base, event, "info", "Recording paused", textOrNull(data["reason"]));
    case "recording.resumed":
      return notice(base, event, "info", "Recording resumed", null);
    case "recording.stopped":
      return notice(base, event, "info", "Recording stopped", textOrNull(data["reason"]));
    case "recording.unavailable":
      return notice(base, event, "warning", "Recording unavailable", textOrNull(data["code"]));
    case "access.denied":
      return notice(base, event, "warning", `Access refused: ${textOf(data["action"], "action")}`, null);
    default:
      return base;
  }
}

/**
 * Closes every open request once the run's status is final. This is the one place a request stops being open
 * because of the run's end; the cards only show what the state holds.
 */
function closeRequestsWhenEnded(state: RunState): RunState {
  const ended = TERMINAL_RUN_STATUSES.some((status) => status === state.status);
  return ended && state.openRequests.length > 0 ? { ...state, openRequests: [] } : state;
}

/** The run's progress events: a message chunk, a tool call, a plan or the setup check. Others are ignored. */
function progress(state: RunState, event: RunEvent): RunState {
  const data = event.data;
  switch (data["kind"]) {
    case "message":
      return appendMessage(state, event, textOf(data["text"], ""));
    case "tool":
      return upsertTool(state, event, data);
    case "plan":
      return upsertPlan(state, event, Array.isArray(data["entries"]) ? data["entries"].length : 0);
    case "setup":
      return data["status"] === "ready"
        ? notice(state, event, "success", "Setup ready", data["seconds"] === undefined ? null : `${numberText(data["seconds"])} s`)
        : notice(state, event, "info", `Setup ${textOf(data["status"], "updated")}`, null);
    default:
      return state;
  }
}

/** A request was answered or expired. The status returns to running once no request is open. */
function answered(state: RunState, event: RunEvent): RunState {
  const requestId = textOf(event.data["request_id"], "");
  const request = state.openRequests.find((candidate) => candidate.id === requestId);
  const remaining = state.openRequests.filter((candidate) => candidate.id !== requestId);
  const status: RunStatus | "unknown" = remaining.length > 0 ? "waiting_input" : "running";
  const expired = objectOf(event.data["answer"])?.["expired"] === true;
  const { tone, text } = expired
    ? { tone: "warning" as const, text: "Request expired" }
    : { tone: "success" as const, text: answerText(request, event.data) };
  return notice({ ...state, status, openRequests: remaining }, event, tone, text, null);
}

/**
 * What an answer reads as. An input request's answer is recorded at the top of the event as `action` and
 * `fields` (`{ name, provided }`): the names and whether each was provided, never a value. Other answers keep
 * their `answer` object and name the option or the text the person chose.
 */
function answerText(request: RunRequest | undefined, data: Readonly<Record<string, unknown>>): string {
  const action = textOrNull(data["action"]);
  if (action !== null) return inputAnswerText(action, data["fields"]);
  const answer = objectOf(data["answer"]);
  const optionId = textOrNull(answer?.["option_id"]);
  const option = request?.options.find((candidate) => candidate.id === optionId);
  return `Answered: ${option?.name ?? textOrNull(answer?.["text"]) ?? "answered"}`;
}

/** An input request's answer: a decline or cancel, or the accepted fields by name, each marked provided or not. */
function inputAnswerText(action: string, fields: unknown): string {
  if (action === "decline") return "Declined";
  if (action === "cancel") return "Cancelled";
  const shown = Array.isArray(fields)
    ? fields.flatMap((field) => {
        const name = textOrNull(objectOf(field)?.["name"]);
        if (name === null) return [];
        return [`${name} (${objectOf(field)?.["provided"] === true ? "provided" : "not provided"})`];
      })
    : [];
  return shown.length > 0 ? `Answered: ${shown.join(", ")}` : "Answered";
}

/** Appends a message chunk, or extends the entry that is open. Chunks are deltas, so they are joined as they are. */
function appendMessage(state: RunState, event: RunEvent, text: string): RunState {
  if (text.length === 0) return state;
  const last = state.timeline[state.timeline.length - 1];
  if (state.messageOpen && last?.kind === "message") {
    const extended: MessageEntry = { ...last, text: last.text + text };
    return { ...state, timeline: [...state.timeline.slice(0, -1), extended] };
  }
  const entry: MessageEntry = { kind: "message", key: `m${event.seq}`, seq: event.seq, text };
  return { ...state, messageOpen: true, timeline: [...state.timeline, entry] };
}

/** Adds a tool call, or updates the row of the same call in place. */
function upsertTool(state: RunState, event: RunEvent, data: Readonly<Record<string, unknown>>): RunState {
  const toolCallId = textOf(data["tool_call_id"], textOf(data["id"], `seq${event.seq}`));
  const existing = state.timeline.find((entry): entry is ToolEntry => entry.kind === "tool" && entry.toolCallId === toolCallId);
  const entry: ToolEntry = {
    kind: "tool",
    key: `t:${toolCallId}`,
    seq: existing?.seq ?? event.seq,
    toolCallId,
    title: textOf(data["title"], existing?.title ?? "tool call"),
    status: textOrNull(data["status"]) ?? existing?.status ?? null,
    toolKind: textOrNull(data["tool_kind"] ?? data["kind"]) ?? existing?.toolKind ?? null,
  };
  return replaceOrAdd(state, event, (candidate) => candidate.kind === "tool" && candidate.toolCallId === toolCallId, entry);
}

/** Adds the plan, or updates its single row in place. */
function upsertPlan(state: RunState, event: RunEvent, steps: number): RunState {
  const entry: PlanEntry = { kind: "plan", key: "plan", seq: event.seq, steps };
  return replaceOrAdd(state, event, (candidate) => candidate.kind === "plan", entry);
}

/** Replaces the first entry that matches, keeping its place, or appends the entry. Ends an open message. */
function replaceOrAdd(
  state: RunState,
  event: RunEvent,
  matches: (entry: TimelineEntry) => boolean,
  entry: TimelineEntry,
): RunState {
  const index = state.timeline.findIndex(matches);
  const timeline =
    index < 0
      ? [...state.timeline, entry]
      : state.timeline.map((current, position) => (position === index ? entry : current));
  return { ...state, timeline, messageOpen: false, lastSeq: event.seq };
}

/** Adds a notice, which ends any open message. An empty text adds nothing but still ends the message. */
function notice(
  state: RunState,
  event: RunEvent,
  tone: NoticeTone,
  text: string,
  detail: string | null,
): RunState {
  const closed: RunState = { ...state, messageOpen: false };
  if (text.length === 0) return closed;
  const entry: NoticeEntry = {
    kind: "notice",
    key: `n${event.seq}`,
    seq: event.seq,
    type: event.type,
    tone,
    text,
    detail,
  };
  return { ...closed, timeline: [...closed.timeline, entry] };
}

/** A short text of a tools or access payload: the names listed, or its reason. */
function summaryOf(data: Readonly<Record<string, unknown>>): string | null {
  for (const key of ["servers", "tools", "names"]) {
    const list = data[key];
    if (Array.isArray(list)) {
      const names = list
        .map((item) => (typeof item === "string" ? item : textOrNull(objectOf(item)?.["name"])))
        .filter((name): name is string => name !== null);
      if (names.length > 0) return names.join(", ");
    }
  }
  return textOrNull(data["reason"]);
}

/** The line a request shows under its title: a take-over's or approval's reason, or an input request's message. */
function reasonOf(meta: Readonly<Record<string, unknown>>): string | null {
  return textOrNull(meta["reason"]) ?? textOrNull(meta["message"]);
}

function idOf(value: unknown): string | null {
  return textOrNull(value) ?? textOrNull(objectOf(value)?.["id"]);
}

function numberText(value: unknown): string {
  return typeof value === "number" ? String(value) : "?";
}

/** An object value, or undefined. Arrays and nulls are not objects here. */
export function objectOf(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function textOf(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The artifacts of a run with the download links the artifacts route gave, matched by id. */
export function withLinks(
  artifacts: readonly ArtifactNotice[],
  links: readonly ArtifactJson[],
): readonly (ArtifactNotice & { readonly url: string | null })[] {
  return artifacts.map((artifact) => ({
    ...artifact,
    url: links.find((link) => link.id === artifact.id)?.download_url ?? null,
  }));
}
