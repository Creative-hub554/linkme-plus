import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function requireAuth(request: Request) {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session) {
    return {
      session: null,
      error: NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      ),
    };
  }

  return { session, error: null };
}

export async function optionalAuth(request: Request) {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  return { session };
}

export function successResponse(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function paginatedResponse(data: unknown[], total: number, page: number, limit: number) {
  return NextResponse.json({
    data,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasMore: page * limit < total,
    },
  });
}

/**
 * Cursor-paginated payload. There is deliberately no `total`: counting the
 * whole relation on every page request is the expensive part of a deep list,
 * and clients only need to know whether another page exists.
 */
export function cursorPaginatedResponse(data: unknown[], limit: number, nextCursor: string | null) {
  return NextResponse.json({
    data,
    pagination: {
      limit,
      nextCursor,
      hasMore: Boolean(nextCursor),
    },
  });
}
