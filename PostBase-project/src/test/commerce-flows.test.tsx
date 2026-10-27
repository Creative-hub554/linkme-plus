// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  cleanupSurfaces,
  mountSurface,
  type MountedSurface,
} from "@/test/render";
import { json, stubFetch } from "@/test/stub-fetch";
const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  useParams: () => ({ id: "item-1" }),
}));
vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ session: { user: { id: "buyer" } }, loading: false }),
}));

async function submit(ui: MountedSurface) {
  await act(async () => {
    ui.container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanupSurfaces();
  vi.unstubAllGlobals();
});

test("publishes a listing and retries a failed publish without creating another draft", async () => {
  let publishes = 0;
  const requests = stubFetch({
    "/api/marketplace/categories": { categories: [] },
    "/api/marketplace": (request) =>
      request.method === "POST"
        ? { listing: { id: "draft-1" } }
        : ++publishes === 1
          ? json({ error: "Try again" }, 503)
          : { listing: { id: "draft-1", status: "active" } },
  });
  const { default: Page } = await import("@/app/(main)/marketplace/new/page");
  const ui = mountSurface(<Page />);
  (ui.container.querySelector("#title") as HTMLInputElement).value = "Camera";
  (ui.container.querySelector("#price") as HTMLInputElement).value = "100";
  await submit(ui);
  expect(ui.container.textContent).toContain("Retry publishing draft");
  expect(navigation.push).not.toHaveBeenCalled();
  await submit(ui);
  expect(requests.calls.filter((call) => call.method === "POST")).toHaveLength(
    1,
  );
  expect(navigation.push).toHaveBeenCalledWith("/marketplace/draft-1");
});

test("contacts a listing seller with the listing context and opens the returned conversation", async () => {
  const requests = stubFetch({
    "/api/marketplace": {
      listing: {
        id: "item-1",
        sellerId: "seller-1",
        title: "Camera",
        priceMin: 100,
        status: "active",
      },
      media: [],
    },
    "/api/messages": { conversationId: "chat-1" },
  });
  const { default: Page } = await import("@/app/(main)/marketplace/[id]/page");
  const ui = mountSurface(<Page />);
  await ui.waitFor(() => Boolean(ui.container.querySelector("form")));
  await submit(ui);
  expect(
    requests.calls.find((call) => call.pathname === "/api/messages")?.body,
  ).toEqual({
    recipientId: "seller-1",
    content: "Regarding Camera: Hi, is this still available?",
  });
  expect(navigation.push).toHaveBeenCalledWith("/messages?c=chat-1");
});

test("submits a job application and shows the server's status", async () => {
  const requests = stubFetch({
    "/api/jobs": {
      job: {
        id: "item-1",
        title: "Designer",
        status: "active",
        company: { name: "Studio" },
      },
      hasApplied: false,
    },
    "/api/jobs/applications": { application: { status: "pending" } },
  });
  const { default: Page } = await import("@/app/(main)/jobs/[id]/page");
  const ui = mountSurface(<Page />);
  await ui.waitFor(() => Boolean(ui.container.querySelector("form")));
  (ui.container.querySelector("#coverLetter") as HTMLTextAreaElement).value =
    "I would love to join.";
  await submit(ui);
  expect(
    requests.calls.find((call) => call.pathname === "/api/jobs/applications")
      ?.body,
  ).toMatchObject({ jobId: "item-1", coverLetter: "I would love to join." });
  expect(ui.container.textContent).toContain("Application submitted · pending");
  expect(ui.container.querySelector("form")).toBeNull();
});

test("does not offer an application form for a closed job", async () => {
  stubFetch({
    "/api/jobs": {
      job: { title: "Designer", status: "closed", company: { name: "Studio" } },
      hasApplied: false,
    },
  });
  const { default: Page } = await import("@/app/(main)/jobs/[id]/page");
  const ui = mountSurface(<Page />);
  await ui.waitFor(() =>
    Boolean(ui.container.textContent?.includes("no longer accepting")),
  );
  expect(ui.container.querySelector("form")).toBeNull();
});

test("creates a company for a managed Page before posting its first job", async () => {
  const requests = stubFetch({
    "/api/companies": (request) =>
      request.method === "GET"
        ? { companies: [], pages: [{ id: "page-1", name: "Studio" }] }
        : { company: { id: "company-1", name: "Studio" } },
    "/api/jobs": { job: { id: "job-1" } },
  });
  const { default: Page } = await import("@/app/(main)/jobs/new/page");
  const ui = mountSurface(<Page />);
  await ui.waitFor(() => Boolean(ui.container.querySelector("form")));
  (ui.container.querySelector("#title") as HTMLInputElement).value = "Designer";
  await submit(ui);
  expect(
    requests.calls.find(
      (call) => call.pathname === "/api/companies" && call.method === "POST",
    )?.body,
  ).toEqual({ pageId: "page-1" });
  expect(
    requests.calls.find((call) => call.pathname === "/api/jobs")?.body,
  ).toMatchObject({ companyId: "company-1", title: "Designer" });
  expect(navigation.push).toHaveBeenCalledWith("/jobs/job-1");
});
