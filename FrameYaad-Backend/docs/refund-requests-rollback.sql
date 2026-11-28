-- Revert application code first. Export all request/audit/evidence data before rollback.
-- This safe rollback refuses to discard any refund request or its financial history.
BEGIN;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.refund_requests) THEN RAISE EXCEPTION 'Export and reconcile refund requests before rollback; no data has been removed.'; END IF; END $$;
DROP POLICY refund_evidence_api_only ON storage.objects;
DROP TABLE public.refund_request_audit,public.refund_request_files,public.refund_requests;
ALTER TABLE public."Order" DROP CONSTRAINT order_return_amounts_check,DROP COLUMN "deliveredAt",DROP COLUMN "refundedAmount",DROP COLUMN "completedReturnRefund";
-- Keep the private bucket: never drop a bucket or stored evidence through a schema rollback.
COMMIT;
