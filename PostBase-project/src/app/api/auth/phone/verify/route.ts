import { createClient } from "@/utils/supabase/server";
import { errorResponse, successResponse } from "@/lib/api-helpers";

/**
 * Finish a phone sign-in: hand the code to Supabase, which checks it against the
 * code it generated for this number — enforcing its expiry and consuming it on
 * success — and only then establishes the session.
 *
 * Nothing about the code is decided here. A wrong, expired or already-used code
 * is the upstream error and is answered `400`, which is the whole of the fix: the
 * stub this replaces accepted any six characters and always answered success.
 * The session is set on the response by the Supabase server client's cookie
 * adapter, so a `200` means the caller is actually signed in.
 */
export async function POST(request: Request) {
  try {
    const { phoneNumber, code } = await request.json();

    if (
      typeof phoneNumber !== "string" ||
      phoneNumber.trim() === "" ||
      typeof code !== "string" ||
      code.trim() === ""
    ) {
      return errorResponse("Phone number and code are required");
    }

    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      phone: phoneNumber,
      token: code,
      type: "sms",
    });

    if (error) {
      console.error("Verify OTP error:", error);
      return errorResponse("Invalid or expired code");
    }

    return successResponse({ success: true, message: "Phone number verified successfully" });
  } catch (error) {
    console.error("Verify OTP error:", error);
    return errorResponse("Failed to verify OTP", 500);
  }
}
