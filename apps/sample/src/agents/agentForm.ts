import type { AgentJson, AgentMcpServerWrite, AgentWrite, ToolsMode } from "../api/types";
import { TOOLS } from "../catalog/catalog";
import type { TemplateEntry, ToolEntry } from "../catalog/catalog";

/**
 * The agent form as the person types it, and the request body it becomes. Numbers and JSON stay text until a
 * body is built, so an invalid value is reported where it was typed. The service validates the rest (the
 * allow-lists, ranges and names); its answer is shown inline.
 */

/** The runtimes the form offers. The run API does not list the allowed ones, so the form offers the four. */
export const RUNTIMES = ["docker", "e2b", "agentcore", "lambda"] as const;

/** One MCP server as the form holds it. `key` is for React and removal only; it is never sent. */
export interface ServerDraft {
  readonly key: string;
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  /** Env entries. A `null` value means the read did not include it (the service shows names only). */
  readonly env: readonly { readonly name: string; readonly value: string | null }[];
  /** The listing mode. `null` leaves the harness default. */
  readonly tools: ToolsMode | null;
}

/** The fields as the person types them. */
export interface AgentForm {
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly model: string;
  readonly runtime: string;
  readonly template: string;
  readonly egress: string;
  readonly timeoutS: string;
  readonly maxWaitS: string;
  readonly takeoverAllowed: boolean;
  /** Comma-separated channel names, e.g. `api, email`. */
  readonly allowedChannels: string;
  /** A JSON array of argv arrays. */
  readonly setupCommands: string;
  /** A JSON array of strings (one argv), or blank for no readiness check. */
  readonly readyCheck: string;
  readonly servers: readonly ServerDraft[];
}

/** The form fields a validation message can belong to. */
export type FormField =
  | "name"
  | "runtime"
  | "template"
  | "egress"
  | "timeoutS"
  | "maxWaitS"
  | "allowedChannels"
  | "setupCommands"
  | "readyCheck"
  | "servers";

/** A message per field that is wrong. A field with no message is valid. */
export type FormErrors = Partial<Record<FormField, string>>;

/** The form a person starts from when they choose a new agent without a template. */
export const BLANK_FORM: AgentForm = {
  name: "",
  description: "",
  instructions: "",
  model: "",
  runtime: "docker",
  template: "",
  egress: "none",
  timeoutS: "3600",
  maxWaitS: "900",
  takeoverAllowed: false,
  allowedChannels: "api",
  setupCommands: "[]",
  readyCheck: "",
  servers: [],
};

/** Limits the service enforces, shown as the form's own rules. */
export const LIMITS = { timeoutMin: 60, timeoutMax: 604800, maxWaitMin: 1 } as const;

/**
 * A field the browser refused to send. Its message names the problem and never echoes a value, which may hold a
 * credential.
 */
export class AgentFormError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentFormError";
  }
}

let keyCounter = 0;

/** A key for a new server row. Only React uses it. */
function newKey(): string {
  keyCounter += 1;
  return `server-${keyCounter}`;
}

/**
 * The form that shows a saved agent. The servers carry env names only, because a read does not send values.
 *
 * @param agent The agent as the service returned it.
 */
export function formOf(agent: AgentJson): AgentForm {
  return {
    name: agent.name,
    description: agent.description,
    instructions: agent.instructions,
    model: agent.model ?? "",
    runtime: agent.computer.runtime,
    template: agent.computer.template,
    egress: agent.computer.egress,
    timeoutS: String(agent.computer.timeout_s),
    maxWaitS: String(agent.max_wait_s),
    takeoverAllowed: agent.takeover_allowed,
    allowedChannels: agent.allowed_channels.join(", "),
    setupCommands: JSON.stringify(agent.setup_commands),
    readyCheck: agent.ready_check === null ? "" : JSON.stringify(agent.ready_check),
    servers: agent.mcp_servers.map((server) => ({
      key: newKey(),
      name: server.name,
      command: server.command,
      args: server.args,
      env: server.env.map((entry) => ({ name: entry.name, value: null })),
      tools: server.tools ?? null,
    })),
  };
}

/**
 * The draft of a server from the tool catalog. The catalog holds no env values, so the draft has none.
 *
 * @param tool The catalog entry.
 */
export function draftFromTool(tool: ToolEntry): ServerDraft {
  return {
    key: newKey(),
    name: tool.server.name,
    command: tool.server.command,
    args: tool.server.args,
    env: tool.server.env.map((entry) => ({ name: entry.name, value: "" })),
    tools: tool.tools,
  };
}

/**
 * Adds a server from the tool catalog. The name must be new in the form, so one server name means one server.
 *
 * @throws {AgentFormError} when a server with the same name is already in the form.
 */
export function addCatalogTool(form: AgentForm, tool: ToolEntry): AgentForm {
  if (form.servers.some((server) => server.name === tool.server.name)) {
    throw new AgentFormError(`A server named "${tool.server.name}" is already added`);
  }
  return { ...form, servers: [...form.servers, draftFromTool(tool)] };
}

/**
 * Parses a custom server written as JSON: `{ name, command, args?, env?, tools? }`. The env values are the
 * caller's to supply, so an env entry needs its value here.
 *
 * @param form The form the server joins.
 * @param text The JSON object.
 * @throws {AgentFormError} with the first problem found.
 */
export function addCustomServer(form: AgentForm, text: string): AgentForm {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AgentFormError("The server must be valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AgentFormError("The server must be a JSON object");
  }
  const obj = parsed as Record<string, unknown>;
  const name = typeof obj["name"] === "string" ? obj["name"].trim() : "";
  const command = typeof obj["command"] === "string" ? obj["command"].trim() : "";
  if (name === "") throw new AgentFormError("A server needs a name");
  if (command === "") throw new AgentFormError(`Server "${name}" needs a command`);
  const args = obj["args"] ?? [];
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string")) {
    throw new AgentFormError(`Server "${name}": args must be an array of strings`);
  }
  const env = obj["env"] ?? [];
  if (!Array.isArray(env) || !env.every(isEnvEntry)) {
    throw new AgentFormError(`Server "${name}": env must be a list of { name, value }`);
  }
  const tools = obj["tools"] ?? null;
  if (tools !== null && tools !== "full" && tools !== "indexed") {
    throw new AgentFormError(`Server "${name}": tools must be "full" or "indexed"`);
  }
  if (form.servers.some((server) => server.name === name)) {
    throw new AgentFormError(`A server named "${name}" is already added`);
  }
  const draft: ServerDraft = {
    key: newKey(),
    name,
    command,
    args: args as string[],
    env: (env as { name: string; value: string }[]).map((entry) => ({ name: entry.name, value: entry.value })),
    tools,
  };
  return { ...form, servers: [...form.servers, draft] };
}

function isEnvEntry(value: unknown): value is { name: string; value: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)["name"] === "string" &&
    typeof (value as Record<string, unknown>)["value"] === "string"
  );
}

/** Removes a server row. */
export function removeServer(form: AgentForm, key: string): AgentForm {
  return { ...form, servers: form.servers.filter((server) => server.key !== key) };
}

/** Sets the value of one env entry of a server row. The value is sent on the next write that includes servers. */
export function setEnvValue(form: AgentForm, key: string, envName: string, value: string): AgentForm {
  return {
    ...form,
    servers: form.servers.map((server) =>
      server.key === key
        ? {
            ...server,
            env: server.env.map((entry) => (entry.name === envName ? { ...entry, value } : entry)),
          }
        : server,
    ),
  };
}

/** Sets a server's listing mode. `null` leaves the harness default. */
export function setServerTools(form: AgentForm, key: string, tools: ToolsMode | null): AgentForm {
  return {
    ...form,
    servers: form.servers.map((server) => (server.key === key ? { ...server, tools } : server)),
  };
}

/**
 * The form a template makes: its defaults, and its tools as server rows.
 *
 * @param template The template.
 * @param tools The tool catalog the template's tool ids refer to.
 * @throws {AgentFormError} when a tool id is not in the catalog.
 */
export function formFromTemplate(template: TemplateEntry, tools: readonly ToolEntry[] = TOOLS): AgentForm {
  const agent = template.agent;
  const servers = agent.tools.map((id) => {
    const tool = tools.find((candidate) => candidate.id === id);
    if (!tool) throw new AgentFormError(`The template names an unknown tool "${id}"`);
    return draftFromTool(tool);
  });
  return {
    ...BLANK_FORM,
    name: template.name,
    description: agent.description,
    instructions: agent.instructions,
    model: agent.model ?? "",
    runtime: agent.computer.runtime,
    template: agent.computer.template,
    egress: agent.computer.egress,
    timeoutS: String(agent.computer.timeout_s),
    maxWaitS: String(agent.max_wait_s),
    takeoverAllowed: agent.takeover_allowed,
    allowedChannels: agent.allowed_channels.join(", "),
    setupCommands: JSON.stringify(agent.setup_commands),
    readyCheck: agent.ready_check === null ? "" : JSON.stringify(agent.ready_check),
    servers,
  };
}

/**
 * The part of the servers the service compares: names, commands, arguments, env names and the listing mode.
 * Env values are left out, so the comparison matches what a read shows.
 *
 * @param servers The server rows.
 */
export function serversSignature(servers: readonly ServerDraft[]): string {
  return JSON.stringify(
    servers.map((server) => ({
      name: server.name,
      command: server.command,
      args: server.args,
      env: server.env.map((entry) => entry.name),
      tools: server.tools,
    })),
  );
}

/**
 * The fields that are wrong, by field. Empty when the form can be sent.
 *
 * @param form The form as typed.
 * @param includeServers Whether the servers are part of the request. When they are, every env value must be
 *   supplied, because the service needs the value to store the server.
 */
export function validateAgentForm(form: AgentForm, includeServers: boolean): FormErrors {
  const errors: FormErrors = {};
  if (form.name.trim() === "") errors.name = "Name is required";
  if (form.runtime.trim() === "") errors.runtime = "Choose a runtime";
  if (form.template.trim() === "") errors.template = "Template is required";
  if (form.egress.trim() === "") errors.egress = "Egress is required";
  const timeout = integerOf(form.timeoutS);
  if (timeout === null || timeout < LIMITS.timeoutMin || timeout > LIMITS.timeoutMax) {
    errors.timeoutS = `Use a whole number from ${LIMITS.timeoutMin} to ${LIMITS.timeoutMax}`;
  }
  const maxWait = integerOf(form.maxWaitS);
  if (maxWait === null || maxWait < LIMITS.maxWaitMin) {
    errors.maxWaitS = `Use a whole number of at least ${LIMITS.maxWaitMin}`;
  }
  if (channelsOf(form.allowedChannels).length === 0) errors.allowedChannels = "Name at least one channel";
  try {
    commandsOf(form.setupCommands);
  } catch (err) {
    errors.setupCommands = messageOf(err);
  }
  if (form.readyCheck.trim() !== "") {
    try {
      argvOf(form.readyCheck);
    } catch (err) {
      errors.readyCheck = messageOf(err);
    }
  }
  const serverProblem = serverProblemOf(form.servers, includeServers);
  if (serverProblem !== null) errors.servers = serverProblem;
  return errors;
}

/** The first problem with the server rows, or null. */
function serverProblemOf(servers: readonly ServerDraft[], includeServers: boolean): string | null {
  const names = new Set<string>();
  for (const server of servers) {
    if (server.name.trim() === "") return "Every server needs a name";
    if (names.has(server.name)) return `Server names must be unique: "${server.name}" is listed twice`;
    names.add(server.name);
    if (server.command.trim() === "") return `Server "${server.name}" needs a command`;
    if (includeServers && server.env.some((entry) => entry.value === null || entry.value === "")) {
      return `Server "${server.name}": enter a value for each env variable (values are not shown after saving)`;
    }
  }
  return null;
}

/**
 * The request body for a create or an update. The servers are included only when `includeServers` is set. A
 * read shows env names without values, so an untouched list is not sent back (it would be refused for missing
 * values). A create always includes them.
 *
 * @param form The form as typed.
 * @param includeServers Whether the servers are part of this write.
 * @throws {AgentFormError} with the first problem, when the form cannot be sent.
 */
export function bodyOf(form: AgentForm, includeServers: true): AgentWrite;
export function bodyOf(form: AgentForm, includeServers: boolean): Partial<AgentWrite>;
export function bodyOf(form: AgentForm, includeServers: boolean): Partial<AgentWrite> {
  const errors = validateAgentForm(form, includeServers);
  const first = Object.values(errors)[0];
  if (first !== undefined) throw new AgentFormError(first);
  const model = form.model.trim();
  return {
    name: form.name.trim(),
    description: form.description,
    instructions: form.instructions,
    model: model === "" ? null : model,
    computer: {
      runtime: form.runtime.trim(),
      template: form.template.trim(),
      egress: form.egress.trim(),
      timeout_s: Number(form.timeoutS),
    },
    max_wait_s: Number(form.maxWaitS),
    takeover_allowed: form.takeoverAllowed,
    allowed_channels: channelsOf(form.allowedChannels),
    setup_commands: commandsOf(form.setupCommands),
    ready_check: form.readyCheck.trim() === "" ? null : argvOf(form.readyCheck),
    ...(includeServers ? { mcp_servers: serversOf(form.servers) } : {}),
  };
}

function serversOf(servers: readonly ServerDraft[]): AgentMcpServerWrite[] {
  return servers.map((server) => ({
    name: server.name.trim(),
    command: server.command.trim(),
    args: [...server.args],
    env: server.env.map((entry) => ({ name: entry.name, value: entry.value ?? "" })),
    ...(server.tools !== null ? { tools: server.tools } : {}),
  }));
}

function integerOf(text: string): number | null {
  const trimmed = text.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

function channelsOf(text: string): string[] {
  return text
    .split(",")
    .map((channel) => channel.trim())
    .filter((channel) => channel !== "");
}

/** The setup commands: a JSON array of argv arrays. A blank field is no commands. */
function commandsOf(text: string): string[][] {
  if (text.trim() === "") return [];
  const parsed = parseJsonArray(text, "Setup commands");
  return parsed.map((item) => {
    if (!Array.isArray(item) || !item.every((part) => typeof part === "string")) {
      throw new AgentFormError("Setup commands must be a list of argv arrays of strings");
    }
    return [...(item as string[])];
  });
}

/** The ready check: one argv array of strings. */
function argvOf(text: string): string[] {
  const parsed = parseJsonArray(text, "Ready check");
  if (!parsed.every((part) => typeof part === "string")) {
    throw new AgentFormError("Ready check must be a JSON array of strings");
  }
  return [...(parsed as string[])];
}

function parseJsonArray(text: string, label: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AgentFormError(`${label} must be valid JSON`);
  }
  if (!Array.isArray(parsed)) throw new AgentFormError(`${label} must be a JSON array`);
  return parsed;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : "Invalid value";
}
