// Read-only public availability and signed-out authorization checks.
const target = process.argv[2];
if (!target) {
  console.error("Usage: node scripts/launch-smoke.mjs https://linkmeplus.com");
  process.exit(2);
}
const origin = new URL(target);
if (
  !["http:", "https:"].includes(origin.protocol) ||
  origin.username ||
  origin.password ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash
) {
  throw new Error(
    "Supply an HTTP(S) origin without credentials, path, query, or fragment",
  );
}
const checks = [
  ...["/", "/login", "/jobs", "/marketplace", "/privacy", "/terms"].map(
    (path) => ({ path, expected: 200 }),
  ),
  ...[
    "/api/admin/overview",
    "/api/admin/jobs",
    "/api/admin/reports",
    "/api/messages",
    "/api/verification",
  ].map((path) => ({ path, expected: 401 })),
];
let failures = 0;
for (const { path, expected } of checks) {
  try {
    const response = await fetch(new URL(path, origin), {
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
      headers: { Accept: expected === 200 ? "text/html" : "application/json" },
    });
    const body = await response.text();
    const passed =
      response.status === expected &&
      (expected !== 200 ||
        (response.headers.get("content-type")?.includes("text/html") &&
          !/Internal Server Error|Application error: a server-side exception/i.test(
            body,
          )));
    if (!passed) failures++;
    console.log(
      JSON.stringify({ path, expected, actual: response.status, passed }),
    );
  } catch {
    failures++;
    console.log(
      JSON.stringify({
        path,
        expected,
        passed: false,
        error: "Request failed or timed out",
      }),
    );
  }
}
console.log(
  JSON.stringify({
    checkedAt: new Date().toISOString(),
    checks: checks.length,
    failures,
  }),
);
process.exitCode = failures ? 1 : 0;
