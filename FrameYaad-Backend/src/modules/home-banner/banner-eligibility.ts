import {prisma} from "../../prisma/client";

// One parameterized round trip. Accounts alone never count as order history.
// Real cancelled orders still count, preserving the checkout anti-abuse rule.
export const bannerHasOrderHistory=async(userId:string):Promise<boolean>=>{
 const rows=await prisma.$queryRawUnsafe<Array<{found:boolean}>>(
  `WITH identity AS (
    SELECT lower(trim(email)) AS email,
      regexp_replace(regexp_replace(COALESCE("phoneNumber",''),'[^0-9]','','g'),'^91(?=[0-9]{10}$)','') AS phone
    FROM public.users WHERE id=$1
   )
   SELECT EXISTS(
    SELECT 1 FROM public."Order" o
    JOIN public.users u ON u.id=o."userId"
    LEFT JOIN public.user_address a ON a.id=o."userAddressId"
    CROSS JOIN identity i
    WHERE o."totalAmount">0 AND o."orderStatus"::text IN
      ('PLACED','CONFIRMED','PROCESSING','READY_TO_SHIP','SHIPPED','DELIVERED','CANCELLED')
    AND ((i.email<>'' AND (o."offerEmail"=i.email OR lower(trim(u.email))=i.email))
      OR (i.phone<>'' AND (o."offerPhone"=i.phone
      OR regexp_replace(regexp_replace(COALESCE(u."phoneNumber",''),'[^0-9]','','g'),'^91(?=[0-9]{10}$)','')=i.phone
      OR regexp_replace(regexp_replace(COALESCE(a."contactNumber",''),'[^0-9]','','g'),'^91(?=[0-9]{10}$)','')=i.phone)))
   ) AS found`,userId);
 return rows[0]?.found??false;
};
