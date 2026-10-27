import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { isRestrictedAccount } from "@/lib/account-restrictions";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        supabaseResponse = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // Refresh session
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Protected routes. `/marketplace/saved` is the saved shelf — a member's
  // own read reached from the account menu, like Profile and Settings; the
  // marketplace browse surface above it stays public.
  const protectedRoutes = ["/feed", "/profile", "/settings", "/messages", "/cover-studio", "/marketplace/saved", "/marketplace/new", "/marketplace/inventory", "/jobs/new", "/jobs/manage", "/advertising", "/admin"];
  const isProtected = protectedRoutes.some((route) =>
    request.nextUrl.pathname.startsWith(route)
  );

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (isProtected && user && await isRestrictedAccount(user.id)) {
    const url = request.nextUrl.clone(); url.pathname = "/account-restricted"; url.search = "";
    const redirect = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach(cookie => redirect.cookies.set(cookie));
    return redirect;
  }

  return supabaseResponse;
}
