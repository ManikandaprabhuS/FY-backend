import { once } from "node:events";
import type { Response } from "express";

export const exportDate = (value: Date | null | undefined) => value ? [String(value.getDate()).padStart(2, "0"), String(value.getMonth() + 1).padStart(2, "0"), value.getFullYear()].join("/") : "-";
export const exportAmount = (value: unknown) => "INR " + Number(value ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const csvCell = (value: unknown) => {
  let text = "";
  if (typeof value === "string") text = value;
  else if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") text = value.toString();
  else if (value !== null && typeof value === "object") text = JSON.stringify(value);
  const first = [...text].find(char => char.charCodeAt(0) > 32 && char.trim() !== "");
  if (first && "=+-@".includes(first)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
};
export async function streamCsv(response: Response, filename: string, headers: string[], rows: AsyncIterable<unknown[]>) {
  const iterator = rows[Symbol.asyncIterator]();
  const first = await iterator.next();
  if (first.done) { response.status(204).end(); return; }
  response.setHeader("Content-Type", "text/csv; charset=utf-8");
  response.setHeader("Content-Disposition", 'attachment; filename="' + filename + '.csv"');
  response.setHeader("Cache-Control", "no-store");
  const abort = new AbortController();
  const onClose = () => abort.abort();
  response.once("close", onClose);
  const write = async (row: unknown[]) => {
    if (!response.write(row.map(csvCell).join(",") + "\r\n")) await once(response, "drain", { signal: abort.signal });
  };
  try {
    response.write("\ufeff");
    await write(headers);
    await write(first.value);
    while (!response.destroyed) {
      const next = await iterator.next();
      if (next.done) break;
      await write(next.value);
    }
    response.end();
  } catch (error) {
    if (response.headersSent || response.destroyed) { response.destroy(); return; }
    throw error;
  } finally { response.off("close", onClose); await iterator.return?.(); }
}
