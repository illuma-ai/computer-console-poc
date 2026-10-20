import type { ReactElement, ReactNode } from "react";
import { Bot, ListChecks, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import type { Route } from "../routes";
import { routeHash } from "../routes";

/** The top-level screens the left navigation links to. A run is reached from the runs list, not from the nav. */
export type NavScreen = "agents" | "runs" | "settings";

interface NavItem {
  readonly screen: NavScreen;
  readonly label: string;
  readonly icon: LucideIcon;
}

/** The navigation, in the order it is shown. */
export const NAV_ITEMS: readonly NavItem[] = [
  { screen: "agents", label: "Agents", icon: Bot },
  { screen: "runs", label: "Runs", icon: ListChecks },
  { screen: "settings", label: "Settings", icon: Settings },
];

/**
 * The screen a route belongs to in the navigation. A run's view sits under Runs, so the Runs link stays active.
 *
 * @param route The current route.
 */
export function navScreenOf(route: Route): NavScreen {
  return route.name === "run" ? "runs" : route.name;
}

/** Props of {@link AppShell}. */
export interface AppShellProps {
  readonly route: Route;
  readonly children: ReactNode;
}

/**
 * The page frame: a left navigation and the current screen. The links are plain anchors to hash routes, so
 * they are keyboard reachable and a reload or a shared link lands on the same screen.
 */
export function AppShell({ route, children }: AppShellProps): ReactElement {
  const current = navScreenOf(route);
  return (
    <div className="flex min-h-svh bg-background text-foreground">
      <nav aria-label="Main" className="flex w-52 shrink-0 flex-col gap-1 border-r border-border p-3">
        <p className="px-2 pb-3 pt-1 text-sm font-semibold tracking-tight">Computer manager</p>
        <Separator className="mb-2" />
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = item.screen === current;
          return (
            <a
              key={item.screen}
              href={routeHash({ name: item.screen })}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon className="size-4" aria-hidden="true" />
              {item.label}
            </a>
          );
        })}
      </nav>
      <main className="min-w-0 flex-1 p-6">{children}</main>
    </div>
  );
}
