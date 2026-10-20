import { useState } from "react";
import type { FormEvent, ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { AnswerBody } from "../api/runApi";
import type { RequestOption, RunRequest } from "../api/types";
import { isWebUrl } from "../safeUrl";

/**
 * The card a request is shown in. One renderer dispatches on the request's kind, so a screen never names a
 * scenario: the take-over, approval and question kinds are the ones the run service sends today.
 *
 * A kind the sample does not know shows its title and its options, if it has any. That keeps a new kind
 * answerable by its options, and never leaves the person without a way out.
 */

/** Props of {@link RequestCard}. */
export interface RequestCardProps {
  readonly request: RunRequest;
  /** True when this person holds the take-over's lease (the computer is theirs to use). */
  readonly held: boolean;
  /** True when no take-over is held by anyone, so this one may be taken. */
  readonly canTakeControl: boolean;
  /** True while a call for this card is in flight. */
  readonly busy: boolean;
  readonly onAnswer: (body: AnswerBody) => void;
  readonly onTakeControl: () => void;
  readonly onRelease: (done: boolean) => void;
}

/** The heading each kind carries, which is also the card's accessible name. */
export function cardLabel(kind: string): string {
  switch (kind) {
    case "takeover":
      return "Take-over request";
    case "approval":
      return "Approval request";
    case "question":
      return "Question";
    default:
      return "Request";
  }
}

/** Renders the card for one open request. */
export function RequestCard(props: RequestCardProps): ReactElement {
  const { request } = props;
  const label = cardLabel(request.kind);
  return (
    <Card aria-label={label} className="gap-3 py-4 shadow-sm">
      <CardHeader className="px-4">
        <CardTitle className="text-sm font-medium">{request.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4">
        {request.kind === "takeover" ? <TakeoverBody {...props} /> : <OptionsBody {...props} />}
        {request.kind === "question" ? <AnswerText {...props} /> : null}
      </CardContent>
    </Card>
  );
}

/** The take-over: the reason, a link when the agent sent one, and Take control, or Done and Can't do it. */
function TakeoverBody({ request, held, canTakeControl, busy, onTakeControl, onRelease }: RequestCardProps): ReactElement {
  const reason = typeof request.meta["reason"] === "string" ? request.meta["reason"] : null;
  const url = typeof request.meta["url"] === "string" && isWebUrl(request.meta["url"]) ? request.meta["url"] : null;
  return (
    <>
      {reason ? <p className="text-sm text-muted-foreground">{reason}</p> : null}
      {url ? (
        <a className="text-sm underline underline-offset-4" href={url} target="_blank" rel="noopener noreferrer">
          Open page
        </a>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {held ? (
          <>
            <Button type="button" size="sm" disabled={busy} onClick={() => onRelease(true)}>
              Done
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onRelease(false)}>
              Can&apos;t do it
            </Button>
          </>
        ) : canTakeControl ? (
          <Button type="button" size="sm" disabled={busy} onClick={onTakeControl}>
            Take control
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">Another person has the computer.</p>
        )}
      </div>
    </>
  );
}

/** The options as buttons. A reject-like option is outlined, so the way to say no is easy to tell apart. */
function OptionsBody({ request, busy, onAnswer }: RequestCardProps): ReactElement | null {
  if (request.options.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {request.options.map((option) => (
        <Button
          key={option.id}
          type="button"
          size="sm"
          variant={isRejection(option) ? "outline" : "default"}
          disabled={busy}
          onClick={() => onAnswer({ option_id: option.id })}
        >
          {option.name}
        </Button>
      ))}
    </div>
  );
}

/** A question accepts a text answer as well as its options. The text goes under the first option, as the service expects. */
function AnswerText({ busy, onAnswer }: RequestCardProps): ReactElement {
  const [text, setText] = useState("");
  const trimmed = text.trim();
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (trimmed === "" || busy) return;
    onAnswer({ text: trimmed });
    setText("");
  }
  return (
    <form aria-label="Answer the question" className="flex gap-2" onSubmit={submit}>
      <Input
        aria-label="Your answer"
        placeholder="Type an answer"
        value={text}
        disabled={busy}
        onChange={(event) => setText(event.target.value)}
      />
      <Button type="submit" size="sm" disabled={busy || trimmed === ""}>
        Send
      </Button>
    </form>
  );
}

/** A rejection by its kind, as the service names the options (`reject_once`, `reject_always`). */
function isRejection(option: RequestOption): boolean {
  return option.kind.startsWith("reject") || option.kind.startsWith("deny");
}
