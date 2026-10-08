"use client";

import { Suspense, useState, useEffect, useRef } from "react";
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
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/messages", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : Promise.reject(new Error("Unable to load messages")))
      .then((payload) => {
        if (cancelled) return;
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
      })
      .catch(() => { if (!cancelled) setError("We couldn't load your conversations right now."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [requestedConversationId]);

  // Keyed on the id alone: a refresh of the conversation list replaces the
  // object but not the conversation, and that must not re-fetch its messages.
  const selectedConversationId = selectedConversation?.id;
  useEffect(() => {
    if (!selectedConversationId) { setMessages([]); return; }
    let cancelled = false;
    fetch(`/api/messages?id=${encodeURIComponent(selectedConversationId)}`, { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : Promise.reject(new Error("Unable to load conversation")))
      .then((payload) => { if (!cancelled) setMessages(Array.isArray(payload.messages) ? payload.messages : []); })
      .catch(() => { if (!cancelled) setMessages([]); });
    return () => { cancelled = true; };
  }, [selectedConversationId]);

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
    } catch {
      setMessages((prev) => prev.filter((item) => item.id !== tempId));
      setNewMessage(content);
      setSendError("We couldn't send that message. Please try again.");
    } finally {
      setSending(false);
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
                className={`flex w-full items-center gap-3 p-4 text-left hover:bg-surface-light-blue cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-blue ${
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
                      <OnlineStatus userId={conv.otherUserId} size="sm" />
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
                {messages.map((msg) => (
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
                      </span>
                    </div>
                  </div>
                ))}
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
              <div className="flex gap-2">
                <Input
                  placeholder="Type a message..."
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
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
