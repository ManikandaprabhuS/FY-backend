-- Notification reads only. Business writes continue through the existing backend.
BEGIN;
CREATE SCHEMA IF NOT EXISTS frameyaad_private;
REVOKE ALL ON SCHEMA frameyaad_private FROM PUBLIC;
GRANT USAGE ON SCHEMA frameyaad_private TO authenticated;

CREATE OR REPLACE FUNCTION frameyaad_private.notification_role(allowed_roles text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = (SELECT auth.uid())::text
      AND u."isActive" = true AND u.role::text = ANY(allowed_roles)
  );
$$;
REVOKE ALL ON FUNCTION frameyaad_private.notification_role(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION frameyaad_private.notification_role(text[]) TO authenticated;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notifications, public.customer_notifications FROM anon, authenticated;
GRANT SELECT ON public.notifications, public.customer_notifications TO authenticated;

CREATE POLICY fy_notification_customer_read ON public.notifications FOR SELECT TO authenticated
USING ("userId" = (SELECT auth.uid())::text AND frameyaad_private.notification_role(ARRAY['CUSTOMER']));
CREATE POLICY fy_notification_staff_read ON public.notifications FOR SELECT TO authenticated
USING ("userId" IS NULL AND frameyaad_private.notification_role(ARRAY['ADMIN','EMPLOYEE']));
CREATE POLICY fy_customer_notification_read ON public.customer_notifications FOR SELECT TO authenticated
USING ("userId" = (SELECT auth.uid())::text AND frameyaad_private.notification_role(ARRAY['CUSTOMER']));

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='notifications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='customer_notifications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.customer_notifications;
  END IF;
END $$;
COMMIT;
