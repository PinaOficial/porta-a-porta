import { redirect } from "next/navigation";

export default async function ApartmentsPage(
  props: PageProps<"/condominios/[condominioId]/admin/apartamentos">,
) {
  const { condominioId } = await props.params;
  redirect(`/administracao/condominios/${condominioId}`);
}
