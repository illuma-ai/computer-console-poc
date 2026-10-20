import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@cm/computer-viewer/react/styles.css";
import { App } from "./App";
import { readTransport } from "./config";
import { clearFragment, parseViewerFragment } from "./fragment";
import type { ViewerSession } from "@cm/computer-viewer";

// WHY read and clear before rendering: the token then lives only in this module's memory, and the
// address bar and history no longer show it, even if the render fails.
const session: ViewerSession | null = (() => {
  try {
    return parseViewerFragment(window.location.hash);
  } finally {
    clearFragment(window);
  }
})();

const container = document.getElementById("root");
if (!container) throw new Error("The page has no root element");

createRoot(container).render(
  <StrictMode>
    <main className="viewer-page">
      <App session={session} transport={readTransport(import.meta.env.VITE_VIEWER_TRANSPORT)} />
    </main>
  </StrictMode>,
);
