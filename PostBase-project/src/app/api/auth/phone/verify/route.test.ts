import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The phone OTP verify step: the code is checked by Supabase, not by the route.
 *
 * This is the fix for the stub that accepted any six characters and always
 * answered success: the route no longer decides anything about the code's shape.
 * It refuses a missing or non-string phone/code (`400`, calling nothing), hands
 * every non-empty code to `verifyOtp` as the `sms` token, and maps the provider's
 * answer — a wrong, expired or spent code is its error, answered `400 Invalid or
 * expired code`; a clean answer is `200`. One test pins that a code the old stub
 * would have rejected locally (`"abcdef"`) is instead handed to the provider,
 * which is what "server-side" means here.
 *
 * The Supabase client is mocked — `verifyOtp` would otherwise need a live code —
 * so the provider's verdict is scripted and the route's mapping is what is read.
 */
const supabase = vi.hoisted(() => ({ verifyOtp: vi.fn() }));

vi.mock("@/utils/supabase/server", () => ({
  createClient: async () => ({ auth: supabase }),
}));

import { POST } from "./route";

function verify(body: unknown) {
  return new Request("http://localhost/api/auth/phone/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  supabase.verifyOtp.mockResolvedValue({ error: null });
});

describe("POST /api/auth/phone/verify", () => {
  it("requires a phone number and a code, calling nothing", async () => {
    for (const body of [
      { phoneNumber: "+15551234567" },
      { code: "123456" },
      { phoneNumber: "", code: "123456" },
      { phoneNumber: "+15551234567", code: "   " },
      { phoneNumber: 42, code: "123456" },
      { phoneNumber: "+15551234567", code: 123456 },
    ]) {
      const response = await POST(verify(body));

      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toEqual({
        error: "Phone number and code are required",
      });
    }
    expect(supabase.verifyOtp).not.toHaveBeenCalled();
  });

  it("checks the code with Supabase as an sms token", async () => {
    const response = await POST(verify({ phoneNumber: "+15551234567", code: "123456" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      message: "Phone number verified successfully",
    });
    expect(supabase.verifyOtp).toHaveBeenCalledWith({
      phone: "+15551234567",
      token: "123456",
      type: "sms",
    });
  });

  it("answers 400 when Supabase rejects the code", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    supabase.verifyOtp.mockResolvedValueOnce({ error: { message: "Token has expired" } });
    try {
      const response = await POST(verify({ phoneNumber: "+15551234567", code: "123456" }));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid or expired code" });
    } finally {
      silence.mockRestore();
    }
  });

  it("hands even a non-six-character code to the provider rather than judging it locally", async () => {
    // The old stub rejected this with its own length check. The check is
    // Supabase's now, so the route must pass the code on and let the provider
    // refuse it — here it does, and the route maps that to the same 400.
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    supabase.verifyOtp.mockResolvedValueOnce({ error: { message: "Invalid token" } });
    try {
      const response = await POST(verify({ phoneNumber: "+15551234567", code: "abcdef" }));

      expect(response.status).toBe(400);
      expect(supabase.verifyOtp).toHaveBeenCalledWith({
        phone: "+15551234567",
        token: "abcdef",
        type: "sms",
      });
    } finally {
      silence.mockRestore();
    }
  });

  it("answers 500 when the body is not JSON", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await POST(verify("not json"));

      expect(response.status).toBe(500);
      expect(supabase.verifyOtp).not.toHaveBeenCalled();
    } finally {
      silence.mockRestore();
    }
  });
});
