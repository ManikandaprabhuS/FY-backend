import {describe,it,expect,vi} from 'vitest';
import {inFlight} from '../src/utils/in-flight';
describe('bounded in-flight work (not a result cache)',()=>{
 it('shares concurrent requests, then immediately loads fresh data',async()=>{
  const share=inFlight<number>();let finish!:(value:number)=>void;
  const load=vi.fn(()=>new Promise<number>(resolve=>{finish=resolve;}));
  const first=share('identity:query',load),second=share('identity:query',load);
  await Promise.resolve();expect(load).toHaveBeenCalledTimes(1);finish(1);expect(await first).toBe(1);expect(await second).toBe(1);
  expect(await share('identity:query',()=>Promise.resolve(2))).toBe(2);
 });
 it('isolates identities/filters and releases failures for a retry',async()=>{
  const share=inFlight<number>();expect(await share('admin:a:all',()=>Promise.resolve(1))).toBe(1);expect(await share('customer:b:unread',()=>Promise.resolve(2))).toBe(2);
  await expect(share('a',()=>Promise.reject(new Error('offline')))).rejects.toThrow('offline');expect(await share('a',()=>Promise.resolve(3))).toBe(3);
 });
 it('bounds retained pending keys without refusing work',async()=>{
  const share=inFlight<number>(1);let done!:(value:number)=>void;const first=share('one',()=>new Promise(resolve=>{done=resolve;}));
  expect(await share('two',()=>Promise.resolve(2))).toBe(2);done(1);expect(await first).toBe(1);
 });
});
