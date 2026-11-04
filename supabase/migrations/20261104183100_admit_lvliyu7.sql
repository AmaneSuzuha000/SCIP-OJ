-- Admit lvliyu7 (GitHub provider ID 346142220).
--
-- The allow-list is a hard-coded set of immutable GitHub provider IDs inside
-- private.site_identity_allowed, so adding one means replacing that function.
-- Editing the earlier migration would not help: it has already been applied to
-- the deployed database, and nothing re-runs it.
--
-- Every dependent function (private.has_site_access, public.check_site_access,
-- public.check_site_user_access) calls through to this one, so replacing it is
-- enough to admit the account everywhere at once.
CREATE OR REPLACE FUNCTION private.site_identity_allowed(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM auth.identities i
    WHERE i.user_id = p_user_id AND i.provider = 'github'
      AND i.provider_id IN (
        '177200341',  -- AmaneSuzuha000
        '30373542',   -- pengguo318
        '346142220'   -- lvliyu7
      )
  );
$$;

-- CREATE OR REPLACE keeps the existing ACL, but re-assert it so this file alone
-- documents the intended permissions rather than relying on history.
REVOKE ALL ON FUNCTION private.site_identity_allowed(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.site_identity_allowed(uuid) TO service_role;
