/**
 * `vinext` installs its request handler on the global object, so the fetch shim
 * has to reach through `globalThis`. The global is declared here rather than
 * reached through `any` so that a typo in its name is a compile error.
 */
type VinextGlobal = typeof globalThis & {
  __vinext_fetch?: (
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ) => Promise<Response>;
};

const vinextWorker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return (globalThis as VinextGlobal).__vinext_fetch?.(request, env, ctx) ??
      new Response("Not Found", { status: 404 });
  },
};

export default vinextWorker;
