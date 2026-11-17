// @vitest-environment jsdom
import { act } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { cleanupSurfaces, mountSurface } from "@/test/render";
import { stubFetch } from "@/test/stub-fetch";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("c=chat-a"),
}));
vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ session: { user: { id: "viewer" } } }),
}));
import MessagesPage from "./page";
afterEach(() => {
  cleanupSurfaces();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("filters conversations, refreshes incoming messages, and preserves the selected thread while polling", async () => {
  vi.useFakeTimers();
  let incoming = false;
  const requests = stubFetch({
    "/api/messages": (request) =>
      request.query.has("id")
        ? {
            messages: incoming
              ? [
                  {
                    id: "message-1",
                    senderId: "b",
                    content: "New incoming message",
                    createdAt: "2026-01-01T12:00:00Z",
                  },
                ]
              : [],
          }
        : {
            conversations: [
              {
                id: "chat-a",
                otherMember: { userId: "a", name: "Alice" },
                unreadCount: 0,
              },
              {
                id: "chat-b",
                otherMember: { userId: "b", name: "Bob" },
                unreadCount: 2,
              },
            ],
          },
  });
  const ui = mountSurface(<MessagesPage />);
  await act(async () => {});
  expect(ui.container.textContent).toContain("2");
  const bob = [...ui.container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Bob"),
  );
  expect(bob).toBeTruthy();
  await ui.click(bob!);
  incoming = true;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(ui.container.textContent).toContain("New incoming message");
  expect(
    requests.calls
      .filter((call) => call.query.has("id"))
      .at(-1)
      ?.query.get("id"),
  ).toBe("chat-b");
  await ui.type(
    ui.container.querySelector(
      '[aria-label="Search conversations"]',
    ) as HTMLInputElement,
    "Bob",
  );
  expect(
    [...ui.container.querySelectorAll("button")].some((button) =>
      button.textContent?.includes("Alice"),
    ),
  ).toBe(false);
  expect(
    [...ui.container.querySelectorAll("button")].some((button) =>
      button.textContent?.includes("Bob"),
    ),
  ).toBe(true);
});
