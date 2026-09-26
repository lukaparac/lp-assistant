import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type FileUIPart, type UIMessage } from "ai";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, CopyIcon, FileTextIcon, PaperclipIcon, SearchIcon, XIcon } from "lucide-react";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Tool, ToolContent, ToolHeader } from "@/components/ai-elements/tool";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { clearDeskMessages, fetchHistory, fetchTurnCount } from "@/lib/desk.functions";
import { DESK_MODES, isModeId, modeLabel, modePlaceholder, type ModeId } from "@/lib/modes";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Marginalia — research & writing desk" },
      {
        name: "description",
        content:
          "Ask a question, attach a document, and get a sourced answer. Marginalia keeps the whole conversation on one desk.",
      },
      { property: "og:title", content: "Marginalia — research & writing desk" },
      {
        property: "og:description",
        content:
          "A personal research desk that searches the web, reads your documents, and drafts with your sources in reach.",
      },
    ],
  }),
  component: Desk,
});

const SUGGESTIONS = [
  {
    label: "Brief me",
    prompt:
      "Brief me on the state of small, open-weights language models right now. What changed in the last six months, and what should I actually care about?",
  },
  {
    label: "Draft",
    prompt:
      "Draft a 300-word note to a cautious client explaining why we'd rather ship a smaller thing this month than a bigger thing in the autumn.",
  },
  {
    label: "Compare",
    prompt:
      "Compare the practical trade-offs of renting a GPU versus running local inference for a part-time writing workflow. Give me numbers with dates.",
  },
];

/* ------------------------------------------------------------------ helpers */

type Part = UIMessage["parts"][number];

function textOf(message: UIMessage) {
  return (message.parts ?? [])
    .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function filesOf(message: UIMessage) {
  return (message.parts ?? []).filter(
    (part): part is Extract<Part, { type: "file" }> => part.type === "file",
  );
}

function readAsDataURL(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Composer attachments live as blob: URLs, which only exist in this tab.
// Read them back here so the bytes can travel to the server as data URLs.
function blobToDataURL(url: string) {
  return fetch(url)
    .then((response) => response.blob())
    .then(readAsDataURL);
}

async function toDataFileParts(parts: FileUIPart[]): Promise<FileUIPart[]> {
  return Promise.all(
    parts.map(async (part) => {
      const url = typeof part.url === "string" ? part.url : "";
      if (!url || url.startsWith("data:")) return part;
      return { ...part, url: await blobToDataURL(url) };
    }),
  );
}

function reasoningOf(message: UIMessage) {
  return (message.parts ?? []).filter(
    (part): part is Extract<Part, { type: "reasoning" }> => part.type === "reasoning",
  );
}

function toolsOf(message: UIMessage) {
  return (message.parts ?? []).filter(
    (part) => part.type.startsWith("tool-") || part.type === "dynamic-tool",
  );
}

function sourcesOf(message: UIMessage) {
  return (message.parts ?? []).filter(
    (part): part is Extract<Part, { type: "source-url" }> => part.type === "source-url",
  );
}

function metadataOf(message: UIMessage): Record<string, unknown> {
  return (message.metadata ?? {}) as Record<string, unknown>;
}

function modeOf(message: UIMessage): ModeId | undefined {
  const value = metadataOf(message)["mode"];
  return isModeId(value) ? value : undefined;
}

function timeOf(message: UIMessage, live: Record<string, string>): string | undefined {
  const stamped = metadataOf(message)["createdAt"];
  if (typeof stamped === "string") return stamped;
  return message.id ? live[message.id] : undefined;
}

function domainOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const clock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

function clockOf(iso?: string) {
  if (!iso) return undefined;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? undefined : clock.format(date);
}

function dayLabel(iso?: string) {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  const today = new Date();
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(date, today)) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(date, yesterday)) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "short",
  }).format(date);
}

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ------------------------------------------------------------------- loading */

type HistoryRow = {
  sdk_id: string;
  role: "user" | "assistant";
  content: UIMessage;
  created_at: string;
};

async function loadHistory(): Promise<UIMessage[]> {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("sdk_id, role, content, created_at")
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as HistoryRow[]).map((row) => {
    const content = row.content ?? ({} as UIMessage);
    return {
      ...content,
      id: content.id ?? row.sdk_id,
      role: row.role,
      metadata: { ...(content.metadata ?? {}), createdAt: row.created_at },
    } as UIMessage;
  });
}

async function countTurns(): Promise<number> {
  const { count, error } = await supabase
    .from("chat_messages")
    .select("id", { count: "exact", head: true })
    .eq("role", "user");

  if (error) throw new Error(error.message);
  return count ?? 0;
}

function Desk() {
  const history = useQuery({
    queryKey: ["chat-history"],
    queryFn: loadHistory,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  if (history.isPending) {
    return (
      <div className="flex h-dvh flex-col bg-paper">
        <div className="flex flex-1 items-center justify-center">
          <div className="font-mono text-[11px] tracking-wide text-ink-faint uppercase">
            <Shimmer>Opening the desk…</Shimmer>
          </div>
        </div>
      </div>
    );
  }

  if (history.isError) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-2 bg-paper px-6 text-center">
        <h1 className="text-base font-semibold text-ink">The desk didn't open</h1>
        <p className="max-w-sm text-sm text-ink-soft">
          Your saved conversation couldn't be read. Try reloading — nothing has been lost.
        </p>
      </div>
    );
  }

  return <DeskApp initial={history.data ?? []} />;
}

function DeskApp({ initial }: { initial: UIMessage[] }) {
  return (
    <PromptInputProvider>
      <DeskSurface initial={initial} />
    </PromptInputProvider>
  );
}

/* ---------------------------------------------------------------- the surface */

function DeskSurface({ initial }: { initial: UIMessage[] }) {
  const queryClient = useQueryClient();
  const { textInput, attachments } = usePromptInputController();

  const [mode, setMode] = useState<ModeId | undefined>(undefined);
  const modeRef = useRef<ModeId | undefined>(undefined);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/public/chat",
        body: () => ({ mode: modeRef.current ?? null }),
      }),
    [],
  );

  const chat = useChat({ id: "marginalia", messages: initial, transport });

  const [turns, setTurns] = useState<number | undefined>(undefined);
  const [liveTimes, setLiveTimes] = useState<Record<string, string>>({});
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const busy = chat.status === "submitted" || chat.status === "streaming";

  /* keep the saved-turn counter honest */
  const refreshTurns = useCallback(async () => {
    try {
      setTurns(await countTurns());
    } catch {
      setTurns(undefined);
    }
  }, []);

  useEffect(() => {
    if (!busy) void refreshTurns();
  }, [busy, refreshTurns, chat.messages.length]);

  /* stamp assistant messages that arrive mid-session so the meta line is real */
  useEffect(() => {
    setLiveTimes((previous) => {
      const additions: Record<string, string> = {};
      for (const message of chat.messages) {
        if (
          message.role === "assistant" &&
          message.id &&
          !previous[message.id] &&
          !timeOf(message, previous)
        ) {
          additions[message.id] = new Date().toISOString();
        }
      }
      return Object.keys(additions).length ? { ...previous, ...additions } : previous;
    });
  }, [chat.messages]);

  /* ⌘K opens search, Escape closes it */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => {
          if (!open) queueMicrotask(() => searchRef.current?.focus());
          return !open;
        });
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        setConfirmClear(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return chat.messages
      .map((message, index) => ({ message, index }))
      .filter(({ message }) => {
        const haystack = [textOf(message), ...filesOf(message).map((file) => file.filename ?? "")]
          .join(" ")
          .toLowerCase();
        return haystack.includes(needle);
      })
      .slice(-30);
  }, [chat.messages, query]);

  const send = useCallback(() => {
    const text = textInput.value.trim();
    const pending = [...attachments.files];
    if (!text && pending.length === 0) return;

    // Read the attachments before the composer clears them: clearing revokes
    // the blob URLs the chips point at.
    void (async () => {
      let files: FileUIPart[];
      try {
        files = await toDataFileParts(pending);
      } catch (error) {
        console.error(error);
        return;
      }
      textInput.clear();
      attachments.clear();
      setConfirmClear(false);
      chat.sendMessage({
        text: text || "Work on the attached file.",
        files,
        metadata: { mode: mode ?? null, createdAt: new Date().toISOString() },
      });
    })();
  }, [attachments, chat, mode, textInput]);

  const clearDesk = useCallback(async () => {
    const { error } = await supabase.from("chat_messages").delete().not("sdk_id", "is", null);
    if (error) {
      setConfirmClear(false);
      return;
    }
    chat.setMessages([]);
    setLiveTimes({});
    setTurns(0);
    setConfirmClear(false);
    queryClient.setQueryData(["chat-history"], []);
  }, [chat, queryClient]);

  const jumpTo = useCallback((index: number) => {
    setSearchOpen(false);
    document
      .getElementById(`turn-${index}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-paper text-ink">
      <div aria-hidden className="desk-light pointer-events-none absolute inset-0 -z-10" />

      <header className="glass-strong sticky top-0 z-30 border-b border-line/80">
        <div className="mx-auto flex w-full max-w-[440px] items-center gap-3 px-4 py-3 md:max-w-[620px]">
          <Mark />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] leading-tight font-bold tracking-tight text-ink">
              Marginalia
            </p>
            <p className="font-mono text-[10px] tracking-wide text-ink-faint uppercase">
              research desk
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSearchOpen((open) => !open)}
            aria-label="Search this conversation"
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg border border-line/80 transition-colors",
              searchOpen ? "bg-ink text-paper" : "bg-panel/70 text-ink-soft hover:bg-surface",
            )}
          >
            <SearchIcon className="size-4" />
          </button>
          <StatusChip busy={busy} turns={turns} />
        </div>
      </header>

      {searchOpen ? (
        <SearchPanel
          inputRef={searchRef}
          query={query}
          onQuery={setQuery}
          onClose={() => setSearchOpen(false)}
          matches={matches}
          onJump={jumpTo}
          confirmClear={confirmClear}
          onAskClear={() => setConfirmClear(true)}
          onCancelClear={() => setConfirmClear(false)}
          onClear={clearDesk}
        />
      ) : null}

      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="mx-auto flex w-full max-w-[440px] flex-col gap-5 px-4 pt-5 pb-44 md:max-w-[620px]">
          {chat.messages.length === 0 ? (
            <>
              <ConversationEmptyState
                title="The desk is clear"
                description="Ask something, attach a document, or pick a mode below. Everything stays in this one conversation."
              />
              <div className="flex flex-wrap gap-2 pt-1">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion.label}
                    type="button"
                    onClick={() => {
                      textInput.setInput(suggestion.prompt);
                      queueMicrotask(() => document.getElementById("desk-composer")?.focus());
                    }}
                    className="glass rounded-full border border-line px-3 py-1.5 text-[12px] font-medium text-ink-soft transition-colors hover:bg-surface hover:text-ink"
                  >
                    {suggestion.label}
                  </button>
                ))}
              </div>
            </>
          ) : (
            chat.messages.map((message, index) => {
              const previous = chat.messages[index - 1];
              const here = timeOf(message, liveTimes);
              const there = previous ? timeOf(previous, liveTimes) : undefined;
              const showDivider =
                !previous ||
                (dayLabel(here) && dayLabel(there) && dayLabel(here) !== dayLabel(there));

              return (
                <Fragment key={message.id ?? index}>
                  {showDivider && dayLabel(here) ? <DayDivider label={dayLabel(here)!} /> : null}
                  <Turn
                    message={message}
                    index={index}
                    live={liveTimes}
                    busy={busy}
                    streaming={
                      busy && index === chat.messages.length - 1 && message.role === "assistant"
                    }
                  />
                </Fragment>
              );
            })
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {chat.status === "error" ? (
        <div className="mx-auto w-full max-w-[440px] px-4 pb-2 md:max-w-[620px]">
          <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
            {chat.error?.message ??
              "That answer didn't come through. Nothing was saved — resend it."}
          </p>
        </div>
      ) : null}

      <div className="pointer-events-none sticky bottom-0 z-30 px-4 pt-2 pb-4">
        <div className="pointer-events-auto mx-auto w-full max-w-[440px] md:max-w-[620px]">
          <PromptInput
            onSubmit={send}
            className="glass-strong tray-shadow rounded-2xl border border-line/80 p-2"
          >
            {attachments.files.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 px-1 pt-1 pb-2">
                {attachments.files.map((file) => (
                  <span
                    key={file.id}
                    className="flex max-w-[220px] items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1 text-[11px] text-ink-soft"
                  >
                    <FileTextIcon className="size-3 shrink-0 text-brand" />
                    <span className="truncate font-mono">{file.filename ?? "attachment"}</span>
                    <button
                      type="button"
                      onClick={() => attachments.remove(file.id)}
                      aria-label={`Remove ${file.filename ?? "attachment"}`}
                      className="text-ink-faint hover:text-ink"
                    >
                      <XIcon className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            <PromptInputTextarea
              id="desk-composer"
              placeholder={modePlaceholder(mode)}
              className="min-h-[44px] resize-none bg-transparent px-2 py-2 text-[14px] leading-relaxed placeholder:text-ink-faint"
            />

            <PromptInputFooter className="items-center justify-between gap-2 px-1 pt-1">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                {DESK_MODES.map((deskMode) => {
                  const active = mode === deskMode.id;
                  return (
                    <button
                      key={deskMode.id}
                      type="button"
                      title={deskMode.blurb}
                      aria-pressed={active}
                      onClick={() => setMode(active ? undefined : deskMode.id)}
                      className={cn(
                        "rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors",
                        active
                          ? "border-ink bg-ink text-paper"
                          : "border-line bg-panel/60 text-ink-soft hover:bg-surface hover:text-ink",
                      )}
                    >
                      {deskMode.label}
                    </button>
                  );
                })}
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={attachments.openFileDialog}
                  aria-label="Attach a document"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-panel/60 text-ink-soft transition-colors hover:bg-surface hover:text-ink"
                >
                  <PaperclipIcon className="size-4" />
                </button>
                <PromptInputSubmit
                  status={chat.status}
                  onStop={() => chat.stop()}
                  className="bg-brand text-paper hover:bg-brand/90"
                />
              </div>
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- sub-pieces */

function Mark() {
  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-ink text-[14px] font-extrabold text-paper">
      M
    </div>
  );
}

function StatusChip({ busy, turns }: { busy: boolean; turns: number | undefined }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-line/80 bg-panel/70 px-2.5 py-1 font-mono text-[10px] tracking-wide text-ink-faint uppercase">
      <span
        className={cn(
          "size-1.5 rounded-full",
          busy ? "animate-[caret_1s_ease-in-out_infinite] bg-brand" : "bg-cool",
        )}
      />
      {busy
        ? "saving"
        : typeof turns === "number"
          ? `saved · ${turns} ${turns === 1 ? "turn" : "turns"}`
          : "saved"}
    </span>
  );
}

function DayDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="h-px flex-1 bg-line" />
      <span className="font-mono text-[10px] tracking-wide text-ink-faint uppercase">{label}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

function Turn({
  message,
  index,
  live,
  streaming,
}: {
  message: UIMessage;
  index: number;
  live: Record<string, string>;
  busy: boolean;
  streaming: boolean;
}) {
  if (message.role === "user") return <UserTurn message={message} index={index} live={live} />;
  return <AssistantTurn message={message} index={index} live={live} streaming={streaming} />;
}

function UserTurn({
  message,
  index,
  live,
}: {
  message: UIMessage;
  index: number;
  live: Record<string, string>;
}) {
  const text = textOf(message);
  const files = filesOf(message);
  const time = clockOf(timeOf(message, live));

  return (
    <div id={`turn-${index}`} className="flex flex-col items-end gap-1.5">
      {text ? (
        <div className="max-w-[86%] rounded-2xl rounded-br-md bg-ink px-3.5 py-2.5 text-[14px] leading-relaxed text-paper">
          {text}
        </div>
      ) : null}
      {files.length > 0 ? (
        <div className="flex flex-wrap justify-end gap-1.5">
          {files.map((file, fileIndex) => (
            <a
              key={file.url.slice(-24) + fileIndex}
              href={file.url}
              download={file.filename}
              className="glass flex max-w-[220px] items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-[11px] text-ink-soft hover:bg-surface"
            >
              <FileTextIcon className="size-3 shrink-0 text-brand" />
              <span className="truncate font-mono">{file.filename ?? "attachment"}</span>
            </a>
          ))}
        </div>
      ) : null}
      {time ? (
        <p className="font-mono text-[10px] tracking-wide text-ink-faint uppercase">
          {modeOf(message) ? `${modeLabel(modeOf(message))} · ` : ""}
          {time}
        </p>
      ) : null}
    </div>
  );
}

function AssistantTurn({
  message,
  index,
  live,
  streaming,
}: {
  message: UIMessage;
  index: number;
  live: Record<string, string>;
  streaming: boolean;
}) {
  const text = textOf(message);
  const reasoning = reasoningOf(message);
  const tools = toolsOf(message);
  const sources = sourcesOf(message);
  const mode = modeLabel(modeOf(message));
  const time = clockOf(timeOf(message, live));

  return (
    <div id={`turn-${index}`} className="flex flex-col items-start gap-1.5">
      <div className="flex items-center gap-2 pl-0.5">
        <span className="flex size-5 items-center justify-center rounded-md bg-ink text-[10px] font-extrabold text-paper">
          M
        </span>
        <p className="font-mono text-[10px] tracking-wide text-ink-faint uppercase">
          assistant{mode !== "Ask" ? ` · ${mode}` : ""}
          {time ? ` · ${time}` : ""}
        </p>
      </div>

      <div className="glass panel-shadow w-full rounded-2xl rounded-tl-md border border-line/80 px-4 py-3.5">
        {reasoning.length > 0 ? (
          <Reasoning isStreaming={streaming && !text} className="mb-3">
            <ReasoningTrigger />
            <ReasoningContent>{reasoning.map((part) => part.text).join("\n\n")}</ReasoningContent>
          </Reasoning>
        ) : null}

        {tools.map((tool, toolIndex) => {
          const part = tool as { type: string; state?: string; toolName?: string };
          const name =
            part.type === "dynamic-tool" ? (part.toolName ?? "tool") : part.type.slice(5);
          return (
            <Tool
              key={name + toolIndex}
              defaultOpen={false}
              className="mb-3 border-line bg-surface/60"
            >
              <ToolHeader
                type={part.type as "dynamic-tool"}
                state={(part.state ?? "input-available") as "input-available"}
                toolName={name}
                title={name === "web_search" ? "Searched the web" : name}
              />
              <ToolContent className="px-3 pb-3 text-[12px] text-ink-soft">
                <p className="font-mono">
                  {name === "web_search" ? "Lovable AI looked this up before answering." : name}
                </p>
              </ToolContent>
            </Tool>
          );
        })}

        {text ? (
          <MessageContent className="answer gap-3">
            <MessageResponse>{text}</MessageResponse>
          </MessageContent>
        ) : streaming ? (
          <div className="text-[13px] text-ink-faint">
            <Shimmer>Thinking…</Shimmer>
          </div>
        ) : null}

        {sources.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
            {sources.map((source, sourceIndex) => (
              <a
                key={source.url + sourceIndex}
                href={source.url}
                target="_blank"
                rel="noreferrer"
                title={source.title ?? source.url}
                className="flex max-w-full items-center gap-1.5 rounded-lg border border-line bg-surface/70 px-2 py-1 text-[11px] text-ink-soft transition-colors hover:border-brand hover:text-ink"
              >
                <span className="size-1.5 shrink-0 rounded-full bg-brand" />
                <span className="truncate font-mono">{domainOf(source.url)}</span>
              </a>
            ))}
          </div>
        ) : null}
      </div>

      {text ? <CopyLine text={text} /> : null}
    </div>
  );
}

function CopyLine({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <MessageActions className="pl-0.5">
      <MessageAction
        tooltip={copied ? "Copied" : "Copy answer"}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      </MessageAction>
    </MessageActions>
  );
}

function SearchPanel({
  inputRef,
  query,
  onQuery,
  onClose,
  matches,
  onJump,
  confirmClear,
  onAskClear,
  onCancelClear,
  onClear,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  query: string;
  onQuery: (value: string) => void;
  onClose: () => void;
  matches: { message: UIMessage; index: number }[];
  onJump: (index: number) => void;
  confirmClear: boolean;
  onAskClear: () => void;
  onCancelClear: () => void;
  onClear: () => void;
}) {
  const needle = query.trim().toLowerCase();

  return (
    <div className="glass-strong tray-shadow absolute inset-x-0 top-[57px] z-40 animate-[slidein_0.18s_ease-out] border-b border-line/80">
      <div className="mx-auto w-full max-w-[440px] px-4 py-3 md:max-w-[620px]">
        <div className="flex items-center gap-2 rounded-xl border border-line bg-panel/80 px-3 py-2">
          <SearchIcon className="size-4 shrink-0 text-ink-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Search this conversation…"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-faint"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="text-ink-faint transition-colors hover:text-ink"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        {needle ? (
          <>
            <p className="font-mono mt-3 text-[10px] tracking-wide text-ink-faint uppercase">
              {matches.length} {matches.length === 1 ? "turn" : "turns"}
            </p>
            <ul className="mt-1 max-h-[38vh] overflow-y-auto">
              {matches.map(({ message, index }) => (
                <li key={message.id ?? index}>
                  <button
                    type="button"
                    onClick={() => onJump(index)}
                    className="w-full truncate rounded-lg px-2 py-1.5 text-left text-[12px] text-ink-soft transition-colors hover:bg-surface hover:text-ink"
                  >
                    <span className="font-mono text-[10px] text-ink-faint uppercase">
                      {message.role === "user" ? "you" : "assistant"} ·{" "}
                    </span>
                    {textOf(message).slice(0, 90) || "attachment"}
                  </button>
                </li>
              ))}
              {matches.length === 0 ? (
                <li className="px-2 py-2 text-[12px] text-ink-faint">Nothing here matches that.</li>
              ) : null}
            </ul>
          </>
        ) : null}

        <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3">
          <p className="font-mono text-[10px] tracking-wide text-ink-faint uppercase">
            ⌘K opens · esc closes
          </p>
          {confirmClear ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-ink-soft">Delete everything?</span>
              <button
                type="button"
                onClick={onClear}
                className="rounded-lg bg-destructive px-2.5 py-1 text-[11px] font-medium text-destructive-foreground"
              >
                Clear desk
              </button>
              <button
                type="button"
                onClick={onCancelClear}
                className="rounded-lg border border-line px-2.5 py-1 text-[11px] text-ink-soft hover:bg-surface"
              >
                Keep
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onAskClear}
              className="rounded-lg border border-line px-2.5 py-1 text-[11px] font-medium text-ink-soft transition-colors hover:border-destructive/40 hover:text-destructive"
            >
              Clear desk
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
