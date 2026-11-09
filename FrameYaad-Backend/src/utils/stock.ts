import { ApiError } from "./api-error";
export const availableStock = (value: unknown): number => {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") return 0;
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity > 0 && Number.isSafeInteger(Math.floor(quantity)) ? Math.floor(quantity) : 0;
};
export const assertAvailableStock = (requested: number, stock: unknown) => {
  const available = availableStock(stock);
  if (!Number.isSafeInteger(requested) || requested < 1 || requested > available) throw new ApiError(409, "Requested quantity exceeds available stock (" + available + ")", "INSUFFICIENT_STOCK");
};
