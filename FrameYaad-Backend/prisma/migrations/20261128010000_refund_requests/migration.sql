BEGIN;
ALTER TABLE public."Order" ADD COLUMN "deliveredAt" timestamptz(3),ADD COLUMN "refundedAmount" numeric(12,2) NOT NULL DEFAULT 0,ADD COLUMN "completedReturnRefund" numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public."Order" ADD CONSTRAINT order_return_amounts_check CHECK ("refundedAmount">=0 AND "refundedAmount"<="totalAmount" AND "completedReturnRefund">=0 AND "completedReturnRefund"<="refundedAmount");
UPDATE public."Order" o SET "deliveredAt"=(SELECT min((e->>'changedAt')::timestamptz) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o."statusHistory")='array' THEN o."statusHistory" ELSE '[]'::jsonb END) e WHERE e->>'status'='DELIVERED' AND e->>'changedAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$') WHERE o."orderStatus"='DELIVERED';
CREATE TABLE public.refund_requests (
 id text PRIMARY KEY,"orderId" text NOT NULL REFERENCES public."Order"(id) ON DELETE RESTRICT,"userId" text NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
 "reasonCategory" varchar(80) NOT NULL DEFAULT '',"reasonDetails" varchar(500) NOT NULL DEFAULT '',"preferredResolution" varchar(20) NOT NULL DEFAULT 'REFUND',"affectedItemIds" text[] NOT NULL DEFAULT '{}',
 status varchar(20) NOT NULL DEFAULT 'REQUESTED',resolution varchar(20),"approvedAmount" numeric(12,2),"adminMessage" varchar(500) NOT NULL DEFAULT '',"internalNotes" varchar(2000) NOT NULL DEFAULT '',"refundStatus" varchar(10),
 "requestedAt" timestamptz(3),"reviewedAt" timestamptz(3),"closedAt" timestamptz(3),"filesDeletedAt" timestamptz(3),"createdAt" timestamptz(3) NOT NULL DEFAULT now(),"updatedAt" timestamptz(3) NOT NULL DEFAULT now(),version integer NOT NULL DEFAULT 1,
 CONSTRAINT refund_request_status_check CHECK(status IN ('REQUESTED','UNDER_REVIEW','APPROVED','REJECTED','COMPLETED','WITHDRAWN')),
 CONSTRAINT refund_request_resolution_check CHECK(resolution IS NULL OR resolution IN ('REFUND','REPLACEMENT')),
 CONSTRAINT refund_request_refund_status_check CHECK("refundStatus" IS NULL OR "refundStatus" IN ('INITIATED','COMPLETED')),
 CONSTRAINT refund_request_amount_check CHECK("approvedAmount" IS NULL OR "approvedAmount">0)
);
CREATE UNIQUE INDEX refund_one_open_per_order ON public.refund_requests("orderId") WHERE "requestedAt" IS NOT NULL AND status IN ('REQUESTED','UNDER_REVIEW','APPROVED');
CREATE INDEX refund_request_list_idx ON public.refund_requests(status,"requestedAt" DESC);
CREATE INDEX refund_request_owner_idx ON public.refund_requests("userId","createdAt" DESC);
CREATE TABLE public.refund_request_files (id text PRIMARY KEY,"requestId" text NOT NULL REFERENCES public.refund_requests(id) ON DELETE RESTRICT,"storagePath" text NOT NULL UNIQUE,kind varchar(10) NOT NULL,"sizeBytes" integer NOT NULL,"mimeType" varchar(80) NOT NULL,"originalName" varchar(160) NOT NULL,"uploadedAt" timestamptz(3),"deletedAt" timestamptz(3),"createdAt" timestamptz(3) NOT NULL DEFAULT now(),CHECK(kind IN ('photo','video')),CHECK("sizeBytes">0 AND "sizeBytes"<=31457280));
CREATE INDEX refund_files_request_idx ON public.refund_request_files("requestId");
CREATE TABLE public.refund_request_audit (id text PRIMARY KEY,"requestId" text NOT NULL REFERENCES public.refund_requests(id) ON DELETE RESTRICT,"actorId" text NOT NULL,"actorRole" varchar(20) NOT NULL,action varchar(40) NOT NULL,"mutationKey" text NOT NULL,"inputHash" text NOT NULL,"oldValue" jsonb NOT NULL,"newValue" jsonb NOT NULL,"createdAt" timestamptz(3) NOT NULL DEFAULT now(),UNIQUE("requestId","mutationKey"));
ALTER TABLE public.refund_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refund_request_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refund_request_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.refund_requests,public.refund_request_files,public.refund_request_audit FROM anon,authenticated;
GRANT ALL ON public.refund_requests,public.refund_request_files,public.refund_request_audit TO service_role;
-- No browser SQL access. All reads/writes pass through token-authorized API routes.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('refund-evidence','refund-evidence',false,31457280,ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif','video/mp4','video/quicktime','video/webm']) ON CONFLICT(id) DO NOTHING;
CREATE POLICY refund_evidence_api_only ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated USING(bucket_id<>'refund-evidence') WITH CHECK(bucket_id<>'refund-evidence');
COMMIT;
