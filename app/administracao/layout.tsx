import { AdministrationShell } from "@/components/administration-shell";

export default function AdministrationLayout({ children }: LayoutProps<"/administracao">) {
  return <AdministrationShell>{children}</AdministrationShell>;
}
