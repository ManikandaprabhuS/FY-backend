// Defaults are used only when inserting a missing fixed offer. Runtime settings live in the database.
export const OFFER_SEED_DEFAULTS = {
 FIRST_ORDER:{code:"FIRST_ORDER",title:"First Order Offer",description:"First order offer",percentage:5,minOrderAmount:null,enabled:true},
 BIG_ORDER:{code:"BIG_ORDER",title:"Big Order Offer",description:"Big order offer",percentage:10,minOrderAmount:5000,enabled:true},
 NEW_YEAR:{code:"NEW_YEAR",title:"New Year Offer",description:"New year offer",percentage:10,minOrderAmount:1000,enabled:false},
 CHRISTMAS:{code:"CHRISTMAS",title:"Christmas Offer",description:"Christmas offer",percentage:10,minOrderAmount:1000,enabled:false},
 PONGAL:{code:"PONGAL",title:"Pongal Offer",description:"Pongal offer",percentage:10,minOrderAmount:1000,enabled:false},
} as const;
export type OfferCode=keyof typeof OFFER_SEED_DEFAULTS;
export const OFFER_CODES=["FIRST_ORDER","BIG_ORDER","NEW_YEAR","CHRISTMAS","PONGAL"] as const satisfies readonly OfferCode[];
export const isThresholdOffer=(code:string)=>OFFER_CODES.some(value=>value===code)&&code!=="FIRST_ORDER";

