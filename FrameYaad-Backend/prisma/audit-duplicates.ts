// Read-only: outputs counts and record IDs, never email addresses or other values.
import { prisma } from "../src/prisma/client";
const checks: Array<[string, string]> = [
  ["Normalized emails", 'SELECT array_agg(id) AS ids FROM public.users GROUP BY lower(btrim(email)) HAVING count(*) > 1'],
  ["Normalized coupon codes", 'SELECT array_agg(id) AS ids FROM public.coupon GROUP BY upper(btrim("couponCode")) HAVING count(*) > 1'],
  ["Product identifiers / SKU", 'SELECT array_agg(id) AS ids FROM public."Product" GROUP BY lower(btrim("productIdentifier")) HAVING count(*) > 1'],
  ["Product names (review only)", 'SELECT array_agg(id) AS ids FROM public."Product" GROUP BY lower(btrim("productName")) HAVING count(*) > 1'],
  ["Employee identifiers", 'SELECT array_agg(id) AS ids FROM public.users WHERE "employeeId" IS NOT NULL GROUP BY lower(btrim("employeeId")) HAVING count(*) > 1'],
  ["Employee names (review only)", 'SELECT array_agg(id) AS ids FROM public.users WHERE role = \'EMPLOYEE\' GROUP BY lower(btrim(name)) HAVING count(*) > 1'],
  ["Normalized phones (review only)", 'SELECT array_agg(id) AS ids FROM public.users WHERE "phoneNumber" IS NOT NULL GROUP BY regexp_replace("phoneNumber", \'[^0-9]\', \'\', \'g\') HAVING count(*) > 1'],
  ["Material brand/name", 'SELECT array_agg(id) AS ids FROM public."Material" GROUP BY lower(btrim("brandName")), lower(btrim(name)) HAVING count(*) > 1'],
  ["Per-product color images", 'SELECT array_agg(id) AS ids FROM public."ProductImage" WHERE color IS NOT NULL GROUP BY "productIdentifier", lower(btrim(color)) HAVING count(*) > 1'],
  ["Variants exact configuration/price", 'SELECT array_agg(id) AS ids FROM public."ProductVariant" WHERE "productId" IS NOT NULL GROUP BY "productId", lower(btrim(color)), lower(btrim("frameSize")), lower(btrim("mountType")), "glassType", "mrp", price HAVING count(*) > 1'],
  ["Repeated material color labels", 'SELECT array_agg(id) AS ids FROM (SELECT id, lower(btrim(label)) FROM public."Material", unnest("availableColors") AS label GROUP BY id, lower(btrim(label)) HAVING count(*) > 1) AS repeated'],
];
async function main() {
  for (const [label, sql] of checks) {
    const groups = await prisma.$queryRawUnsafe<Array<{ ids: string[] | null }>>(sql);
    const populated = groups.filter(group => group.ids?.length);
    console.log(JSON.stringify({ label, duplicateGroups: populated.length, recordIds: populated.map(group => group.ids) }));
  }
}
void main().catch(() => { console.error("Read-only duplicate audit failed; no records were changed."); process.exitCode = 1; }).finally(() => prisma.$disconnect());
