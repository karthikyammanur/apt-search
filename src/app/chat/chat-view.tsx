"use client";

// The chat column from docs/ui/Chat.dc.html. My messages are grey bubbles on the right; replies
// are plain text. Listing rows, cards, drafts, weight changes and the settings button are drawn
// from tool results only, so no number on screen comes from model text.

import { DefaultChatTransport } from "ai";
import { useEffect, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import type {
  ChatEvent,
  DraftOutput,
  FeedbackOutput,
  ListingCard,
  ListingRow,
  SettingsProposal,
  ToolEvent,
} from "@/lib/agent/types";
import { applySettingsAction, undoFeedbackAction } from "./actions";

export type ChatEntry =
  | { role: "user"; key: string; text: string }
  | {
      role: "assistant";
      key: string;
      messageId: number | null;
      text: string;
      tools: ToolEvent[];
      notice: string | null;
      pending: boolean;
      error?: string | null;
    };

type AssistantEntry = Extract<ChatEntry, { role: "assistant" }>;

const BUCKET_WORDS: Record<string, string> = { pass: "Passes", likely: "Likely", needs_info: "Needs info", fail: "Fails" };

const ok = (output: unknown): output is { ok: true } & Record<string, unknown> =>
  typeof output === "object" && output !== null && (output as { ok?: unknown }).ok === true;

function Paragraphs({ text }: { text: string }) {
  const parts = text.split(/\n{2,}/).filter((p) => p.trim());
  return (
    <>
      {parts.map((p, i) => (
        <p key={i} className="m-0 whitespace-pre-wrap [&+p]:mt-3">
          {p}
        </p>
      ))}
    </>
  );
}

function Bucket({ bucket }: { bucket: string | null }) {
  if (!bucket) return <span className="text-attention">Not checked yet</span>;
  return (
    <span className="bucket" data-bucket={bucket}>
      {BUCKET_WORDS[bucket] ?? bucket}
    </span>
  );
}

function Value({ text }: { text: string }) {
  return text === "Unknown" ? <span className="text-attention">Unknown</span> : <>{text}</>;
}

function Rows({ rows }: { rows: ListingRow[] }) {
  if (rows.length === 0) return <p className="m-0 mt-3 text-sm text-muted-foreground">No listings match.</p>;
  return (
    <ul className="m-0 mt-3 list-none border-t border-line p-0" aria-label="Listings">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-b border-line py-3">
          <a href={`/listing/${row.id}`} className="min-w-0 flex-1 no-underline hover:text-primary">
            {row.title ?? `Listing ${row.id}`}
          </a>
          <span className="text-sm text-muted-foreground">
            <Value text={row.allInMonthly} /> · <Value text={row.commute} /> · <Bucket bucket={row.bucket} />
            {row.score !== null ? <span className="ml-2 text-primary">{row.score}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Card({ card }: { card: ListingCard }) {
  return (
    <section aria-label="Added listing" data-testid="listing-card" className="mt-3 border-t border-b border-line py-4">
      <a href={`/listing/${card.id}`} className="font-medium no-underline hover:text-primary">
        {card.title ?? `Listing ${card.id}`}
      </a>
      <dl className="m-0 mt-2 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
        <dt className="text-muted-foreground">All-in monthly</dt>
        <dd className="m-0" data-testid="card-cost">
          <Value text={card.allInMonthly} />
        </dd>
        <dt className="text-muted-foreground">Commute</dt>
        <dd className="m-0" data-testid="card-commute">
          <Value text={card.commute} />
        </dd>
        <dt className="text-muted-foreground">Bucket</dt>
        <dd className="m-0">
          <Bucket bucket={card.bucket} />
        </dd>
      </dl>
      {card.note ? <p className="m-0 mt-2 text-sm text-muted-foreground">{card.note}</p> : null}
    </section>
  );
}

function Draft({ draft }: { draft: DraftOutput }) {
  const [copied, setCopied] = useState(false);
  return (
    <section aria-label={`Draft to ${draft.to}`} className="mt-3">
      <p className="m-0 text-sm text-muted-foreground">Draft to {draft.to}. You send it yourself.</p>
      <pre className="m-0 mt-2 whitespace-pre-wrap rounded-field border border-field p-4 font-sans text-[15px]">{draft.text}</pre>
      <button
        type="button"
        className="mt-2 min-h-touch rounded-[10px] border border-field bg-bg px-4 text-sm font-medium text-ink"
        onClick={() => {
          void navigator.clipboard?.writeText(draft.text).then(() => setCopied(true), () => setCopied(false));
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </section>
  );
}

function WeightLine({ feedback, undone }: { feedback: FeedbackOutput; undone: boolean }) {
  const [state, setState] = useState<{ done: boolean; text: string | null }>({ done: undone, text: null });
  const [busy, start] = useTransition();
  return (
    <p className="m-0 mt-1.5 text-sm text-muted-foreground" data-testid="weight-change">
      {state.text ?? feedback.summary}{" "}
      {state.done ? (
        state.text ? null : <span>Undone.</span>
      ) : (
        <button
          type="button"
          disabled={busy}
          className="min-h-touch border-0 bg-transparent p-0 text-sm text-muted-foreground underline"
          onClick={() =>
            start(async () => {
              const result = await undoFeedbackAction(feedback.eventId);
              setState(result.ok ? { done: true, text: result.summary } : { done: false, text: `${feedback.summary} (${result.error})` });
            })
          }
        >
          Undo
        </button>
      )}
    </p>
  );
}

function SettingsConfirm({ proposal, messageId, toolCallId, applied }: { proposal: SettingsProposal; messageId: number | null; toolCallId: string; applied: boolean }) {
  const [state, setState] = useState<{ done: boolean; text: string | null }>({ done: applied, text: applied ? "Applied." : null });
  const [busy, start] = useTransition();
  return (
    <section aria-label="Proposed settings change" className="mt-3">
      <ul className="m-0 list-none p-0 text-sm">
        {proposal.changes.map((c) => (
          <li key={c.key}>
            {c.label}: {c.from} to {c.to}
          </li>
        ))}
      </ul>
      {state.done ? (
        <p className="m-0 mt-2 text-sm text-muted-foreground">{state.text}</p>
      ) : (
        <>
          <button
            type="button"
            disabled={busy || messageId === null}
            className="mt-2 min-h-touch rounded-[10px] border border-field bg-bg px-4 text-sm font-medium text-ink"
            onClick={() =>
              messageId !== null &&
              start(async () => {
                const result = await applySettingsAction(messageId, toolCallId);
                setState(result.ok ? { done: true, text: result.summary } : { done: false, text: result.error });
              })
            }
          >
            Apply this change
          </button>
          {state.text ? <p className="m-0 mt-1 text-sm text-attention">{state.text}</p> : null}
        </>
      )}
    </section>
  );
}

function ToolView({ tool, entry, applied, undone }: { tool: ToolEvent; entry: AssistantEntry; applied: Set<string>; undone: Set<number> }) {
  const out = tool.output;
  if (!ok(out)) {
    const error = (out as { error?: string } | null)?.error ?? "failed";
    return <p className="m-0 mt-1.5 text-sm text-muted-foreground">Could not {tool.toolName.replaceAll("_", " ")}: {error}.</p>;
  }
  switch (tool.toolName) {
    case "search_listings":
      return <Rows rows={out.rows as ListingRow[]} />;
    case "compare_listings":
      return <Rows rows={out.listings as ListingRow[]} />;
    case "add_listing_from_text":
      return <Card card={out.card as ListingCard} />;
    case "draft_message":
      return <Draft draft={out as unknown as DraftOutput} />;
    case "give_feedback":
      return <WeightLine feedback={out as unknown as FeedbackOutput} undone={undone.has((out as unknown as FeedbackOutput).eventId)} />;
    case "undo_feedback":
      return <p className="m-0 mt-1.5 text-sm text-muted-foreground">{String(out.summary)}</p>;
    case "propose_settings_change":
      return (
        <SettingsConfirm
          proposal={out as unknown as SettingsProposal}
          messageId={entry.messageId}
          toolCallId={tool.toolCallId}
          applied={entry.messageId !== null && applied.has(`${entry.messageId}:${tool.toolCallId}`)}
        />
      );
    case "set_listing_status":
      return (
        <p className="m-0 mt-1.5 text-sm text-muted-foreground">
          {out.status === "rejected" ? "Rejected" : "Shortlisted"}: {String(out.reason ?? "")}
        </p>
      );
    case "record_fact": {
      const before = out.before as { allInMonthly: string; bucket: string };
      const after = out.after as { allInMonthly: string; bucket: string };
      return (
        <p className="m-0 mt-1.5 text-sm text-muted-foreground">
          Saved {String(out.field)}. All-in {before.allInMonthly} to {after.allInMonthly}, {BUCKET_WORDS[before.bucket] ?? before.bucket} to{" "}
          {BUCKET_WORDS[after.bucket] ?? after.bucket}.
        </p>
      );
    }
    default:
      return null;
  }
}

const transport = new DefaultChatTransport({ api: "/api/chat" });

/** Send one message through the AI SDK transport and hand each of our events to `onEvent`. */
async function streamTurn(text: string, onEvent: (event: ChatEvent) => void) {
  const stream = await transport.sendMessages({
    trigger: "submit-message",
    chatId: "main",
    messageId: undefined,
    messages: [],
    abortSignal: undefined,
    body: { text },
  });
  const reader = stream.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value.type === "data-event") onEvent(value.data as ChatEvent);
    else if (value.type === "error") onEvent({ type: "error", text: value.errorText });
  }
}

export function ChatView({ initial, applied, undone }: { initial: ChatEntry[]; applied: string[]; undone: number[] }) {
  const [entries, setEntries] = useState<ChatEntry[]>(initial);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const appliedSet = new Set(applied);
  const undoneSet = new Set(undone);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [entries]);

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [draft]);

  async function send(text: string) {
    const key = `local-${Date.now()}`;
    const update = (fn: (a: AssistantEntry) => AssistantEntry) =>
      setEntries((list) => list.map((e) => (e.key === `${key}-a` && e.role === "assistant" ? fn(e) : e)));
    setEntries((list) => [
      ...list,
      { role: "user", key: `${key}-u`, text },
      { role: "assistant", key: `${key}-a`, messageId: null, text: "", tools: [], notice: null, pending: true },
    ]);
    setBusy(true);
    try {
      await streamTurn(text, (event) => {
        if (event.type === "text") update((a) => ({ ...a, text: a.text + event.text }));
        else if (event.type === "tool") update((a) => ({ ...a, tools: [...a.tools, event.tool] }));
        else if (event.type === "notice") update((a) => ({ ...a, notice: event.text }));
        else if (event.type === "error") update((a) => ({ ...a, error: event.text }));
        else if (event.type === "done") update((a) => ({ ...a, messageId: event.messageId, pending: false }));
      });
    } catch (error) {
      const signedOut = error instanceof Error && /Not signed in/.test(error.message);
      update((a) => ({ ...a, error: signedOut ? "You are signed out. Reload to sign in." : "The chat failed. Try again." }));
    } finally {
      update((a) => ({ ...a, pending: false }));
      setBusy(false);
    }
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    void send(text);
  }

  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) submit(event);
  }

  return (
    <>
      <main className="mx-auto flex w-full max-w-column flex-1 flex-col gap-7 px-6 pt-10 text-[15px] leading-relaxed" aria-live="polite">
        {entries.length === 0 ? (
          <p className="m-0 text-muted-foreground">Ask about your listings, tell me what you think of one, or paste a post to add it.</p>
        ) : null}
        {entries.map((entry) =>
          entry.role === "user" ? (
            <div key={entry.key} className="max-w-[80%] self-end whitespace-pre-wrap break-words rounded-[18px] bg-fill px-4 py-2.5" data-testid="user-message">
              {entry.text}
            </div>
          ) : (
            <div key={entry.key} data-testid="assistant-message">
              {entry.text ? <Paragraphs text={entry.text} /> : null}
              {entry.tools.map((tool) => (
                <ToolView key={tool.toolCallId} tool={tool} entry={entry} applied={appliedSet} undone={undoneSet} />
              ))}
              {entry.pending && !entry.text && entry.tools.length === 0 ? <p className="m-0 text-muted-foreground">Thinking…</p> : null}
              {entry.notice && !entry.error ? <p className="m-0 mt-1.5 text-sm text-muted-foreground">{entry.notice}</p> : null}
              {entry.error ? <p className="m-0 mt-1.5 text-sm text-attention">{entry.error}</p> : null}
            </div>
          ),
        )}
        <div ref={bottom} />
      </main>
      <form onSubmit={submit} className="sticky bottom-0 mx-auto flex w-full max-w-column items-end gap-2.5 bg-bg px-6 pb-8 pt-6">
        <label htmlFor="ask" className="sr-only">
          Message
        </label>
        <textarea
          id="ask"
          ref={input}
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          placeholder="Ask anything, or paste a listing"
          className="min-h-[52px] min-w-0 flex-1 resize-none rounded-[26px] border border-field bg-bg px-[18px] py-[14px] text-[15px] leading-[22px] text-ink outline-none focus:border-ink"
        />
        <button type="submit" disabled={busy} className="min-h-[52px] rounded-[26px] border-0 bg-ink px-[22px] text-[15px] font-medium text-white disabled:opacity-60">
          Send
        </button>
      </form>
    </>
  );
}
