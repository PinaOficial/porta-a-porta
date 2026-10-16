export interface ContextoAutenticado {
  id_usuario: string;
  email?: string;
  super_admin: boolean;
  vinculo_ativo?: {
    id_vinculo: string;
    id_condominio: string;
    admin_condominio: boolean;
  };
}
