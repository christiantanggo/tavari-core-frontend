ALTER TABLE public.mail_content_analytics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view mail content analytics for their business"
  ON public.mail_content_analytics;

CREATE POLICY "Users can view mail content analytics for their business"
  ON public.mail_content_analytics
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.mail_campaigns mc
      WHERE mc.id = mail_content_analytics.campaign_id
        AND (
          EXISTS (
            SELECT 1
            FROM public.business_users bu
            WHERE bu.business_id = mc.business_id
              AND bu.user_id = auth.uid()
          )
          OR EXISTS (
            SELECT 1
            FROM public.user_roles ur
            WHERE ur.business_id = mc.business_id
              AND ur.user_id = auth.uid()
          )
        )
    )
  );

GRANT SELECT ON public.mail_content_analytics TO authenticated;
