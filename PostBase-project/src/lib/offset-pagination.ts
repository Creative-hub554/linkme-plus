/** Bound every offset query, including malformed or deliberately oversized input. */
export function offsetPagination(params: URLSearchParams, defaultLimit = 20) {
  const integer = (value: string | null, fallback: number, max: number) => {
    if (!value || !/^\d+$/.test(value)) return fallback;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed)
      ? Math.max(1, Math.min(parsed, max))
      : max;
  };
  const page = integer(params.get("page"), 1, 10000);
  const limit = integer(params.get("limit"), defaultLimit, 100);
  return { page, limit, offset: (page - 1) * limit };
}
