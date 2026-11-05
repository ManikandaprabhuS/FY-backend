import { UserRole } from "@prisma/client";
import { Router } from "express";
import multer from "multer";

import { authenticate, authorize } from "../../middleware/auth.middleware";
import { validateBody } from "../../middleware/validate.middleware";
import * as controller from "./products.controller";
import { createAdminProductPreviewSchema, createAdminVariantSchema, createProductSchema, updateAdminProductPreviewSchema, updateAdminVariantSchema, updateProductSchema } from "./products.schemas";

export const productsRouter = Router();
const catalogManagers = authorize(UserRole.ADMIN, UserRole.EMPLOYEE);
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 10, fileSize: 10 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    const supportedTypes = ["image/jpeg", "image/png", "image/webp", "video/mp4"];
    callback(null, supportedTypes.includes(file.mimetype));
  },
});

productsRouter.get("/public", controller.listPublicProducts);
productsRouter.get("/public/:id", controller.getPublicProduct);
productsRouter.use(authenticate);
productsRouter.get("/", controller.listProducts);
productsRouter.post(
  "/uploadProductImages",
  catalogManagers,
  imageUpload.array("images", 10),
  controller.uploadProductImages,
);
productsRouter.post(
  "/addProduct",
  catalogManagers,
  validateBody(createAdminProductPreviewSchema),
  controller.createAdminProductPreview,
);
productsRouter.patch(
  "/:id/admin-preview",
  catalogManagers,
  validateBody(updateAdminProductPreviewSchema),
  controller.updateAdminProductPreview,
);
productsRouter.post("/:id/variants", catalogManagers, validateBody(createAdminVariantSchema), controller.createAdminVariant);
productsRouter.patch(
  "/variants/:id",
  catalogManagers,
  validateBody(updateAdminVariantSchema),
  controller.updateAdminVariant,
);
productsRouter.delete("/variants/:id", catalogManagers, controller.deleteAdminVariant);
productsRouter.get("/:id", controller.getProduct);
productsRouter.post("/", catalogManagers, validateBody(createProductSchema), controller.createProduct);
productsRouter.patch("/:id", catalogManagers, validateBody(updateProductSchema), controller.updateProduct);
productsRouter.delete("/:id", catalogManagers, controller.deleteProduct);
