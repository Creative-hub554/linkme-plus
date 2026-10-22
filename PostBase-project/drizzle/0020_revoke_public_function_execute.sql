-- Existing functions may inherit EXECUTE through Postgres's PUBLIC default.
-- 0019 prevents this on fresh databases; this follow-up closes that inherited
-- permission on projects where the preceding migration has already run.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
