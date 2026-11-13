/** Shared contract: keep this identical in both independently deployed repositories. */
export const DEFAULT_PHOTO_MAX_MB = 4;
export const MIN_PHOTO_MAX_MB = 1;
export const MAX_PHOTO_MAX_MB = 10;
export const PHOTO_MB_BYTES = 1024 * 1024;
export type PhotoLimitVariant = { maxPhotoSizeMB?: number | null };
export function photoLimitValidation(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < MIN_PHOTO_MAX_MB || value > MAX_PHOTO_MAX_MB || Math.abs(value * 10 - Math.round(value * 10)) > 1e-8)
    return 'Max photo upload size must be a number from ' + MIN_PHOTO_MAX_MB + ' to ' + MAX_PHOTO_MAX_MB + ' MB, with at most 1 decimal.';
  return null;
}
export function getPhotoMaxBytes(variants: readonly PhotoLimitVariant[] = []): number {
  const values = variants.map(item => typeof item.maxPhotoSizeMB !== 'number' || photoLimitValidation(item.maxPhotoSizeMB) ? DEFAULT_PHOTO_MAX_MB : item.maxPhotoSizeMB);
  return Math.floor((values.length ? Math.min(...values) : DEFAULT_PHOTO_MAX_MB) * PHOTO_MB_BYTES);
}
export function photoSizeError(sizeBytes: number, limitBytes: number): string {
  return 'Photo is ' + (sizeBytes / PHOTO_MB_BYTES).toFixed(1) + ' MB. This frame allows up to ' + Number((limitBytes / PHOTO_MB_BYTES).toFixed(1)) + ' MB.';
}
