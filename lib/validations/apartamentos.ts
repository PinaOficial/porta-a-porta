import { z } from "zod";

const apartmentFields = z.object({
  numero: z.string().trim().min(1).max(20),
  bloco: z.string().trim().min(1).max(50),
});

export const createApartamentoSchema = apartmentFields.strict();
export const updateApartamentoSchema = apartmentFields.partial().strict().refine(
  (value) => Object.keys(value).length > 0,
  { message: "Informe ao menos um campo para alteracao." },
);
