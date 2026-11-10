// Defaults are used only when inserting a missing fixed offer. Runtime settings live in the database.
export const OFFER_SEED_DEFAULTS = {
 FIRST_ORDER:{code:"FIRST_ORDER",title:"First Order Offer",description:"First order offer",percentage:5,minOrderAmount:null,enabled:true},
 BIG_ORDER:{code:"BIG_ORDER",title:"Big Order Offer",description:"Big order offer",percentage:10,minOrderAmount:5000,enabled:true},
} as const;
export type OfferCode=keyof typeof OFFER_SEED_DEFAULTS;

