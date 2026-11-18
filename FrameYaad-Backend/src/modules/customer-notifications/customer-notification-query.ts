import {Prisma} from '@prisma/client';
import {prisma} from '../../prisma/client';

export type CustomerHistoryRow={id:string;type:string;title:string;message:string;orderId:string|null;isRead:boolean;createdAt:string};
type PageRow={notifications:CustomerHistoryRow[];total:number;unread:number};
/** Read-only union: keep legacy welcome/history in place; current events win duplicates. */
export async function customerHistoryPage(userId:string,page:number,limit:number,read?:boolean){
 const rows=await prisma.$queryRaw<PageRow[]>(Prisma.sql`
  WITH current_history AS (
   SELECT c.id,c.type,c.title,c.message,c."orderId",
    (c."isRead" OR EXISTS(
     SELECT 1 FROM public.notifications prior
     LEFT JOIN public."Order" owned ON owned."userId"=${userId} AND owned."orderNumber"=substring(prior.message FROM '(FY-[A-Za-z0-9_-]+)')
     WHERE prior."userId"=${userId} AND prior.read AND (
      prior.id=c.id OR (prior.title=c.title AND prior.message=c.message AND prior.date=c."createdAt")
      OR (owned.id=c."orderId" AND ((prior.type::text='ORDER_PLACED' AND c.type='ORDER_PLACED') OR (prior.title=c.title AND prior.message=c.message)))
     )
    )) AS "isRead",c."createdAt"
   FROM public.customer_notifications c WHERE c."userId"=${userId}
  ), legacy_history AS (
   SELECT n.id,
    CASE WHEN n.type::text='ORDER_PLACED' THEN 'ORDER_PLACED'
         WHEN n.type::text='ORDER_CANCELLED' OR n.title='Order cancelled' THEN 'ORDER_CANCELLED'
         WHEN n.title='Order status updated' THEN 'ORDER_STATUS' ELSE n.type::text END AS type,
    n.title,n.message,o.id AS "orderId",n.read AS "isRead",n.date AS "createdAt"
   FROM public.notifications n
   LEFT JOIN public."Order" o ON o."userId"=${userId}
     AND o."orderNumber"=substring(n.message FROM '(FY-[A-Za-z0-9_-]+)')
   WHERE n."userId"=${userId} AND NOT EXISTS (
    SELECT 1 FROM current_history c WHERE c.id=n.id
      OR (c.title=n.title AND c.message=n.message AND c."createdAt"=n.date)
      OR (o.id IS NOT NULL AND c."orderId"=o.id AND (
       (n.type::text='ORDER_PLACED' AND c.type='ORDER_PLACED') OR (c.title=n.title AND c.message=n.message)
      ))
   )
  ), history AS (SELECT * FROM current_history UNION ALL SELECT * FROM legacy_history),
  counts AS (SELECT count(*)::int AS total,count(*) FILTER(WHERE NOT "isRead")::int AS unread FROM history),
  page_rows AS (
   SELECT * FROM history ${read===undefined?Prisma.empty:Prisma.sql`WHERE "isRead"=${read}`}
   ORDER BY "createdAt" DESC,id DESC LIMIT ${limit} OFFSET ${(page-1)*limit}
  )
  SELECT counts.total,counts.unread,COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'id',id,'type',type,'title',title,'message',message,'orderId',"orderId",'isRead',"isRead",
   'createdAt',to_char("createdAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ) ORDER BY "createdAt" DESC,id DESC) FROM page_rows),'[]'::jsonb) AS notifications FROM counts
 `);
 return rows[0]??{notifications:[],total:0,unread:0};
}
