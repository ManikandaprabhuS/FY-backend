import { z } from "zod";

export const addressIdSchema = z.string().uuid();

const addressFields = {
  addressLine: z.string().trim().min(5).max(255),
  postalCode: z.string().trim().min(3).max(20),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().min(2).max(100),
  country: z.string().trim().min(2).max(100),
  contactPerson: z.string().trim().min(2).max(120),
  contactNumber: z.string().trim().min(7).max(20),
};

export const createAddressSchema = z.object(addressFields).strict();
export const updateAddressSchema = z.object({
  addressLine: addressFields.addressLine.optional(),
  postalCode: addressFields.postalCode.optional(),
  city: addressFields.city.optional(),
  state: addressFields.state.optional(),
  country: addressFields.country.optional(),
  contactPerson: addressFields.contactPerson.optional(),
  contactNumber: addressFields.contactNumber.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "At least one address field is required",
});
