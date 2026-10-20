import { useState } from "react";
import type { ReactElement } from "react";
import { ComputerViewer } from "@cm/computer-viewer/react";
import type { TransportChoice, ViewerSession } from "@cm/computer-viewer";

/** Props of {@link App}. */
export interface AppProps {
  /** The session read from the fragment, or `null` when the link carries none. */
  session: ViewerSession | null;
  transport: TransportChoice;
}

/**
 * The standalone page. It shows the viewer for the session in the link. A control link gets a
 * Release button that ends the page's session; there is no Take control here, because a control
 * session can only be minted by the host's backend.
 */
export function App({ session, transport }: AppProps): ReactElement {
  const [released, setReleased] = useState(false);

  if (!session) {
    return <p role="alert">This viewer link has no session.</p>;
  }
  if (released) {
    return <p role="status">Released. You can close this page.</p>;
  }
  return (
    <ComputerViewer
      session={session}
      transport={transport}
      onRelease={session.mode === "control" ? () => setReleased(true) : undefined}
    />
  );
}
