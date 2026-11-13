export type BannerOffer={bannerImageUrl?:string|null;code:"BIG_ORDER"|"FIRST_ORDER";title:string;percentage:number;minOrderAmount:number|null};
export type BannerConfig={enabled:boolean;offer:BannerOffer|null};
let generation=0,cached:{until:number;value:BannerConfig}|undefined;
let pending:{generation:number;promise:Promise<BannerConfig>}|undefined;
export const invalidateHomepageBanner=()=>{generation++;cached=undefined;pending=undefined;};
export const cachedBannerConfig=async(load:()=>Promise<BannerConfig>):Promise<BannerConfig>=>{
 if(cached&&cached.until>Date.now())return cached.value;
 if(pending?.generation===generation)return pending.promise;
 const epoch=generation;
 const promise=load().then(async value=>{
  if(epoch!==generation)return cachedBannerConfig(load);
  cached={until:Date.now()+30000,value};return value;
 });
 const entry={generation:epoch,promise};pending=entry;
 try{return await promise;}finally{if(pending===entry)pending=undefined;}
};
