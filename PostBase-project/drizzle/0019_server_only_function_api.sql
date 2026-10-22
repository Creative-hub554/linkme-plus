-- The table/sequence boundary in 0018 does not cover PostgREST RPC endpoints.
-- LinkMe+ invokes database functions only through trusted server-side work, so
-- browser roles must not execute public functions directly.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- Keep direct RPC closed for future postgres-owned public functions as well.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
