/** Read API failures as errors so forms never claim an unsuccessful write succeeded. */
export async function clientRequest<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? "Please sign in to continue."
        : payload?.error || "Request failed. Please try again.",
    );
  if (payload === null) throw new Error("Unable to read the server response. Please try again.");
  return payload as T;
}

export function jsonBody(body: unknown, method = "POST"): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
