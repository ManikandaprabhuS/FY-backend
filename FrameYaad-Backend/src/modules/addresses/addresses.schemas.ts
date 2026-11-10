import { z } from "zod";
import { phoneSchema, plainText } from "../../utils/input-schemas";

export const addressIdSchema = z.string().uuid();

const addressFields = {
  addressLine: plainText(5,255),
  postalCode: z.string().trim().min(3).max(20),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().min(2).max(100),
  country: z.string().trim().min(2).max(100),
  contactPerson: plainText(2,120),
  contactNumber: phoneSchema,
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
