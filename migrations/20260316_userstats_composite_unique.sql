-- PostgreSQL migration: UserStats unique constraint alignment
-- 1) Drop old single-column unique indexes on ("userJid") and ("chatJid")
-- 2) Remove duplicates while keeping the newest row per ("userJid", "chatJid")
-- 3) Create composite unique index on ("userJid", "chatJid")

BEGIN;

-- Drop single-column UNIQUE indexes for userstats.userJid/chatJid, regardless of index name.
DO $$
DECLARE
  idx record;
BEGIN
  FOR idx IN
    SELECT i.relname AS index_name
    FROM pg_class t
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_index ix ON ix.indrelid = t.oid
    JOIN pg_class i ON i.oid = ix.indexrelid
    WHERE n.nspname = current_schema()
      AND t.relname = 'userstats'
      AND ix.indisunique = true
      AND ix.indnatts = 1
      AND (
        SELECT a.attname
        FROM pg_attribute a
        WHERE a.attrelid = t.oid
          AND a.attnum = ANY(ix.indkey)
        LIMIT 1
      ) IN ('userJid', 'chatJid')
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I.%I', current_schema(), idx.index_name);
  END LOOP;
END $$;

-- Deduplicate rows before adding composite unique index.
-- Keep the latest row (highest id, then updatedAt, then ctid fallback) for each (userJid, chatJid).
WITH ranked AS (
  SELECT
    ctid,
    ROW_NUMBER() OVER (
      PARTITION BY "userJid", "chatJid"
      ORDER BY "id" DESC NULLS LAST, "updatedAt" DESC NULLS LAST, ctid DESC
    ) AS rn
  FROM "userstats"
)
DELETE FROM "userstats" u
USING ranked r
WHERE u.ctid = r.ctid
  AND r.rn > 1;

-- Create target composite unique index.
CREATE UNIQUE INDEX IF NOT EXISTS userstats_userjid_chatjid_unique
  ON "userstats" ("userJid", "chatJid");

COMMIT;
