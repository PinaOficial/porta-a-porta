import type { InputHTMLAttributes, ReactNode } from "react";
export function Campo({ label, erro, ...props }: InputHTMLAttributes<HTMLInputElement> & { id: string; label: string; erro?: string }) {
  return <div className="campo">
    <label htmlFor={props.id}>{label}</label>
    <input {...props} aria-invalid={Boolean(erro)} aria-describedby={erro ? `${props.id}-erro` : props["aria-describedby"]} />
    {erro && <span role="alert" className="erro-campo" id={`${props.id}-erro`}>{erro}</span>}
  </div>;
}
export function Aviso({ children, erro = false }: { children: ReactNode; erro?: boolean }) {
  return <div className={erro ? "aviso aviso-erro" : "aviso"} role={erro ? "alert" : "status"}>{children}</div>;
}
