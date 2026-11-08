import { Router } from "express";
import { UserRole } from "@prisma/client";
import { authenticate, authorize } from "../../middleware/auth.middleware";
import { searchAdmin } from "./admin-search.service";
export const adminSearchRouter = Router();
adminSearchRouter.use(authenticate, authorize(UserRole.ADMIN, UserRole.EMPLOYEE));
adminSearchRouter.get("/search", async (request, response) => {
  response.json({ success: true, data: await searchAdmin(request.query) });
});
