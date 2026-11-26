import { describe, expect, it, vi } from 'vitest';
import { notificationLogLevel } from '../src/modules/notifications/notification-logging';
import { notificationRealtimeSession } from '../src/modules/notifications/notification-realtime.controller';
import type { Request, Response } from 'express';
import request from 'supertest';
import { createApp } from '../src/app';
describe('notification realtime bootstrap and logging', () => {
  it('rejects anonymous Realtime bootstrap before exposing session configuration', async () => {
    const response=await request(createApp()).get('/api/v1/auth/notification-realtime-session');
    expect(response.status).toBe(401);
    expect(response.body).not.toHaveProperty('data.accessToken');
  });
  it('suppresses successful reads but preserves mutations and all failures', () => {
    for (const path of ['/api/v1/notifications?page=1', '/api/v1/notifications/unread-count', '/api/v1/customer-notifications']) expect(notificationLogLevel('GET', path, 200)).toBe('silent');
    expect(notificationLogLevel('PATCH', '/api/v1/notifications/read-all', 200)).toBe('info');
    expect(notificationLogLevel('GET', '/api/v1/notifications', 403)).toBe('warn');
    expect(notificationLogLevel('GET', '/api/v1/notifications', 500)).toBe('error');
    expect(notificationLogLevel('GET', '/api/v1/orders', 200)).toBe('info');
  });
  it('bootstraps only middleware-verified identity and never exposes a service key or refresh token', () => {
    const json=vi.fn(),setHeader=vi.fn();
    notificationRealtimeSession({auth:{user:{id:'verified-user',role:'CUSTOMER'},accessToken:'verified-access'}} as unknown as Request,{json,setHeader} as unknown as Response,vi.fn());
    expect(setHeader).toHaveBeenCalledWith('Cache-Control','no-store');
    const result=(json.mock.calls[0]![0] as {data:Record<string,unknown>}).data;
    expect(result).toMatchObject({userId:'verified-user',role:'CUSTOMER',accessToken:'verified-access'});
    expect(Object.keys(result).sort()).toEqual(['accessToken','anonKey','role','url','userId']);
  });
});
