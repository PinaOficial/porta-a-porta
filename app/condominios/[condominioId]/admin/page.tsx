import { redirect } from "next/navigation";

export default async function AdminPage(
  props: PageProps<"/condominios/[condominioId]/admin">,
) {
  const { condominioId } = await props.params;
  redirect(`/administracao/condominios/${condominioId}`);
}
