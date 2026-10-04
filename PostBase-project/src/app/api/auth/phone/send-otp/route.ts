import { createClient } from "@/utils/supabase/server";
import { errorResponse, successResponse } from "@/lib/api-helpers";

/**
 * Start a phone sign-in: hand the number to Supabase, which generates the code,
 * delivers it by SMS, stores it, and expires it.
 *
 * The route owns none of that any more. The stub it replaces generated a code of
 * its own and never stored or sent it, which is why the paired verify could only
 * ever check a length. Here Supabase holds the code with its own expiry and rate
 * limit, so a provider rejection is the only thing that can go wrong, and it is
 * answered `502` — an upstream failure, distinct from the route's own `500`.
 */
export async function POST(request: Request) {
  try {
    const { phoneNumber } = await request.json();

    if (typeof phoneNumber !== "string" || phoneNumber.trim() === "") {
      return errorResponse("Phone number is required");
    }

    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithOtp({ phone: phoneNumber });

    if (error) {
      console.error("Send OTP error:", error);
      return errorResponse("Failed to send OTP", 502);
    }

    return successResponse({ success: true, message: "OTP sent successfully" });
  } catch (error) {
    console.error("Send OTP error:", error);
    return errorResponse("Failed to send OTP", 500);
  }
}
