// Share only overlapping work. Results and failures are never retained, so the
// next request always checks current authentication/data rather than a TTL cache.
export function inFlight<T>(limit=1024){
 const pending=new Map<string,Promise<T>>();
 return (key:string,load:()=>Promise<T>):Promise<T>=>{
  const existing=pending.get(key);if(existing)return existing;
  const work=Promise.resolve().then(load);
  if(pending.size>=limit)return work;
  pending.set(key,work);
  void work.then(()=>{if(pending.get(key)===work)pending.delete(key);},()=>{if(pending.get(key)===work)pending.delete(key);});
  return work;
 };
}
