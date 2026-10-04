import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The phone OTP send step: the number is handed to Supabase, which owns the
 * code, its delivery, and its expiry.
 *
 * The route generates nothing and stores nothing, so what a test can pin is that
 * it calls the provider with the number and maps the answer: a missing or
 * non-string number is a `400` **before** the provider is called, a provider
 * rejection is a `502` (upstream, not the route's own failure), a body that is
 * not JSON is a `500`, and a clean answer is a `200`. The Supabase client is
 * mocked — `signInWithOtp` sends a real SMS — which is the boundary that says the
 * provider call itself is out of scope.
 */
const supabase = vi.hoisted(() => ({ signInWithOtp: vi.fn() }));

vi.mock("@/utils/supabase/server", () => ({
  createClient: async () => ({ auth: supabase }),
}));

import { POST } from "./route";

function send(body: unknown) {
  return new Request("http://localhost/api/auth/phone/send-otp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  supabase.signInWithOtp.mockResolvedValue({ error: null });
});

describe("POST /api/auth/phone/send-otp", () => {
  it("requires a non-empty phone number, calling nothing", async () => {
    for (const phoneNumber of [undefined, null, "", "   ", 42]) {
      const response = await POST(send({ phoneNumber }));

      expect(response.status, JSON.stringify(phoneNumber)).toBe(400);
      expect(await response.json()).toEqual({ error: "Phone number is required" });
    }
    expect(supabase.signInWithOtp).not.toHaveBeenCalled();
  });

  it("asks Supabase to send the code to the number", async () => {
    const response = await POST(send({ phoneNumber: "+15551234567" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      message: "OTP sent successfully",
    });
    expect(supabase.signInWithOtp).toHaveBeenCalledWith({ phone: "+15551234567" });
  });

  it("answers 502 when the provider rejects the request", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    supabase.signInWithOtp.mockResolvedValueOnce({ error: { message: "provider down" } });
    try {
      const response = await POST(send({ phoneNumber: "+15551234567" }));

      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: "Failed to send OTP" });
    } finally {
      silence.mockRestore();
    }
  });

  it("answers 500 when the body is not JSON", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await POST(send("not json"));

      expect(response.status).toBe(500);
      expect(supabase.signInWithOtp).not.toHaveBeenCalled();
    } finally {
      silence.mockRestore();
    }
  });
});
