import { UserRole, type Prisma } from "@prisma/client";
import { parsePagination } from "../../utils/pagination";
import { buildCustomerSearch } from "./customer-search";

export const buildCustomerWhere = async (query: ReturnType<typeof parsePagination>): Promise<Prisma.UserWhereInput> => ({
  role: UserRole.CUSTOMER,
  ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
  ...await buildCustomerSearch(query.search),
});
