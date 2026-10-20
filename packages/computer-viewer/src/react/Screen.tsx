import { useEffect, useRef } from "react";
import type { ReactElement } from "react";
import type { ViewerClient } from "../client/client";
import type { TransportChoice } from "../client/types";

/** Props of {@link Screen}. */
export interface ScreenProps {
  client: ViewerClient;
  transport: TransportChoice;
}

/**
 * The live screen. It opens through the client when mounted and closes when unmounted or when the
 * client or transport changes. The container stays empty of React children, because the screen
 * draws into it directly (noVNC or a canvas).
 */
export function Screen({ client, transport }: ScreenProps): ReactElement {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return undefined;
    let cancelled = false;
    let source: { close(): void } | undefined;
    // A failure is reported through the client's error event; the screen just stays empty.
    client.openScreen({ transport, container }).then(
      (opened) => {
        if (cancelled) opened.close();
        else source = opened;
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
      source?.close();
    };
  }, [client, transport]);

  return <div ref={ref} className="cv-screen" />;
}
