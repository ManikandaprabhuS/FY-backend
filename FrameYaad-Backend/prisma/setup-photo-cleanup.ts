import {prisma} from "../src/prisma/client";
const sql=[
 "ALTER TABLE public.order_photos ADD COLUMN IF NOT EXISTS \"deletedAt\" timestamp(3), ADD COLUMN IF NOT EXISTS \"deletedBy\" text, ADD COLUMN IF NOT EXISTS \"deletedByName\" text",
 "CREATE TABLE IF NOT EXISTS public.photo_cleanup_audit (id text PRIMARY KEY, \"batchId\" text NOT NULL, \"actorId\" text NOT NULL, \"actorName\" text NOT NULL, \"orderIds\" text[] NOT NULL, \"photoId\" text NOT NULL UNIQUE, count integer NOT NULL, \"bytesFreed\" integer NOT NULL, \"createdAt\" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)",
 "CREATE INDEX IF NOT EXISTS photo_cleanup_audit_createdAt_idx ON public.photo_cleanup_audit (\"createdAt\" DESC)",
 "ALTER TABLE public.photo_cleanup_audit ENABLE ROW LEVEL SECURITY",
 "REVOKE ALL ON public.photo_cleanup_audit FROM anon, authenticated",
 "ALTER TABLE public.order_photos ADD CONSTRAINT photo_cleanup_states CHECK ((status='TEMP' AND \"orderId\" IS NULL AND \"attachedAt\" IS NULL AND \"storagePath\"<>'' AND \"deletedAt\" IS NULL) OR (status='ATTACHED' AND \"orderId\" IS NOT NULL AND \"attachedAt\" IS NOT NULL AND \"storagePath\"<>'' AND \"deletedAt\" IS NULL) OR (status='DELETED' AND \"orderId\" IS NOT NULL AND \"attachedAt\" IS NOT NULL AND \"storagePath\"='' AND \"deletedAt\" IS NOT NULL AND \"deletedBy\" IS NOT NULL))",
 "CREATE OR REPLACE FUNCTION public.frameyaad_database_size() RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT pg_catalog.pg_database_size(pg_catalog.current_database()); $$",
 "REVOKE ALL ON FUNCTION public.frameyaad_database_size() FROM PUBLIC, anon, authenticated",
 "GRANT EXECUTE ON FUNCTION public.frameyaad_database_size() TO service_role",
 "CREATE OR REPLACE FUNCTION public.frameyaad_photo_completed_at(history jsonb, final_status text, cancelled_at timestamp) RETURNS timestamptz LANGUAGE plpgsql STABLE SET search_path=pg_catalog SET timezone='UTC' AS $$\nDECLARE entry jsonb; result timestamptz;\nBEGIN\n IF final_status='CANCELLED' AND cancelled_at IS NOT NULL THEN RETURN cancelled_at AT TIME ZONE 'UTC'; END IF;\n IF jsonb_typeof(history)='array' THEN\n  FOR entry IN SELECT x.value FROM jsonb_array_elements(history) WITH ORDINALITY AS x(value,idx) ORDER BY x.idx DESC LOOP\n   IF entry->>'status'=final_status THEN\n    BEGIN result=(entry->>'changedAt')::timestamptz; IF result IS NOT NULL THEN RETURN result; END IF;\n    EXCEPTION WHEN OTHERS THEN NULL; END;\n   END IF;\n  END LOOP;\n END IF;\n RETURN NULL;\nEND; $$",
 "REVOKE ALL ON FUNCTION public.frameyaad_photo_completed_at(jsonb,text,timestamp) FROM PUBLIC, anon, authenticated"
];
let stage="snapshot";
async function main(){
 if(!process.argv.includes("--apply"))throw new Error("Review the script and run with --apply.");
 const snapshot=()=>prisma.$queryRawUnsafe('SELECT count(*)::text AS count,coalesce(sum("sizeBytes"),0)::text AS bytes FROM public.order_photos');
 const before=await snapshot();
 await prisma.$transaction(async tx=>{
  stage="columns";await tx.$executeRawUnsafe(sql[0]!);
  const old=await tx.$queryRawUnsafe<Array<{conname:string}>>("SELECT conname FROM pg_constraint WHERE conrelid='public.order_photos'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%status%'");
  for(const row of old)await tx.$executeRawUnsafe('ALTER TABLE public.order_photos DROP CONSTRAINT "'+row.conname.replaceAll('"','""')+'"');
  for(const [index,statement]of sql.slice(1).entries()){stage="statement "+(index+1);await tx.$executeRawUnsafe(statement);}
 },{timeout:20000});
 stage="invariant";if(JSON.stringify(before)!==JSON.stringify(await snapshot()))throw new Error("Photo row invariant changed.");
 stage="database size";const size=await prisma.$queryRawUnsafe<Array<{bytes:bigint}>>("SELECT public.frameyaad_database_size() AS bytes");
 if(!size[0]||size[0].bytes<=0n)throw new Error("Database size verification failed.");
 console.info("Photo cleanup tombstones, audit and restricted read-only size function ready. Existing photo rows/files unchanged.");
}
void main().catch((error:unknown)=>{const label=error instanceof Error?error.name:"unknown";const hint=error instanceof Error?(/reach database|connect|timed out|ENOTFOUND|ECONN/i.test(error.message)?"connection unavailable":/password|authentication/i.test(error.message)?"database authentication rejected":/Invalid environment/i.test(error.message)?"environment validation failed":"see local database configuration"):"unknown";const code=error&&typeof error==="object"&&"code" in error?String(error.code):"unknown";const meta=error&&typeof error==="object"&&"meta" in error?error.meta:null;const dbCode=meta&&typeof meta==="object"&&"code" in meta?String(meta.code):"unknown";console.error("Photo cleanup setup failed at "+stage+" ("+label+"/"+code+"/"+dbCode+", "+hint+"); connection details were not logged.");process.exitCode=1;}).finally(()=>prisma.$disconnect());
