import { afterEach, describe, expect, it, vi } from "vitest";
import vinextWorker from "./index";

/**
 * The worker's whole behaviour is a fallback: `vinext` installs the real handler
 * on `globalThis.__vinext_fetch`, and this module forwards to it — or answers
 * 404 when nothing installed one. The absent case matters because it is what a
 * misconfigured deployment gets instead of a hang or a stack trace.
 */
type VinextHost = {
  __vinext_fetch?: (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;
};

function callWorker() {
  return vinextWorker.fetch(new Request("http://localhost/hello"), {} as Env, {} as ExecutionContext);
}

afterEach(() => {
  delete (globalThis as VinextHost).__vinext_fetch;
});

describe("the vinext worker shim", () => {
  it("answers 404 when no handler has been installed", async () => {
    delete (globalThis as VinextHost).__vinext_fetch;

    const response = await callWorker();
    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("Not Found");
  });

  it("delegates to the installed handler, passing the request through", async () => {
    const fetchSpy = vi.fn(async (request: Request) => new Response(`handled ${new URL(request.url).pathname}`));
    (globalThis as VinextHost).__vinext_fetch = fetchSpy;

    const response = await callWorker();
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("handled /hello");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBeInstanceOf(Request);
  });
});
