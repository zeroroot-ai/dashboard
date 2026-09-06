-- Forward: add provider_profiles JSONB column to Better Auth's "user" table.
-- Idempotent: IF NOT EXISTS means running this twice is a no-op.
--
-- The column stores provider-supplied profile claims (avatar_url, name, etc.)
-- from the most-recent OAuth callback for each social provider. It is nullable
-- so that users who signed up via email+password are unaffected.
--
-- Better Auth uses quoted "user" for its table name (see @better-auth/core db schema).

-- Forward migration:
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS provider_profiles JSONB NULL;

-- Reverse migration (run manually; the runner only fires the forward path):
-- ALTER TABLE "user" DROP COLUMN IF EXISTS provider_profiles;
