import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import type { TransportChoice } from "@cm/computer-viewer";
import type { AgentsApi } from "./api/agentsApi";
import { AGENTS_API_BASE } from "./api/agentsApi";
import type { RunApi } from "./api/runApi";
import { RUN_API_BASE } from "./api/runApi";
import { AgentsScreen } from "./agents/AgentsScreen";
import { AppShell } from "./shell/AppShell";
import type { KeyValueStorage } from "./storage";
import { RunScreen } from "./run/RunScreen";
import { RunsScreen } from "./runs/RunsScreen";
import { SettingsScreen } from "./settings/SettingsScreen";
import { parseRoute } from "./routes";
import type { Route } from "./routes";
import { applyTheme, loadTheme, saveTheme } from "./theme";
import type { Theme } from "./theme";

/** Props of {@link App}. */
export interface AppProps {
  readonly api: RunApi;
  /** The agent registry (`/v1/agents`). */
  readonly agentsApi: AgentsApi;
  readonly storage: KeyValueStorage | null;
  readonly transport: TransportChoice;
  readonly viewerBaseUrl: string;
}

/** The query that matches the operating system's dark preference. */
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** The current route, from the hash, kept in step with it. */
function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onHashChange = (): void => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  return route;
}

/** Whether the operating system prefers dark. False where the browser has no media query support. */
function useSystemPrefersDark(): boolean {
  const [prefersDark, setPrefersDark] = useState<boolean>(() => matchesDark());
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia(DARK_QUERY);
    const onChange = (): void => setPrefersDark(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return prefersDark;
}

function matchesDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches;
}

/**
 * The operator console: the navigation, and the agents, runs, run and settings screens. Every screen calls
 * the run API and the agent registry through the props, so the page holds no credential and no copy of a
 * definition.
 */
export function App({ api, agentsApi, storage, transport, viewerBaseUrl }: AppProps): ReactElement {
  const route = useRoute();
  const prefersDark = useSystemPrefersDark();
  const [theme, setThemeState] = useState<Theme>(() => loadTheme(storage));

  useEffect(() => {
    applyTheme(theme, document.documentElement, prefersDark);
  }, [theme, prefersDark]);

  function setTheme(next: Theme): void {
    setThemeState(next);
    saveTheme(storage, next);
  }

  return (
    <AppShell route={route}>
      {route.name === "agents" ? <AgentsScreen agents={agentsApi} /> : null}
      {route.name === "runs" ? <RunsScreen api={api} agents={agentsApi} storage={storage} /> : null}
      {route.name === "run" ? (
        <RunScreen
          key={route.runId}
          runId={route.runId}
          api={api}
          agents={agentsApi}
          transport={transport}
          viewerBaseUrl={viewerBaseUrl}
        />
      ) : null}
      {route.name === "settings" ? (
        <SettingsScreen
          theme={theme}
          onThemeChange={setTheme}
          transport={transport}
          viewerBaseUrl={viewerBaseUrl}
          runApiBase={RUN_API_BASE}
          agentsApiBase={AGENTS_API_BASE}
        />
      ) : null}
    </AppShell>
  );
}
