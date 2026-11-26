let wake: (()=>void) | undefined;
export const setDeliveryWake=(callback:(()=>void)|undefined)=>{wake=callback;};
export const wakeDeliveryWorker=()=>wake?.();
