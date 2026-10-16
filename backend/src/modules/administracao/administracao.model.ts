import type { listarVinculosAdministrativos } from "../vinculos/vinculo.repository.js";
import type { ListaCondominios } from "../condominios/condominio.model.js";

type Vinculo = Awaited<ReturnType<typeof listarVinculosAdministrativos>>["vinculos"][number];
export interface ListaVinculosAdministrativos {
  dados: (Pick<Vinculo, "id_vinculo" | "status_vinculo" | "moradia" | "admin_condominio" | "condominio"> & {
    data_solicitacao: string;
    data_inicio: string | null;
    morador: { id_usuario: string; nome_completo: string };
  })[];
  paginacao: ListaCondominios["paginacao"];
}
export interface ResultadoAdminVinculo {
  dados: { id_vinculo: string; admin_condominio: boolean; admin_atualizado_em: string | null };
}
