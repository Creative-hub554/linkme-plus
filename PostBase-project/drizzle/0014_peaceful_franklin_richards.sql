-- ADD COLUMN with a DEFAULT seeds every existing profile in the same
-- statement (Postgres fills existing rows with the default immediately), so a
-- member who never opened the Theme Studio still reads back a valid Standard
-- configuration — the GET route never answers a null-valued row after this
-- migration, and rows inserted later by the profile-provisioning paths pick up
-- the same default because every insert omits the column.
ALTER TABLE "profiles" ADD COLUMN "theme_config" jsonb DEFAULT '{"layoutId":"classic-spotlight","styleId":"sakura-blossom","standard":true,"blocks":[{"id":"highlights","included":true,"position":0},{"id":"interests","included":true,"position":1},{"id":"media-strip","included":true,"position":2},{"id":"quote","included":false,"position":3},{"id":"links","included":false,"position":4}],"decorations":[],"motion":false}'::jsonb NOT NULL;