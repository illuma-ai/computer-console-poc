import { describe, expect, it } from "vitest";
import {
  CatalogError,
  readScenarioCatalog,
  readTemplateCatalog,
  readToolCatalog,
  SCENARIOS,
  TEMPLATES,
  TOOLS,
} from "../../src/catalog/catalog";
import { RUNTIMES } from "../../src/agents/agentForm";

/** A valid tool entry, to change one field at a time. */
function tool(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "docs",
    name: "Docs",
    description: "Docs server",
    server: { name: "docs", command: "docs-mcp", args: [], env: [] },
    tools: "indexed",
    ...overrides,
  };
}

/** A valid template entry that uses the given tool id. */
function template(overrides: Record<string, unknown> = {}, agent: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "desk",
    name: "Desk",
    description: "A desk agent",
    agent: {
      description: "Works on a desk",
      instructions: "Do it",
      model: null,
      computer: { runtime: "docker", template: "agent-computer", egress: "none", timeout_s: 3600 },
      max_wait_s: 900,
      takeover_allowed: false,
      allowed_channels: ["api"],
      setup_commands: [],
      ready_check: null,
      tools: ["docs"],
      ...agent,
    },
    ...overrides,
  };
}

describe("the shipped catalogs", () => {
  it("load, with unique ids in each", () => {
    for (const list of [TOOLS, TEMPLATES, SCENARIOS]) {
      const ids = list.map((entry) => entry.id);
      expect(ids.length).toBeGreaterThan(0);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("only name runtimes the form offers", () => {
    for (const entry of TEMPLATES) {
      expect(RUNTIMES).toContain(entry.agent.computer.runtime);
    }
  });

  it("name the GitHub sign-in scenario by its real service name, under a generic id", () => {
    const github = SCENARIOS.find((entry) => entry.title === "Sign in to GitHub");
    expect(github).toBeDefined();
    expect(github?.prompt).toContain("GitHub");
    expect(github?.id).toBe("sign-in-code-host");
  });

  it("gives every template a tool list that resolves against the tool catalog", () => {
    const ids = new Set(TOOLS.map((entry) => entry.id));
    for (const entry of TEMPLATES) {
      for (const toolId of entry.agent.tools) expect(ids.has(toolId)).toBe(true);
    }
  });
});

describe("readToolCatalog", () => {
  it("reads a valid entry", () => {
    expect(readToolCatalog([tool()])).toEqual([
      {
        id: "docs",
        name: "Docs",
        description: "Docs server",
        server: { name: "docs", command: "docs-mcp", args: [], env: [] },
        tools: "indexed",
      },
    ]);
  });

  it("names the file for a non-array", () => {
    expect(() => readToolCatalog({})).toThrow(CatalogError);
    expect(() => readToolCatalog({})).toThrow("tools.json: must be a JSON array");
  });

  it("refuses a duplicate id and names it", () => {
    expect(() => readToolCatalog([tool(), tool()])).toThrow('tools.json: duplicate id "docs"');
  });

  it("refuses an entry without an id", () => {
    expect(() => readToolCatalog([tool({ id: "  " })])).toThrow('tools.json: entry 0 needs a non-empty "id"');
  });

  it("refuses a listing mode other than full or indexed", () => {
    expect(() => readToolCatalog([tool({ tools: "all" })])).toThrow('entry "docs": "tools" must be "full" or "indexed"');
  });

  it("refuses env values in the catalog, which holds names only", () => {
    const server = { name: "docs", command: "docs-mcp", args: [], env: [{ name: "KEY", value: "secret" }] };
    expect(() => readToolCatalog([tool({ server })])).toThrow('"server.env" must list names only');
  });
});

describe("readTemplateCatalog", () => {
  it("refuses a template that names a tool the catalog does not have", () => {
    expect(() => readTemplateCatalog([template({}, { tools: ["nope"] })], readToolCatalog([tool()]))).toThrow(
      'templates.json: entry "desk": names unknown tools: nope',
    );
  });

  it("refuses a template with a non-boolean take-over flag", () => {
    expect(() => readTemplateCatalog([template({}, { takeover_allowed: "yes" })], readToolCatalog([tool()]))).toThrow(
      'entry "desk": "takeover_allowed" must be true or false',
    );
  });

  it("reads a valid template against the tool catalog", () => {
    const [entry] = readTemplateCatalog([template()], readToolCatalog([tool()]));
    expect(entry).toMatchObject({ id: "desk", name: "Desk", agent: { tools: ["docs"], ready_check: null } });
  });
});

describe("readScenarioCatalog", () => {
  it("reads scenarios with a title and a prompt", () => {
    expect(readScenarioCatalog([{ id: "s1", title: "One", prompt: "Do one" }])).toEqual([{ id: "s1", title: "One", prompt: "Do one" }]);
  });

  it("refuses a scenario without a prompt", () => {
    expect(() => readScenarioCatalog([{ id: "s1", title: "One" }])).toThrow('scenarios.json: entry "s1": "prompt" must be a non-empty string');
  });
});
