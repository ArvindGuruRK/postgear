-- Read-only database login for Claude Code's Postgres MCP server (local dev only).
--
-- The MCP server also runs in its own read-only mode, but that is a second
-- layer: this role is the real boundary. It can read every table, cannot write
-- anything, and cannot see the columns that hold secrets (password hashes,
-- token hashes, encrypted OAuth tokens, API key hashes, webhook and OAuth app
-- secrets), so none of them can reach a model.
--
-- Safe to run again at any time: `npm run db:readonly-role`. Run it after a
-- fresh `docker compose down -v` + `npm run db:migrate`, and after a migration
-- that adds a table or column holding a secret (add it to the list below).

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'claude_readonly') THEN
    CREATE ROLE claude_readonly LOGIN PASSWORD 'claude_readonly';
  END IF;
END
$$;

-- Every session is read-only and cannot run away with the database.
ALTER ROLE claude_readonly SET default_transaction_read_only = on;
ALTER ROLE claude_readonly SET statement_timeout = '15s';

GRANT CONNECT ON DATABASE postgear_db TO claude_readonly;
GRANT USAGE ON SCHEMA public TO claude_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO claude_readonly;

-- Tables the postgres user creates later (new migrations) are readable too.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT ON TABLES TO claude_readonly;

-- Hide secret columns: swap the table-wide grant for a column list without them.
-- A column added to one of these tables later stays hidden until this runs again.
DO $$
DECLARE
  secret record;
  readable text;
BEGIN
  FOR secret IN
    SELECT t.table_name, t.hidden
    FROM (VALUES
      ('User',               ARRAY['password', 'activationTokenHash', 'passwordResetTokenHash']),
      ('Organization',       ARRAY['apiKey']),
      ('Integration',        ARRAY['token', 'refreshToken']),
      ('Webhooks',           ARRAY['secret']),
      ('ApiKey',             ARRAY['keyHash']),
      ('OAuthApp',           ARRAY['clientSecret']),
      ('OAuthAuthorization', ARRAY['accessToken']),
      ('AutomationConnection', ARRAY['credentials'])
    ) AS t(table_name, hidden)
    WHERE EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t.table_name
    )
  LOOP
    SELECT string_agg(format('%I', column_name), ', ' ORDER BY ordinal_position)
      INTO readable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = secret.table_name
        AND column_name <> ALL (secret.hidden);

    EXECUTE format('REVOKE SELECT ON public.%I FROM claude_readonly', secret.table_name);
    EXECUTE format('GRANT SELECT (%s) ON public.%I TO claude_readonly', readable, secret.table_name);
  END LOOP;
END
$$;
