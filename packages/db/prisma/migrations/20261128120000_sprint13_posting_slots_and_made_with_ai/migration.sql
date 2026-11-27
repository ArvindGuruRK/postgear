-- Sprint 13 Module 13: posting slots and Made With AI.
--
-- 1. `Integration.postingTimes` keeps its JSON list; each entry gains
--    `windowMinutes` (0 = exact) and `days` (ISO weekdays, all seven), so
--    every existing channel behaves exactly as before. Idempotent: an entry
--    that already has a key keeps its own value. A row whose text is not a
--    JSON list is left alone (the reader falls back to the defaults).
-- 2. `Post.madeWithAi`, false for every existing post.

ALTER TABLE "Integration"
  ALTER COLUMN "postingTimes"
  SET DEFAULT '[{"time":120,"windowMinutes":0,"days":[1,2,3,4,5,6,7]},{"time":400,"windowMinutes":0,"days":[1,2,3,4,5,6,7]},{"time":700,"windowMinutes":0,"days":[1,2,3,4,5,6,7]}]';

DO $$
DECLARE
  row_id TEXT;
  raw TEXT;
  parsed JSONB;
BEGIN
  FOR row_id, raw IN SELECT "id", "postingTimes" FROM "Integration" LOOP
    BEGIN
      parsed := raw::jsonb;
    EXCEPTION WHEN others THEN
      CONTINUE;
    END;
    IF jsonb_typeof(parsed) <> 'array' THEN
      CONTINUE;
    END IF;
    UPDATE "Integration"
    SET "postingTimes" = COALESCE(
      (
        SELECT jsonb_agg(
          CASE
            WHEN jsonb_typeof(entry) = 'object'
              THEN jsonb_build_object('windowMinutes', 0, 'days', '[1,2,3,4,5,6,7]'::jsonb) || entry
            ELSE entry
          END
          ORDER BY position
        )
        FROM jsonb_array_elements(parsed) WITH ORDINALITY AS item(entry, position)
      ),
      '[]'::jsonb
    )::text
    WHERE "id" = row_id;
  END LOOP;
END $$;

ALTER TABLE "Post" ADD COLUMN "madeWithAi" BOOLEAN NOT NULL DEFAULT false;
