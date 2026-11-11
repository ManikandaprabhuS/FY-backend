import { prisma } from "../../prisma/client";
import { supabaseAdmin } from "../../config/supabase";
import { env } from "../../config/env";
// Recover artifacts left by a process crash or a failed compensating delete.
// Storage names are never logged or sent to clients. Only unreferenced TEMP objects
// older than 24 hours are removed; attached/cancelled-order photos are untouched.
export async function cleanupPhotoOrphans() {
  const storage = supabaseAdmin.storage.from(env.SUPABASE_PHOTO_BUCKET);
  let removed = 0;
  for (let offset = 0; ; offset += 100) {
    const folders = await storage.list("", { limit: 100, offset, sortBy: { column: "name", order: "asc" } });
    if (folders.error) throw new Error("Photo orphan scan unavailable");
    for (const folder of folders.data) {
      if (!/^[0-9a-f-]{36}$/i.test(folder.name) || folder.id) continue;
      const prefix = folder.name + "/temp";
      let page = 0;
      for (;;) {
        const files = await storage.list(prefix, { limit: 100, offset: page * 100, sortBy: { column: "name", order: "asc" } });
        if (files.error) throw new Error("Photo orphan scan unavailable");
        // Lock against uploading/attaching on this account before comparing records.
        await prisma.$transaction(async tx => {
          await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))::text", "photo:" + folder.name);
          const candidates = files.data.filter(file => file.id && file.created_at && Date.parse(file.created_at) < Date.now() - 86400000);
          if (!candidates.length) return;
          const paths = candidates.map(file => prefix + "/" + file.name);
          const referenced = await tx.orderPhoto.findMany({ where: { storagePath: { in: paths } }, select: { storagePath: true } });
          const keep = new Set(referenced.map(row => row.storagePath));
          const orphans = paths.filter(path => !keep.has(path));
          if (orphans.length) {
            const result = await storage.remove(orphans);
            if (result.error) throw new Error("Photo orphan cleanup unavailable");
            removed += orphans.length;
          }
        }, { timeout: 15000 });
        if (files.data.length < 100) break;
        // Start from the beginning after deletion so offsets cannot skip remaining objects.
        if (removed) break;
        page++;
      }
    }
    if (folders.data.length < 100) break;
  }
  return removed;
}
