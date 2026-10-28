-- Application admission only. Public Pages assets remain public by design.
-- Authorize immutable GitHub provider IDs, never editable user_metadata.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.site_identity_allowed(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM auth.identities i
    WHERE i.user_id = p_user_id AND i.provider = 'github'
      AND i.provider_id IN (
        '177200341', -- AmaneSuzuha000
        '30373542'   -- pengguo318
      )
  );
$$;
REVOKE ALL ON FUNCTION private.site_identity_allowed(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.site_identity_allowed(uuid) TO service_role;

CREATE OR REPLACE FUNCTION private.has_site_access()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.site_identity_allowed(auth.uid());
$$;
REVOKE ALL ON FUNCTION private.has_site_access() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.has_site_access() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.check_site_access()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.has_site_access();
$$;
REVOKE ALL ON FUNCTION public.check_site_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_site_access() TO authenticated, service_role;

-- Only trusted Edge Functions may check a user obtained through auth.getUser.
CREATE OR REPLACE FUNCTION public.check_site_user_access(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.site_identity_allowed(p_user_id);
$$;
REVOKE ALL ON FUNCTION public.check_site_user_access(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_site_user_access(uuid) TO service_role;

-- Restrictive policies AND the whitelist with existing course/ownership rules.
-- They grant no new read or write privileges, including on private task tables.
DO $$ DECLARE relation record;
BEGIN
  FOR relation IN SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity
  LOOP
    EXECUTE format('CREATE POLICY site_access_only ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING ((SELECT private.has_site_access())) WITH CHECK ((SELECT private.has_site_access()))', relation.relname);
  END LOOP;
END $$;

-- Protect REST queries, views and SECURITY DEFINER RPCs before they execute.
-- Existing trusted grading workers/callbacks continue using service_role.
CREATE OR REPLACE FUNCTION public.require_site_access()
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE claims jsonb := coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb);
BEGIN
  IF coalesce(claims->>'role',nullif(current_setting('request.jwt.claim.role',true),'')) = 'service_role' THEN RETURN; END IF;
  IF NOT private.has_site_access() THEN
    RAISE EXCEPTION 'SITE_ACCESS_DENIED' USING ERRCODE='42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.require_site_access() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.require_site_access() TO anon, authenticated, service_role;
ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.require_site_access';
-- Defense in depth for removable project-owned GraphQL grants. Supabase-owned
-- grants can remain; admission must also be verified on the live GraphQL gateway.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='graphql_public') THEN
    EXECUTE 'REVOKE USAGE ON SCHEMA graphql_public FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT USAGE ON SCHEMA graphql_public TO service_role';
  END IF;
END $$;
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
