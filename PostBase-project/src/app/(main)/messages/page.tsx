"use client";

import { Suspense, useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Search, Send } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { Loader2 } from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { OnlineStatus } from "@/components/realtime/online-status";
import { TypingIndicator } from "@/components/realtime/typing-indicator";
import { usePresenceFlags } from "@/hooks/use-presence-flags";
import { useWebSocket } from "@/hooks/use-websocket";
import { useTypingAnnouncer } from "@/hooks/use-typing-announcer";
import { MessageReactions } from "@/components/chat/message-reactions";
import { applyReactionToggle, type ChatReactionType } from "@/lib/chat-reactions";

interface Conversation {
  id: string;
  name: string;
  lastMessage: string;
  time: string;
  unread: number;
  otherUserId: string;
}

interface Message {
  id: string;
  content: string;
  senderId: string;
  createdAt: string;
  /** The emoji standing on this message, as the thread read grouped it. */
  reactions?: Array<{ type: string; count: number; mine: boolean }>;
}

/** A conversation as `GET /api/messages` returns it, before the view flattens
 * it into the `Conversation` it renders. */
interface ConversationPayload {
  id: string;
  otherMember?: { name?: string; userId?: string } | null;
  lastMessage?: { content?: string; createdAt?: string } | null;
  /**
   * The server's count of messages the reader has not caught up on — the
   * column below used to render a hardcoded zero because there was none.
   */
  unreadCount?: number;
}

function MessagesContent() {
  const { session } = useSession();
  const searchParams = useSearchParams();
  /**
   * Conversation to open, so a message started from somebody's profile lands in
   * the right thread instead of whichever one happens to be first.
   */
  const requestedConversationId = searchParams.get("c");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  /**
   * A press the server refused — kept apart from the send's own error above:
   * a reaction that did not save leaves the message exactly where it was, and
   * the words should say which of the two things failed.
   */
  const [reactionError, setReactionError] = useState<string | null>(null);
  /**
   * How far the *other* member has read — the server's watermark from the
   * thread payload, advanced live by their `read` frames. Own messages at or
   * before it have been seen by the person they were sent to.
   */
  const [otherReadAt, setOtherReadAt] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  /**
   * Bumped when a message for the open thread arrives over the socket: the
   * thread re-reads on that bump rather than on a navigation, so a new
   * message lands in the conversation the reader is already in.
   */
  const [threadArrived, setThreadArrived] = useState(0);
  // The realtime half: `room: "global"` is the room every chat socket shares,
  // so a message sent anywhere reaches this page in the moment.
  const { lastMessage, send, sendRead } = useWebSocket({ room: "global" });
  /**
   * Who is here, asked **once for the whole column**: the rows below pass each
   * verdict down to their indicator rather than each asking for itself, so
   * twenty conversations are one presence connection and one roster beat — and
   * because this is the same hook the Social strip and the member listing
   * read, a member green in one place cannot be grey in another.
   */
  const { isOnline } = usePresenceFlags(true);
  // The composer's half of the typing indicator, on the socket this page
  // already owns.
  const announcer = useTypingAnnouncer(send, selectedConversation?.id ?? null);

  /**
   * Reads the conversation list — the first load and every realtime refresh
   * through one door, so which conversation stays selected is a single
   * decision rather than two that could disagree.
   *
   * A failure keeps whatever is on screen rather than replacing it: an error
   * is set only when there is nothing at all to show, because a list one
   * request older is more useful than an empty column.
   */
  const loadConversations = useCallback(async () => {
    try {
      const response = await fetch("/api/messages", { cache: "no-store" });
      if (!response.ok) throw new Error("Unable to load messages");
      const payload = await response.json();
      const items: ConversationPayload[] = Array.isArray(payload.conversations) ? payload.conversations : [];
      const mapped = items.map((item) => ({
        id: item.id,
        name: item.otherMember?.name || "Member",
        lastMessage: item.lastMessage?.content || "No messages yet",
        time: item.lastMessage?.createdAt ? new Date(item.lastMessage.createdAt).toLocaleDateString() : "",
        unread: typeof item.unreadCount === "number" ? item.unreadCount : 0,
        otherUserId: item.otherMember?.userId || "",
      }));
      setConversations(mapped);
      setSelectedConversation((current) => {
        const requested = requestedConversationId
          ? mapped.find((item: Conversation) => item.id === requestedConversationId)
          : undefined;
        if (requested) return requested;
        if (current) return mapped.find((item: Conversation) => item.id === current.id) || null;
        return mapped[0] || null;
      });
      setError(null);
    } catch {
      setError("We couldn't load your conversations right now.");
    }
  }, [requestedConversationId]);

  // The first read carries the loading state; the realtime refreshes below
  // ride in without it, so a new message does not blank the column to fetch
  // it.
  useEffect(() => {
    setLoading(true);
    void loadConversations().finally(() => setLoading(false));
  }, [loadConversations]);

  // Keyed on the id alone — plus the socket's bump below: a refresh of the
  // conversation list replaces the object but not the conversation, and that
  // must not re-fetch its messages. A message that arrives for it must.
  const selectedConversationId = selectedConversation?.id;

  // Switching threads resets the receipt: the old counterpart's watermark
  // says nothing about this one's.
  useEffect(() => {
    setOtherReadAt(null);
  }, [selectedConversationId]);

  // Realtime: this page used to read once and then go stale — no poll, no
  // push — so a conversation that received a message kept its old preview
  // until somebody navigated away. The socket is the page's refresh now: any
  // message re-reads the column, and one for the open thread bumps the effect
  // below so it lands where the reader is reading.
  useEffect(() => {
    if (!lastMessage) return;
    // A receipt from the counterpart — the open thread, their id, moving
    // forward only. The watermark is how far *they* have read, so it is their
    // frame that advances it, never the reader's own.
    if (lastMessage.type === "read") {
      const { at, userId } = lastMessage;
      if (
        typeof at === "number" &&
        lastMessage.conversationId === selectedConversationId &&
        typeof userId === "string" &&
        userId === selectedConversation?.otherUserId
      ) {
        setOtherReadAt((current) => (current === null ? at : Math.max(current, at)));
      }
      return;
    }
    // A reaction lands on the open thread as a re-read — the same door a new
    // message takes. The frame says which conversation moved; the thread's own
    // read is what redraws the counts, so the chips are never a local tally a
    // peer's frame would have to be reconciled against.
    if (lastMessage.type === "reaction") {
      if (lastMessage.conversationId === selectedConversationId) {
        setThreadArrived((count) => count + 1);
      }
      return;
    }
    if (lastMessage.type !== "message" && lastMessage.type !== "notification") return;
    void loadConversations();
    if (typeof lastMessage.conversationId === "string" && lastMessage.conversationId === selectedConversationId) {
      setThreadArrived((count) => count + 1);
    }
  }, [lastMessage, selectedConversationId, selectedConversation?.otherUserId, loadConversations]);

  useEffect(() => {
    if (!selectedConversationId) { setMessages([]); return; }
    let cancelled = false;
    fetch(`/api/messages?id=${encodeURIComponent(selectedConversationId)}`, { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : Promise.reject(new Error("Unable to load conversation")))
      .then((payload) => {
        if (cancelled) return;
        setMessages(Array.isArray(payload.messages) ? payload.messages : []);
        // Their watermark: how far the counterpart had read as of their last
        // open of this thread.
        const theirs = typeof payload.otherMember?.lastReadAt === "string"
          ? Date.parse(payload.otherMember.lastReadAt)
          : NaN;
        setOtherReadAt(Number.isNaN(theirs) ? null : theirs);
        // …and this open just moved *our* watermark in the database — the
        // server's instant, announced over the socket, is how the other side
        // learns in the moment that their words have been seen.
        const ours = typeof payload.lastReadAt === "string" ? Date.parse(payload.lastReadAt) : NaN;
        if (!Number.isNaN(ours)) sendRead(selectedConversationId, ours);
      })
      .catch(() => { if (!cancelled) setMessages([]); });
    return () => { cancelled = true; };
  }, [selectedConversationId, threadArrived, sendRead]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /**
   * Sends through the API and keeps the message on screen.
   *
   * The optimistic copy carries a temporary id so the server's row can replace
   * it in place; a failure removes it and hands the text back.
   */
  const handleSendMessage = async () => {
    const content = newMessage.trim();
    if (!content || !selectedConversation || sending) return;

    const tempId = `pending-${Date.now()}`;
    const pendingMessage: Message = {
      id: tempId,
      content,
      senderId: session?.user?.id || "",
      createdAt: new Date().toISOString(),
    };

    setSendError(null);
    setSending(true);
    setMessages((prev) => [...prev, pendingMessage]);
    setNewMessage("");
    // The words are gone from the composer and on their way; the other side
    // should stop seeing dots for them.
    announcer.release();

    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The API reuses the existing conversation for this recipient and
        // returns its id, so no conversation is duplicated.
        body: JSON.stringify({ recipientId: selectedConversation.otherUserId, content }),
      });
      const payload = response.ok ? await response.json().catch(() => null) : null;
      if (!response.ok || !payload?.message) throw new Error("Send failed");

      const saved = payload.message as Message;
      setMessages((prev) => prev.map((item) => (item.id === tempId ? saved : item)));
      // The list's preview and time just changed with it — and the rest of
      // the world needs telling: the API has persisted the row, and this says
      // it exists, so every other reader's list re-reads in the moment rather
      // than whenever they next load this page.
      void loadConversations();
      send({ type: "message", conversationId: selectedConversation.id });
    } catch {
      setMessages((prev) => prev.filter((item) => item.id !== tempId));
      setNewMessage(content);
      setSendError("We couldn't send that message. Please try again.");
    } finally {
      setSending(false);
    }
  };

  /**
   * One press of one emoji, applied as the server's verdict rather than
   * guessed ahead of it: the toggle endpoint answers whether the reaction now
   * stands, and the chip list is rebuilt from that answer — so a failure
   * changes nothing on screen, because nothing was assumed. The room is then
   * told which message moved, and the other member's thread re-reads in the
   * moment.
   */
  const handleReact = async (messageId: string, type: ChatReactionType) => {
    setReactionError(null);
    try {
      const response = await fetch("/api/messages/reactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId: messageId, type }),
      });
      const payload = response.ok ? await response.json().catch(() => null) : null;
      if (!response.ok || typeof payload?.reacted !== "boolean") {
        throw new Error("Reaction failed");
      }
      setMessages((prev) =>
        prev.map((item) =>
          item.id === messageId
            ? {
                ...item,
                reactions: applyReactionToggle(item.reactions ?? [], type, payload.reacted),
              }
            : item,
        ),
      );
      // The API has persisted the row; this says it exists, so the other
      // member's thread re-reads rather than staying one press stale.
      send({
        type: "reaction",
        conversationId: selectedConversation?.id,
        messageId,
        reaction: type,
      });
    } catch {
      setReactionError("We couldn't save that reaction. Please try again.");
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-12rem)]">
      {/* Conversation List */}
      <Card className="lg:col-span-1">
        <CardHeader className="p-4">
          {/* An icon-only Send button used to sit here with no name and no
              handler at all. It was not wired to anything — the composer below
              is how a message is sent — so it is gone rather than named, since
              naming it would only have made a dead control look functional. */}
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Messages</CardTitle>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input aria-label="Search conversations" placeholder="Search conversations..." className="pl-9" />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {loading ? <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading conversations...</div> : error ? <p className="p-4 text-sm text-red-600">{error}</p> : conversations.length === 0 ? <EmptyState title="No conversations yet" description="Start a conversation from a member's profile." /> : conversations.map((conv) => (
              // A button, because it is one: as a `div` with an `onClick` this
              // was not focusable, could not be activated from the keyboard, and
              // had nowhere to say it was the open conversation rather than
              // merely a highlighted one.
              <button
                type="button"
                key={conv.id}
                onClick={() => setSelectedConversation(conv)}
                aria-current={selectedConversation?.id === conv.id ? "true" : undefined}
                className={`relative flex w-full items-center gap-3 p-4 text-left hover:bg-surface-light-blue cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-blue ${
                  selectedConversation?.id === conv.id ? "bg-surface-light-blue" : ""
                }`}
              >
                <Avatar className="h-10 w-10">
                  <AvatarFallback>{conv.name[0]}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{conv.name}</span>
                      {/* The same treatment the member list gives its rows:
                          the mark sits on the profile icon — the avatar's
                          lower-right corner — where a reader looks for who is
                          here, and the words ride along in the markup wherever
                          the dot is drawn. The indicator stays *after the name*
                          in the DOM and only moves visually: the coordinates are
                          absolute against the button (the nearest positioned
                          ancestor), so the reading order stays "Maya Chen
                          Offline" rather than an orphaned status leading the
                          row. The 50px is this row's 16px padding plus the same
                          34px the member list puts the dot past the avatar's
                          left edge — the same corner of the same h-10 avatar,
                          centred in the row the same way. */}
                      <OnlineStatus
                        userId={conv.otherUserId}
                        presence={isOnline(conv.otherUserId)}
                        size="sm"
                        className="absolute left-[50px] top-1/2 translate-y-[13px]"
                      />
                    </div>
                    <span className="text-xs text-muted-foreground">{conv.time}</span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{conv.lastMessage}</p>
                </div>
                {conv.unread > 0 && (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-blue text-[10px] text-white">
                    {conv.unread}
                    <span className="sr-only"> unread</span>
                  </span>
                )}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Chat Area */}
      <Card className="lg:col-span-2 flex flex-col">
        {selectedConversation ? (
          <>
            <CardHeader className="p-4 border-b">
              <div className="flex items-center gap-3">
                <Avatar className="h-8 w-8">
                  <AvatarFallback>{selectedConversation.name[0]}</AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-medium text-sm">{selectedConversation.name}</p>
                  <OnlineStatus userId={selectedConversation.otherUserId} showText size="sm" />
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex-1 p-4 overflow-y-auto">
              <div className="space-y-4">
                {messages.map((msg) => {
                  // A message of mine the counterpart's watermark covers has
                  // been opened by them — the receipt, in the same small type
                  // as the time it sits beside.
                  const readByThem =
                    msg.senderId === session?.user?.id &&
                    otherReadAt !== null &&
                    Date.parse(msg.createdAt) <= otherReadAt;
                  return (
                    <div
                      key={msg.id}
                      className={`flex ${
                        msg.senderId === session?.user?.id ? "justify-end" : "justify-start"
                      }`}
                    >
                      <div
                        className={`rounded-lg px-3 py-2 max-w-[70%] ${
                          msg.senderId === session?.user?.id
                            ? "bg-brand-blue text-white"
                            : "bg-surface-light-blue"
                        }`}
                      >
                        <p className="text-sm">{msg.content}</p>
                        <span
                          className={`text-[10px] ${
                            msg.senderId === session?.user?.id ? "text-blue-100" : "text-muted-foreground"
                          }`}
                        >
                          {new Date(msg.createdAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {readByThem && <> · Read</>}
                        </span>
                        <MessageReactions
                          reactions={msg.reactions ?? []}
                          onToggle={(type) => void handleReact(msg.id, type)}
                        />
                      </div>
                    </div>
                  );
                })}
                <TypingIndicator conversationId={selectedConversation.id} />
                <div ref={messagesEndRef} />
              </div>
            </CardContent>
            <div className="p-4 border-t">
              {sendError && (
                <p role="alert" className="mb-2 text-sm text-red-600">
                  {sendError}
                </p>
              )}
              {reactionError && (
                <p role="alert" className="mb-2 text-sm text-red-600">
                  {reactionError}
                </p>
              )}
              <div className="flex gap-2">
                <Input
                  placeholder="Type a message..."
                  value={newMessage}
                  onChange={(e) => {
                    setNewMessage(e.target.value);
                    announcer.onType();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void handleSendMessage();
                    }
                  }}
                  aria-label="Message text"
                  className="flex-1"
                />
                <Button
                  onClick={() => void handleSendMessage()}
                  disabled={sending || newMessage.trim().length === 0}
                  aria-label={`Send message to ${selectedConversation.name}`}
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <CardContent className="flex items-center justify-center h-full">
            <p className="text-muted-foreground">Select a conversation</p>
          </CardContent>
        )}
      </Card>
    </div>
  );
}

/** `useSearchParams` needs a Suspense boundary, as on the search page. */
export default function MessagesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />Loading messages...
        </div>
      }
    >
      <MessagesContent />
    </Suspense>
  );
}
