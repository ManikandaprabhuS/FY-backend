CREATE TABLE IF NOT EXISTS public.offers (
 code varchar(20) PRIMARY KEY CHECK(code IN ('FIRST_ORDER','BIG_ORDER')),
 title varchar(80) NOT NULL, description varchar(200) NOT NULL,
 percentage decimal(5,2) NOT NULL CHECK(percentage>0 AND percentage<=100),
 "minOrderAmount" decimal(12,0),
 enabled boolean NOT NULL DEFAULT true, "updatedBy" text,
 "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 CHECK((code='FIRST_ORDER' AND "minOrderAmount" IS NULL) OR (code='BIG_ORDER' AND "minOrderAmount">0))
);
CREATE TABLE IF NOT EXISTS public.offer_audit (
 id text PRIMARY KEY, "offerCode" varchar(20) NOT NULL REFERENCES public.offers(code) ON DELETE RESTRICT,
 field varchar(30) NOT NULL CHECK(field IN ('percentage','minOrderAmount','enabled')),
 "oldValue" jsonb NOT NULL, "newValue" jsonb NOT NULL, "actorId" text NOT NULL,
 "actorName" varchar(120) NOT NULL, "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "offer_audit_offerCode_createdAt_idx" ON public.offer_audit ("offerCode","createdAt" DESC);
ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offer_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.offers FROM anon, authenticated;
REVOKE ALL ON public.offer_audit FROM anon, authenticated;
