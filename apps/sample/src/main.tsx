import { createRoot } from "react-dom/client";
import "@cm/computer-viewer/react/styles.css";
import "./index.css";
import { App } from "./App";
import { createAgentsApi } from "./api/agentsApi";
import { createRunApi } from "./api/runApi";
import { browserStorage } from "./storage";
import { readTransport } from "./config";

const container = document.getElementById("root");
if (!container) throw new Error("the page has no #root element");

// WHY the viewer base is this origin: the dev server proxies the viewer's calls under /view, so the
// browser never names the manager's public listener.
createRoot(container).render(
  <App
    api={createRunApi()}
    agentsApi={createAgentsApi()}
    storage={browserStorage()}
    transport={readTransport(import.meta.env.VITE_VIEWER_TRANSPORT)}
    viewerBaseUrl={window.location.origin}
  />,
);
