import { CondominiumDetailPage } from "@/components/administration/condominium-detail-page";

export default async function AdministrationCondominiumDetailPage(
  props: PageProps<"/administracao/condominios/[condominioId]">,
) {
  const { condominioId } = await props.params;
  return <CondominiumDetailPage condominioId={condominioId} />;
}
