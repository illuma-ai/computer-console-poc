import scenariosJson from "./scenarios.json";
import templatesJson from "./templates.json";
import toolsJson from "./tools.json";
import type { AgentComputer, ToolsMode } from "../api/types";

/**
 * The catalogs the agents and runs screens offer: the MCP tool catalog, the agent templates, and the run
 * scenarios. They are JSON files so an operator can change them without a code change. Each file is
 * validated when it loads, and a bad entry stops the app with a message that names the file and the entry.
 */

/** An MCP server a template or the tool catalog names. A catalog never holds env values. */
export interface CatalogServer {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: readonly { readonly name: string }[];
}

/** One entry of the tool catalog: an MCP server an agent can add, with its default listing mode. */
export interface ToolEntry {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly server: CatalogServer;
  readonly tools: ToolsMode;
}

/** The defaults a template sets on a new agent. `tools` names tool-catalog entries by id. */
export interface TemplateAgent {
  readonly description: string;
  readonly instructions: string;
  readonly model: string | null;
  readonly computer: AgentComputer;
  readonly max_wait_s: number;
  readonly takeover_allowed: boolean;
  readonly allowed_channels: readonly string[];
  readonly setup_commands: readonly (readonly string[])[];
  readonly ready_check: readonly string[] | null;
  readonly tools: readonly string[];
}

/** One entry of the template list ("New from template"). */
export interface TemplateEntry {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly agent: TemplateAgent;
}

/** One preset prompt the new-run dialog offers. */
export interface ScenarioEntry {
  readonly id: string;
  readonly title: string;
  readonly prompt: string;
}

/** A catalog file that does not match its shape. The message names the file and the entry. */
export class CatalogError extends Error {
  constructor(file: string, message: string) {
    super(`${file}: ${message}`);
    this.name = "CatalogError";
  }
}

type Json = unknown;
type Rec = Readonly<Record<string, Json>>;

function isRecord(value: Json): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates a catalog array. Each entry must be an object with a unique, non-empty `id`, and must pass
 * `readEntry`, which turns the object into the typed entry and throws a message when it does not fit.
 *
 * @param file The file name, for the error message.
 * @param raw The parsed JSON.
 * @param readEntry Reads one entry.
 * @throws {CatalogError} with the file and the entry named.
 */
function readList<T extends { readonly id: string }>(
  file: string,
  raw: Json,
  readEntry: (entry: Rec) => T,
): readonly T[] {
  if (!Array.isArray(raw)) throw new CatalogError(file, "must be a JSON array");
  const seen = new Set<string>();
  return raw.map((item, index) => {
    if (!isRecord(item)) throw new CatalogError(file, `entry ${index} must be an object`);
    const id = typeof item["id"] === "string" && item["id"].trim() !== "" ? item["id"] : null;
    if (id === null) throw new CatalogError(file, `entry ${index} needs a non-empty "id"`);
    if (seen.has(id)) throw new CatalogError(file, `duplicate id "${id}"`);
    seen.add(id);
    try {
      return readEntry(item);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new CatalogError(file, `entry "${id}": ${message}`);
    }
  });
}

function strOf(record: Rec, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`"${key}" must be a non-empty string`);
  return value;
}

function strings(value: Json, key: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`"${key}" must be an array of strings`);
  }
  return value;
}

function num(record: Rec, key: string): number {
  const value = record[key];
  if (typeof value !== "number") throw new Error(`"${key}" must be a number`);
  return value;
}

function bool(record: Rec, key: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") throw new Error(`"${key}" must be true or false`);
  return value;
}

function readServer(value: Json): CatalogServer {
  if (!isRecord(value)) throw new Error('"server" must be an object');
  const env = value["env"] ?? [];
  // A catalog holds names only: a value in it would ship a secret with the app.
  if (!Array.isArray(env) || !env.every((item) => isRecord(item) && typeof item["name"] === "string" && !("value" in item))) {
    throw new Error('"server.env" must list names only');
  }
  return {
    name: strOf(value, "name"),
    command: strOf(value, "command"),
    args: strings(value["args"] ?? [], "server.args"),
    env: env.map((item) => ({ name: String(isRecord(item) ? item["name"] : "") })),
  };
}

function readMode(value: Json): ToolsMode {
  if (value === "full" || value === "indexed") return value;
  throw new Error('"tools" must be "full" or "indexed"');
}

function readComputer(value: Json): AgentComputer {
  if (!isRecord(value)) throw new Error('"computer" must be an object');
  return {
    runtime: strOf(value, "runtime"),
    template: strOf(value, "template"),
    egress: strOf(value, "egress"),
    timeout_s: num(value, "timeout_s"),
  };
}

function readAgent(value: Json): TemplateAgent {
  if (!isRecord(value)) throw new Error('"agent" must be an object');
  const readyCheck = value["ready_check"];
  return {
    description: strOf(value, "description"),
    instructions: strOf(value, "instructions"),
    model: value["model"] === null ? null : strOf(value, "model"),
    computer: readComputer(value["computer"]),
    max_wait_s: num(value, "max_wait_s"),
    takeover_allowed: bool(value, "takeover_allowed"),
    allowed_channels: strings(value["allowed_channels"], "allowed_channels"),
    setup_commands: readCommands(value["setup_commands"]),
    ready_check: readyCheck === null || readyCheck === undefined ? null : strings(readyCheck, "ready_check"),
    tools: strings(value["tools"] ?? [], "tools"),
  };
}

function readCommands(value: Json): readonly (readonly string[])[] {
  if (!Array.isArray(value)) throw new Error('"setup_commands" must be an array');
  return value.map((command) => strings(command, "setup_commands"));
}

/**
 * Reads the tool catalog.
 *
 * @param raw The parsed `tools.json`.
 * @throws {CatalogError} when an entry does not fit the shape.
 */
export function readToolCatalog(raw: Json): readonly ToolEntry[] {
  return readList("tools.json", raw, (entry) => ({
    id: strOf(entry, "id"),
    name: strOf(entry, "name"),
    description: strOf(entry, "description"),
    server: readServer(entry["server"]),
    tools: readMode(entry["tools"]),
  }));
}

/**
 * Reads the template list. A template's tool ids are checked against the tool catalog, so a template cannot
 * name a tool that is not there.
 *
 * @param raw The parsed `templates.json`.
 * @param tools The tool catalog the templates refer to.
 * @throws {CatalogError} when an entry does not fit the shape or names an unknown tool.
 */
export function readTemplateCatalog(raw: Json, tools: readonly ToolEntry[]): readonly TemplateEntry[] {
  const known = new Set(tools.map((tool) => tool.id));
  return readList("templates.json", raw, (entry) => {
    const agent = readAgent(entry["agent"]);
    const unknown = agent.tools.filter((id) => !known.has(id));
    if (unknown.length > 0) throw new Error(`names unknown tools: ${unknown.join(", ")}`);
    return {
      id: strOf(entry, "id"),
      name: strOf(entry, "name"),
      description: strOf(entry, "description"),
      agent,
    };
  });
}

/**
 * Reads the scenario list.
 *
 * @param raw The parsed `scenarios.json`.
 * @throws {CatalogError} when an entry does not fit the shape.
 */
export function readScenarioCatalog(raw: Json): readonly ScenarioEntry[] {
  return readList("scenarios.json", raw, (entry) => ({
    id: strOf(entry, "id"),
    title: strOf(entry, "title"),
    prompt: strOf(entry, "prompt"),
  }));
}

/** The tool catalog the app ships with. */
export const TOOLS: readonly ToolEntry[] = readToolCatalog(toolsJson);
/** The templates the app ships with. */
export const TEMPLATES: readonly TemplateEntry[] = readTemplateCatalog(templatesJson, TOOLS);
/** The run scenarios the app ships with. */
export const SCENARIOS: readonly ScenarioEntry[] = readScenarioCatalog(scenariosJson);
