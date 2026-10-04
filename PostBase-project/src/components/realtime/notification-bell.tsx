"use client";

import { useState } from "react";
import Link from "next/link";
import { IconButton } from "@/components/ui/icon-button";
import { DisclosureButton } from "@/components/ui/disclosure-button";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Bell, CheckCheck, X } from "lucide-react";
import {
  useNotifications,
  type Notification,
} from "@/components/providers/notification-provider";
import { cn } from "@/lib/utils";

/**
 * Where a notification takes the reader.
 *
 * Comment and reaction rows carry the post they are about, so they open that
 * post in the feed. A follow names the *actor* rather than the reader's own
 * profile, which is why it links to `sourceUserId`. A row with no destination
 * is still markable as read, it just has nowhere to go.
 */
function notificationDestination(notification: Notification): {
  href: string;
  hint: string;
} | null {
  if (notification.targetType === "post" && notification.targetId) {
    return { href: `/feed?post=${encodeURIComponent(notification.targetId)}`, hint: "Open post" };
  }
  if (notification.type === "follow" && notification.sourceUserId) {
    return {
      href: `/profile?user=${encodeURIComponent(notification.sourceUserId)}`,
      hint: "Open profile",
    };
  }
  return null;
}

export function NotificationBell() {
  const { unreadCount } = useNotifications();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      {/* Named, because the count inside would otherwise be the button's whole
          accessible name (it read as just "3"): the badge is `aria-hidden`, so
          the count has to reach a screen reader through the name. The hint stays
          the short "Notifications" — the badge already shows the number to
          anyone who can see the button — while the name carries both. */}
      <DisclosureButton
        open={isOpen}
        controls="notification-panel"
        label="Notifications"
        detail={unreadCount > 0 ? `${unreadCount} unread` : undefined}
        onClick={() => setIsOpen(!isOpen)}
        className="relative"
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] leading-none text-white"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </DisclosureButton>

      {isOpen && (
        <NotificationPanel onClose={() => setIsOpen(false)} />
      )}
    </div>
  );
}

function NotificationPanel({ onClose }: { onClose: () => void }) {
  const { notifications, markAsRead, markAllAsRead, clearNotification } = useNotifications();

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Panel. The `id` is what the bell's `aria-controls` names. */}
      <Card
        id="notification-panel"
        className="absolute right-0 top-full mt-2 w-80 z-50 max-h-[70vh] overflow-hidden"
      >
        <CardHeader className="p-4 border-b">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Notifications</CardTitle>
            <div className="flex items-center gap-2">
              {/* Both were icon-only and nameless — the panel is only mounted
                  while it is open, so the audit could not see them until it was
                  given the opened state to judge. */}
              <IconButton label="Mark all as read" size="sm" onClick={markAllAsRead}>
                <CheckCheck className="h-4 w-4" />
              </IconButton>
              <IconButton label="Close notifications" onClick={onClose}>
                <X className="h-4 w-4" />
              </IconButton>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-y-auto max-h-[50vh]">
          {notifications.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">
              No notifications yet
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onRead={markAsRead}
                  onClear={clearNotification}
                  onNavigate={onClose}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function NotificationItem({
  notification,
  onRead,
  onNavigate,
}: {
  notification: Notification;
  onRead: (id: string) => void;
  onClear: (id: string) => void;
  onNavigate: () => void;
}) {
  const getIcon = (type: string) => {
    switch (type) {
      case "like":
        return "👍";
      case "comment":
        return "💬";
      case "follow":
        return "👤";
      case "mention":
        return "@";
      case "message":
        return "✉️";
      default:
        return "🔔";
    }
  };

  const destination = notificationDestination(notification);
  const rowClassName = cn(
    "block w-full p-4 text-left hover:bg-surface-light-blue cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-blue",
    !notification.read && "bg-brand-blue/5"
  );

  // Only spans inside the row, so it is valid markup whether it is rendered as
  // a link or as a button that has nowhere to navigate.
  const content = (
    <span className="flex items-start gap-3">
      <span className="text-lg" aria-hidden="true">
        {getIcon(notification.type)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm">{notification.message}</span>
        <span className="mt-1 block text-xs text-muted-foreground">
          {new Date(notification.createdAt).toLocaleTimeString()}
        </span>
      </span>
      {/* Unread was drawn as a blue dot and said nowhere. It goes through the
          same component as the online dot now, so the state has words whether
          or not anyone can see the colour. */}
      {!notification.read && (
        <StatusIndicator label="Unread" tone="info" size="sm" className="mt-1 shrink-0" />
      )}
    </span>
  );

  if (destination) {
    return (
      <Link
        href={destination.href}
        // Read the moment it is opened; the badge settles on the server's own
        // total from the response.
        onClick={() => {
          onRead(notification.id);
          onNavigate();
        }}
        className={rowClassName}
        title={destination.hint}
      >
        {content}
        <span className="sr-only">{destination.hint}</span>
      </Link>
    );
  }

  return (
    <button type="button" className={rowClassName} onClick={() => onRead(notification.id)}>
      {content}
    </button>
  );
}
