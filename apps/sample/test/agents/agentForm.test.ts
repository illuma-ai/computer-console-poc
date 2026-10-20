import { describe, expect, it } from "vitest";
import {
  addCatalogTool,
  addCustomServer,
  AgentFormError,
  bodyOf,
  BLANK_FORM,
  formFromTemplate,
  formOf,
  removeServer,
  serversSignature,
  setEnvValue,
  setServerTools,
  validateAgentForm,
} from "../../src/agents/agentForm";
import type { AgentForm } from "../../src/agents/agentForm";
import { TEMPLATES, TOOLS } from "../../src/catalog/catalog";
import { agentJson } from "../support/fakes";

/** A form that passes validation with no servers. */
function validForm(overrides: Partial<AgentForm> = {}): AgentForm {
  return { ...BLANK_FORM, name: "Desk agent", template: "cm-desktop-agent", ...overrides };
}

const browserTool = TOOLS.find((tool) => tool.id === "browser");
if (!browserTool) throw new Error("the tool catalog must ship the browser tool");

describe("validateAgentForm", () => {
  it("accepts a complete form with no servers", () => {
    expect(validateAgentForm(validForm(), true)).toEqual({});
  });

  it("names the required fields that are empty", () => {
    const errors = validateAgentForm(BLANK_FORM, false);
    expect(errors.name).toBe("Name is required");
    expect(errors.template).toBe("Template is required");
  });

  it("keeps the timeout within the service's range", () => {
    expect(validateAgentForm(validForm({ timeoutS: "59" }), false).timeoutS).toMatch(/60 to 604800/);
    expect(validateAgentForm(validForm({ timeoutS: "604801" }), false).timeoutS).toMatch(/60 to 604800/);
    expect(validateAgentForm(validForm({ timeoutS: "soon" }), false).timeoutS).toMatch(/whole number/);
    expect(validateAgentForm(validForm({ timeoutS: "60" }), false).timeoutS).toBeUndefined();
  });

  it("requires a max wait of at least one second", () => {
    expect(validateAgentForm(validForm({ maxWaitS: "0" }), false).maxWaitS).toMatch(/at least 1/);
    expect(validateAgentForm(validForm({ maxWaitS: "1" }), false).maxWaitS).toBeUndefined();
  });

  it("requires at least one channel", () => {
    expect(validateAgentForm(validForm({ allowedChannels: " , " }), false).allowedChannels).toBe("Name at least one channel");
  });

  it("names the problem in setup commands and the ready check, without echoing values", () => {
    expect(validateAgentForm(validForm({ setupCommands: "[" }), false).setupCommands).toBe("Setup commands must be valid JSON");
    expect(validateAgentForm(validForm({ setupCommands: '{"a":1}' }), false).setupCommands).toBe("Setup commands must be a JSON array");
    expect(validateAgentForm(validForm({ setupCommands: '[["ls", 1]]' }), false).setupCommands).toBe(
      "Setup commands must be a list of argv arrays of strings",
    );
    expect(validateAgentForm(validForm({ readyCheck: "[1]" }), false).readyCheck).toBe("Ready check must be a JSON array of strings");
    expect(validateAgentForm(validForm({ readyCheck: '["bash","-c","true"]' }), false).readyCheck).toBeUndefined();
  });

  it("needs a value for every env variable when the servers are sent", () => {
    const form = validForm({
      servers: [
        {
          key: "k1",
          name: "api",
          command: "api-mcp",
          args: [],
          env: [{ name: "TOKEN", value: null }],
          tools: null,
        },
      ],
    });
    expect(validateAgentForm(form, true).servers).toMatch(/enter a value for each env variable/);
    expect(validateAgentForm(form, false).servers).toBeUndefined();
  });

  it("refuses two servers with the same name", () => {
    const row = { key: "a", name: "same", command: "x", args: [], env: [], tools: null };
    const errors = validateAgentForm(validForm({ servers: [row, { ...row, key: "b" }] }), false);
    expect(errors.servers).toMatch(/must be unique/);
  });
});

describe("the tool catalog in the form", () => {
  it("adds a catalog tool as a server row with its listing mode and no env values", () => {
    const form = addCatalogTool(validForm(), browserTool);
    expect(form.servers).toHaveLength(1);
    expect(form.servers[0]).toMatchObject({ name: "browser", command: "playwright-mcp", tools: "full" });
    expect(form.servers[0]?.args).toEqual(["--cdp-endpoint", "http://127.0.0.1:9222"]);
  });

  it("refuses a second server with the same name", () => {
    const once = addCatalogTool(validForm(), browserTool);
    expect(() => addCatalogTool(once, browserTool)).toThrow(AgentFormError);
    expect(() => addCatalogTool(once, browserTool)).toThrow('A server named "browser" is already added');
  });
});

describe("a custom server written as JSON", () => {
  const custom = JSON.stringify({ name: "docs", command: "docs-mcp", args: ["--read-only"], env: [{ name: "KEY", value: "v" }], tools: "indexed" });

  it("adds a server with its arguments, env and listing mode", () => {
    const form = addCustomServer(validForm(), custom);
    expect(form.servers[0]).toMatchObject({ name: "docs", command: "docs-mcp", args: ["--read-only"], tools: "indexed" });
    expect(form.servers[0]?.env).toEqual([{ name: "KEY", value: "v" }]);
  });

  it("names the first problem found", () => {
    const cases: [string, string][] = [
      ["not json", "The server must be valid JSON"],
      ["[]", "The server must be a JSON object"],
      ['{"command":"x"}', "A server needs a name"],
      ['{"name":"a"}', 'Server "a" needs a command'],
      ['{"name":"a","command":"x","args":[1]}', 'Server "a": args must be an array of strings'],
      ['{"name":"a","command":"x","env":["KEY"]}', 'Server "a": env must be a list of { name, value }'],
      ['{"name":"a","command":"x","tools":"all"}', 'Server "a": tools must be "full" or "indexed"'],
    ];
    for (const [text, message] of cases) {
      expect(() => addCustomServer(validForm(), text)).toThrow(message);
    }
  });

  it("refuses a custom server whose name is already in the form", () => {
    const once = addCustomServer(validForm(), custom);
    expect(() => addCustomServer(once, custom)).toThrow('A server named "docs" is already added');
  });
});

describe("the request body", () => {
  it("sends the servers only when asked, and omits the listing mode when unset", () => {
    const form = addCatalogTool(validForm({ model: "" }), browserTool);
    const withServers = bodyOf(form, true);
    expect(withServers.mcp_servers).toEqual([
      expect.objectContaining({ name: "browser", command: "playwright-mcp", env: [], tools: "full" }),
    ]);
    expect(withServers.model).toBeNull();

    const withoutServers = bodyOf(validForm({ servers: [] }), false);
    expect(withoutServers).not.toHaveProperty("mcp_servers");
  });

  it("omits tools when the harness default applies", () => {
    const form = validForm({
      servers: [{ key: "k", name: "x", command: "x", args: [], env: [], tools: null }],
    });
    expect(bodyOf(form, true).mcp_servers?.[0]).not.toHaveProperty("tools");
  });

  it("carries the computer profile, the numbers and the lists in the service's shape", () => {
    const body = bodyOf(validForm({ allowedChannels: "api, email", setupCommands: '[["/usr/bin/a","b"]]', readyCheck: '["ok"]', takeoverAllowed: true }), false);
    expect(body).toMatchObject({
      name: "Desk agent",
      computer: { runtime: "docker", template: "cm-desktop-agent", egress: "none", timeout_s: 3600 },
      max_wait_s: 900,
      takeover_allowed: true,
      allowed_channels: ["api", "email"],
      setup_commands: [["/usr/bin/a", "b"]],
      ready_check: ["ok"],
    });
  });

  it("throws the first problem rather than sending an invalid form", () => {
    expect(() => bodyOf(BLANK_FORM, false)).toThrow("Name is required");
  });
});

describe("the recording settings", () => {
  it("leaves out each recording setting nobody set", () => {
    const body = bodyOf(validForm(), false);
    expect(body).not.toHaveProperty("recording");
    expect(body).not.toHaveProperty("recording_retention_days");
    expect(body).not.toHaveProperty("recording_required");
    expect(body).not.toHaveProperty("recording_pause_on_text");
  });

  it("sends each recording setting the person set, with the retention as a number", () => {
    const body = bodyOf(
      validForm({ recording: true, recordingRetentionDays: "14", recordingRequired: false, recordingPauseOnText: true }),
      false,
    );
    expect(body).toMatchObject({
      recording: true,
      recording_retention_days: 14,
      recording_required: false,
      recording_pause_on_text: true,
    });
  });

  it("sends a recording setting the loaded definition had, even when nothing changed", () => {
    const loaded = agentJson({ recording: false, recording_retention_days: 45 });
    expect(bodyOf(formOf(loaded), false)).toMatchObject({ recording: false, recording_retention_days: 45 });
    expect(bodyOf(formOf(loaded), false)).not.toHaveProperty("recording_required");
  });

  it("reads an absent recording setting as unset, not as off", () => {
    expect(formOf(agentJson())).toMatchObject({ recording: null, recordingRetentionDays: null, recordingRequired: null });
  });

  it("refuses a retention that is not a whole number of at least one, and accepts none", () => {
    expect(validateAgentForm(validForm({ recordingRetentionDays: "0" }), false).recordingRetentionDays).toBe(
      "Use a whole number of at least 1",
    );
    expect(validateAgentForm(validForm({ recordingRetentionDays: "" }), false).recordingRetentionDays).toBeTruthy();
    expect(validateAgentForm(validForm({ recordingRetentionDays: "2.5" }), false).recordingRetentionDays).toBeTruthy();
    expect(validateAgentForm(validForm({ recordingRetentionDays: "1" }), false).recordingRetentionDays).toBeUndefined();
    expect(validateAgentForm(validForm(), false).recordingRetentionDays).toBeUndefined();
  });
});

describe("a saved agent", () => {
  it("shows env names with no values, so a re-saved list needs the values again", () => {
    const saved = agentJson({
      mcp_servers: [{ name: "api", command: "api-mcp", args: [], env: [{ name: "TOKEN" }], tools: "indexed" }],
    });
    const form = formOf(saved);
    expect(form.servers[0]?.env).toEqual([{ name: "TOKEN", value: null }]);
    expect(form.servers[0]?.tools).toBe("indexed");
    expect(form.runtime).toBe("e2b");
  });

  it("changes its signature when a server's name, command or listing mode changes, not its env values", () => {
    const base = formOf(agentJson({ mcp_servers: [{ name: "api", command: "api-mcp", args: [], env: [{ name: "TOKEN" }], tools: null }] }));
    const key = base.servers[0]?.key ?? "";
    const withValue = setEnvValue(base, key, "TOKEN", "secret");
    expect(serversSignature(withValue.servers)).toBe(serversSignature(base.servers));
    const moded = setServerTools(base, key, "full");
    expect(serversSignature(moded.servers)).not.toBe(serversSignature(base.servers));
  });

  it("removes a server row", () => {
    const form = addCatalogTool(validForm(), browserTool);
    const key = form.servers[0]?.key ?? "";
    expect(removeServer(form, key).servers).toEqual([]);
  });
});

describe("templates", () => {
  it("starts a form from a template, with its tools as server rows", () => {
    const browserAgent = TEMPLATES.find((template) => template.id === "browser-agent");
    if (!browserAgent) throw new Error("the template catalog must ship the browser agent");
    const form = formFromTemplate(browserAgent);
    expect(form).toMatchObject({ name: "Browser agent", runtime: "e2b", template: "cm-desktop-agent", takeoverAllowed: true });
    expect(form.servers.map((server) => server.name)).toEqual(["browser"]);
    expect(validateAgentForm(form, false)).toEqual({});
  });

  it("refuses a template that names a tool the catalog does not have", () => {
    const template = TEMPLATES[0];
    if (!template) throw new Error("no template");
    expect(() => formFromTemplate({ ...template, agent: { ...template.agent, tools: ["nope"] } }, TOOLS)).toThrow(
      'The template names an unknown tool "nope"',
    );
  });
});
