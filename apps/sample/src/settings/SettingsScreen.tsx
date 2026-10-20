import type { ReactElement } from "react";
import type { TransportChoice } from "@cm/computer-viewer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { THEMES } from "../theme";
import type { Theme } from "../theme";

/** Props of {@link SettingsScreen}. */
export interface SettingsScreenProps {
  readonly theme: Theme;
  readonly onThemeChange: (theme: Theme) => void;
  readonly transport: TransportChoice;
  readonly viewerBaseUrl: string;
  /** The same-origin mount the run API is called on. The dev server forwards it to the run service. */
  readonly runApiBase: string;
  /** The same-origin mount the agent registry is called on. */
  readonly agentsApiBase: string;
}

/** The labels of the theme choices. */
const THEME_LABEL: Record<Theme, string> = { system: "System", light: "Light", dark: "Dark" };

/**
 * The settings: the colour theme (kept in this browser) and the endpoints the page uses. The endpoints come
 * from the build and the dev server, so they are shown and not edited here.
 */
export function SettingsScreen({
  theme,
  onThemeChange,
  transport,
  viewerBaseUrl,
  runApiBase,
  agentsApiBase,
}: SettingsScreenProps): ReactElement {
  const endpoints: readonly (readonly [string, string])[] = [
    ["Run API", runApiBase],
    ["Agent registry", agentsApiBase],
    ["Viewer", viewerBaseUrl],
    ["Screen transport", transport],
  ];
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h1 className="text-lg font-semibold">Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Theme</CardTitle>
        </CardHeader>
        <CardContent>
          <div role="group" aria-label="Theme" className="inline-flex gap-1 rounded-lg border border-border p-1">
            {THEMES.map((choice) => (
              <Button
                key={choice}
                type="button"
                size="sm"
                variant={theme === choice ? "default" : "ghost"}
                aria-pressed={theme === choice}
                onClick={() => onThemeChange(choice)}
              >
                {THEME_LABEL[choice]}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Endpoints</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
            {endpoints.map(([name, value]) => (
              <div key={name} className="contents">
                <dt className="text-muted-foreground">{name}</dt>
                <dd className="break-all font-mono text-xs">{value === "" ? "same origin" : value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
