import { z } from "zod";

import { positiveQuantitySchema, uuidSchema } from "@/lib/validations/common";

export const createCarrinhoItemSchema = z.object({ produtoId: uuidSchema, quantidade: positiveQuantitySchema }).strict();
export const updateCarrinhoItemSchema = z.object({ quantidade: positiveQuantitySchema }).strict();
