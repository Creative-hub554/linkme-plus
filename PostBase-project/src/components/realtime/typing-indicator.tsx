"use client";

import { useEffect, useState } from "react";
import { useWebSocket } from "@/hooks/use-websocket";
import { cn } from "@/lib/utils";

interface TypingIndicatorProps {
  conversationId: string;
  className?: string;
}

interface TypingUser {
  userId: string;
  timestamp: number;
}

export function TypingIndicator({ conversationId, className }: TypingIndicatorProps) {
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const { lastMessage } = useWebSocket();

  useEffect(() => {
    if (!lastMessage || lastMessage.conversationId !== conversationId) return;

    switch (lastMessage.type) {
      case "typing": {
        const { userId, timestamp } = lastMessage;
        if (typeof userId !== "string" || typeof timestamp !== "number") break;
        setTypingUsers((prev) => {
          // Don't add duplicate users
          if (prev.some((u) => u.userId === userId)) {
            return prev;
          }
          return [...prev, { userId, timestamp }];
        });
        break;
      }

      case "stop-typing": {
        const { userId } = lastMessage;
        if (typeof userId !== "string") break;
        setTypingUsers((prev) =>
          prev.filter((u) => u.userId !== userId)
        );
        break;
      }

      case "message": {
        // Remove user from typing when they send a message
        const { userId } = lastMessage;
        if (typeof userId !== "string") break;
        setTypingUsers((prev) =>
          prev.filter((u) => u.userId !== userId)
        );
        break;
      }
    }
  }, [lastMessage, conversationId]);

  // Auto-remove stale typing indicators after 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setTypingUsers((prev) =>
        prev.filter((u) => now - u.timestamp < 5000)
      );
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  if (typingUsers.length === 0) return null;

  const text =
    typingUsers.length === 1
      ? "Someone is typing"
      : typingUsers.length === 2
      ? "2 people are typing"
      : "Several people are typing";

  return (
    <div className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)}>
      <div className="flex gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-brand-blue animate-bounce" style={{ animationDelay: "0ms" }} />
        <span className="h-1.5 w-1.5 rounded-full bg-brand-blue animate-bounce" style={{ animationDelay: "150ms" }} />
        <span className="h-1.5 w-1.5 rounded-full bg-brand-blue animate-bounce" style={{ animationDelay: "300ms" }} />
      </div>
      <span>{text}</span>
    </div>
  );
}
