"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Loader2, MessageCircle, Send } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { EmptyState } from "@/components/shared/empty-state";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DisclosureButton } from "@/components/ui/disclosure-button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** A conversation as the panel renders it, after the API's payload is flattened. */
interface Conversation {
  id: string;
  name: string;
  /** The last message's text, or the standing invitation where there is none. */
  preview: string;
  time: string;
  otherUserId: string;
  /**
   * The messages the server counts as unread here — others' messages since
   * this member last opened the thread. The row shows a dot when it is above
   * zero; the badge sums it across the list.
   */
  unreadCount: number;
}

interface Message {
  id: string;
  content: string;
  senderId: string;
  createdAt: string;
}

/** A conversation as `GET /api/messages` returns it, before the panel flattens it. */
interface ConversationPayload {
  id: string;
  /** The server's count of what is unread in this conversation. */
  unreadCount?: number;
  otherMember?: { userId?: string; name?: string } | null;
  lastMessage?: { content?: string; createdAt?: string; senderId?: string } | null;
}

/**
 * A floating door to messages: a bubble on every signed-in page that opens a
 * compact panel — conversation list, thread, and a composer — without leaving
 * whatever the reader was doing.
 *
 * It renders nothing signed out, for the same reason the signed-out header
 * omits Messages: the API answers a visitor with an auth error, so a bubble
 * that opened on a 401 would only advertise a door that bounces. The badge is
 * fed by the same list endpoint the `/messages` page reads, on a slow poll —
 * and the count is the server's, the unread total that endpoint computes from
 * each member's `lastReadAt`, so no second derivation here can disagree with
 * the column that page renders.
 */
export function ChatBubble() {
  const { isAuthenticated, user } = useAuth();
  // Which page the bubble is floating over — the one thing that can take it
  // off the screen while the reader stays signed in.
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  /** The list's unread total — the badge's number, straight from the server. */
  const [unreadCount, setUnreadCount] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  /**
   * Re-reads the conversation list — the badge's whole data source.
   *
   * A failure keeps whatever is already on screen rather than replacing it:
   * a stale badge is more useful than an empty panel, and the error below is
   * shown only when there is nothing at all to show.
   */
  const refreshConversations = useCallback(async () => {
    try {
      const response = await fetch("/api/messages", { cache: "no-store" });
      if (!response.ok) throw new Error("Unable to load messages");
      const payload = await response.json();
      const items: ConversationPayload[] = Array.isArray(payload.conversations)
        ? payload.conversations
        : [];
      setConversations(
        items.map((item) => ({
          id: item.id,
          name: item.otherMember?.name || "Member",
          preview: item.lastMessage?.content || "No messages yet",
          time: item.lastMessage?.createdAt
            ? new Date(item.lastMessage.createdAt).toLocaleDateString()
            : "",
          otherUserId: item.otherMember?.userId || "",
          unreadCount: typeof item.unreadCount === "number" ? item.unreadCount : 0,
        })),
      );
      // The badge takes the server's total rather than summing the rows: the
      // endpoint answers it once, and it cannot drift from what the rows show.
      setUnreadCount(typeof payload.unreadCount === "number" ? payload.unreadCount : 0);
      setListError(null);
    } catch {
      setListError("We couldn't load your conversations right now.");
    } finally {
      setListLoading(false);
    }
  }, []);

  // The badge has to be right while the panel is shut, so the list loads as
  // soon as the reader is signed in and is re-read on a slow poll — the only
  // thing that can change it from outside this component is somebody else
  // sending a message.
  //
  // Not on the messages page: that page reads the same list itself, so a
  // hidden bubble polling it would only be a second reader of one endpoint.
  // `pathname` is a dependency, so leaving that page re-runs this effect and
  // the badge is re-read on arrival — current when it reappears, not one
  // interval later.
  useEffect(() => {
    if (!isAuthenticated || pathname === "/messages") return;
    void refreshConversations();
    const timer = setInterval(() => void refreshConversations(), 30_000);
    return () => clearInterval(timer);
  }, [isAuthenticated, pathname, refreshConversations]);

  // Opening re-reads too, so the panel never opens on the poll's last answer.
  useEffect(() => {
    if (open) void refreshConversations();
  }, [open, refreshConversations]);

  // Keyed on the id alone: closing and reopening the panel must not re-fetch
  // a thread the reader is already looking at.
  const selectedId = selected?.id;
  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      setThreadError(null);
      return;
    }
    let cancelled = false;
    setThreadLoading(true);
    setThreadError(null);
    setSendError(null);
    fetch(`/api/messages?id=${encodeURIComponent(selectedId)}`, { cache: "no-store" })
      .then(async (response) =>
        response.ok ? response.json() : Promise.reject(new Error("Unable to load conversation")),
      )
      .then((payload) => {
        if (cancelled) return;
        setMessages(Array.isArray(payload.messages) ? payload.messages : []);
        // This request also marks the thread read server-side, so the list is
        // re-read immediately — the badge is the panel's own promise, and it
        // has to clear the moment the reader has seen the thread.
        return refreshConversations();
      })
      .catch(() => {
        if (!cancelled) setThreadError("We couldn't load this conversation.");
      })
      .finally(() => {
        if (!cancelled) setThreadLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, refreshConversations]);

  // Newest message at the bottom of a scrollable panel, as on the messages page.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Escape is how a floating layer is dismissed without hunting for the control
  // that opened it. Listening on the document rather than the panel because the
  // reader's focus may be anywhere inside — or still on the bubble itself.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  /**
   * Sends through the API and keeps the message on screen.
   *
   * The optimistic copy carries a temporary id so the server's row can replace
   * it in place; a failure removes it and hands the text back, so a message is
   * never silently dropped.
   */
  const handleSend = async () => {
    const content = draft.trim();
    if (!content || !selected || sending) return;

    const tempId = `pending-${Date.now()}`;
    const pendingMessage: Message = {
      id: tempId,
      content,
      senderId: user?.id ?? "",
      createdAt: new Date().toISOString(),
    };

    setSendError(null);
    setSending(true);
    setMessages((prev) => [...prev, pendingMessage]);
    setDraft("");

    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The API reuses the existing conversation for this recipient and
        // returns its id, so no conversation is duplicated.
        body: JSON.stringify({ recipientId: selected.otherUserId, content }),
      });
      const payload = response.ok ? await response.json().catch(() => null) : null;
      if (!response.ok || !payload?.message) throw new Error("Send failed");

      const saved = payload.message as Message;
      setMessages((prev) => prev.map((item) => (item.id === tempId ? saved : item)));
      // The conversation list's preview and time just changed with it.
      void refreshConversations();
    } catch {
      setMessages((prev) => prev.filter((item) => item.id !== tempId));
      setDraft(content);
      setSendError("We couldn't send that message. Please try again.");
    } finally {
      setSending(false);
    }
  };

  // The messages page is the bubble's full-size twin — same conversation list,
  // same unread badges — so a floating copy of it is noise on top of the thing
  // it points to. The panel's state goes with it: coming back to any other
  // page starts with the bubble closed instead of reopening the thread the
  // reader just left behind in the page they navigated to.
  useEffect(() => {
    if (pathname !== "/messages") return;
    setOpen(false);
    setSelected(null);
  }, [pathname]);

  // Every hook above runs regardless, because the auth state arrives after the
  // first render — an early return before them would make the hook order depend
  // on the session. This is the whole signed-out behaviour: no bubble, no poll.
  if (!isAuthenticated) return null;

  // …and this is the whole on-/messages behaviour: no floating twin of the
  // page that is already open, and no poller hidden behind it either. The
  // badge is re-read the moment the reader leaves, so it is right on arrival
  // rather than on the next tick.
  if (pathname === "/messages") return null;

  const readerId = user?.id ?? null;

  return (
    // Fixed clear of the bottom bar on a phone — the bar owns the bottom of the
    // screen and `main` keeps the same `pb-20` clearance this uses — and lifted
    // to `bottom-6` on md+, where there is no bar under it.
    <div className="fixed bottom-20 right-4 z-50 flex flex-col items-end gap-3 md:bottom-6">
      {open && (
        <div
          id="chat-panel"
          className="flex h-[26rem] max-h-[calc(100vh-10rem)] w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        >
          {selected ? (
            /* Thread view */
            <>
              <div className="flex items-center gap-2 border-b p-2">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Back to conversations"
                  onClick={() => {
                    setSelected(null);
                    setDraft("");
                  }}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <Avatar className="h-7 w-7">
                  <AvatarFallback>{selected.name[0]}</AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {selected.name}
                </span>
                <Link
                  href={`/messages?c=${encodeURIComponent(selected.id)}`}
                  className="shrink-0 text-xs font-medium text-brand-blue hover:underline"
                >
                  Open in Messages
                </Link>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {threadLoading ? (
                  <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />Loading messages...
                  </div>
                ) : threadError ? (
                  <p role="alert" className="p-2 text-sm text-red-600">
                    {threadError}
                  </p>
                ) : messages.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No messages yet.</p>
                ) : (
                  <div className="space-y-2">
                    {messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={cn("flex", msg.senderId === readerId ? "justify-end" : "justify-start")}
                      >
                        <div
                          className={cn(
                            "max-w-[80%] rounded-lg px-2.5 py-1.5",
                            msg.senderId === readerId
                              ? "bg-brand-blue text-white"
                              : "bg-surface-light-blue",
                          )}
                        >
                          <p className="break-words text-sm">{msg.content}</p>
                          <span
                            className={cn(
                              "text-[10px]",
                              msg.senderId === readerId ? "text-blue-100" : "text-muted-foreground",
                            )}
                          >
                            {new Date(msg.createdAt).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>

              <div className="border-t p-3">
                {sendError && (
                  <p role="alert" className="mb-2 text-xs text-red-600">
                    {sendError}
                  </p>
                )}
                <div className="flex gap-2">
                  <Input
                    placeholder="Type a message..."
                    aria-label="Message text"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void handleSend();
                      }
                    }}
                    className="flex-1"
                  />
                  <Button
                    aria-label={`Send message to ${selected.name}`}
                    disabled={sending || draft.trim().length === 0}
                    onClick={() => void handleSend()}
                  >
                    {sending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            /* Conversation list view */
            <>
              <div className="flex items-center justify-between border-b p-3">
                <h2 className="text-sm font-semibold">Chat</h2>
                <Link
                  href="/messages"
                  className="text-xs font-medium text-brand-blue hover:underline"
                >
                  Open in Messages
                </Link>
              </div>

              {listLoading && conversations.length === 0 ? (
                <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />Loading conversations...
                </div>
              ) : conversations.length === 0 ? (
                listError ? (
                  <p role="alert" className="p-4 text-sm text-red-600">
                    {listError}
                  </p>
                ) : (
                  <EmptyState
                    className="py-8"
                    title="No conversations yet"
                    description="Start a conversation from a member's profile."
                  />
                )
              ) : (
                <ul className="min-h-0 flex-1 divide-y overflow-y-auto">
                  {conversations.map((conversation) => {
                    const unread = conversation.unreadCount > 0;
                    return (
                      <li key={conversation.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSendError(null);
                            setSelected(conversation);
                          }}
                          className="flex w-full cursor-pointer items-center gap-3 p-3 text-left transition-colors hover:bg-surface-light-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-blue"
                        >
                          <Avatar className="h-9 w-9">
                            <AvatarFallback>{conversation.name[0]}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="truncate text-sm font-medium">
                                {conversation.name}
                              </span>
                              <span className="shrink-0 text-[10px] text-muted-foreground">
                                {conversation.time}
                              </span>
                            </div>
                            <p className="truncate text-xs text-muted-foreground">
                              {conversation.preview}
                            </p>
                          </div>
                          {unread && (
                            <>
                              <span
                                aria-hidden="true"
                                className="h-2.5 w-2.5 shrink-0 rounded-full bg-brand-blue"
                              />
                              {/* The dot is a shape; this is what it says. */}
                              <span className="sr-only">unread</span>
                            </>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      <DisclosureButton
        open={open}
        controls="chat-panel"
        label="Chat"
        // The count rides in the accessible name only: the badge already shows
        // it to the eye, and `detail` is how a name stays a superset of what is
        // on screen without a second string to keep in step.
        detail={
          unreadCount > 0
            ? `${unreadCount} unread message${unreadCount === 1 ? "" : "s"}`
            : undefined
        }
        variant="default"
        onClick={() => setOpen((current) => !current)}
        className="relative h-12 w-12 rounded-full shadow-lg"
      >
        <MessageCircle className="h-6 w-6" aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </DisclosureButton>
    </div>
  );
}
