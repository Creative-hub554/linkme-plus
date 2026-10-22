-- LinkMe+ routes all application data access through its server API.  Keep
-- Supabase's exposed public schema closed to browser Data API roles even if a
-- future RLS policy is added accidentally.  The server's database role and
-- service_role retain their existing access.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- The current schema is owned by postgres. These defaults make the same
-- server-only boundary apply to tables and sequences created by future
-- migrations under that role.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM anon, authenticated;
