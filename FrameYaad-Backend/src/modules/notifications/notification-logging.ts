export const isNotificationRead = (method: string | undefined, url: string | undefined): boolean =>
  method === 'GET' && /\/(?:customer-notifications|notifications)(?:\/unread-count)?\/?$/.test((url ?? '').split('?')[0] ?? '');

export const notificationLogLevel = (method: string | undefined, url: string | undefined, status: number, error?: unknown): 'error' | 'warn' | 'info' | 'silent' => {
  if (error || status >= 500) return 'error';
  if (status >= 400) return 'warn';
  return isNotificationRead(method, url) ? 'silent' : 'info';
};
