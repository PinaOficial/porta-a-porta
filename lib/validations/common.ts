import { z } from "zod";

export const uuidSchema = z.string().uuid("UUID invalido.");

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const booleanQuerySchema = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

export const positiveQuantitySchema = z.coerce.number().int().min(1);
export const stockSchema = z.coerce.number().int().min(0);
export const priceSchema = z.coerce
  .number()
  .positive()
  .refine((value) => Number.isInteger(value * 100), {
    message: "O preco pode ter no maximo duas casas decimais.",
  });

export function getPagination(value: { page: number; limit: number }) {
  return { ...value, skip: (value.page - 1) * value.limit };
}
