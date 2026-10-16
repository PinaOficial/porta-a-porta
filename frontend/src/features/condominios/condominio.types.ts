export interface Condominio {
  id_condominio: string;
  nome_residencial: string;
  cep: string;
  endereco: string;
}
export interface CondominioCriado extends Condominio { ativo: boolean; created_at: string }
