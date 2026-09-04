"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ConfirmActionProps = {
  trigger: string;
  title: string;
  description: string;
  onConfirm: () => Promise<void>;
  disabled?: boolean;
  variant?: "default" | "outline" | "ghost" | "destructive";
  className?: string;
};

export function ConfirmAction({
  trigger,
  title,
  description,
  onConfirm,
  disabled,
  variant = "destructive",
  className,
}: ConfirmActionProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <AlertDialog.Root open={open} onOpenChange={setOpen}>
      <AlertDialog.Trigger
        disabled={disabled}
        className={cn(buttonVariants({ variant, size: "sm" }), className)}
      >
        {trigger}
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/35 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <AlertDialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-card p-6 shadow-xl outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
          <AlertDialog.Title className="text-lg font-semibold">
            {title}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">
            {description}
          </AlertDialog.Description>
          {error ? (
            <p className="mt-3 text-sm text-destructive" aria-live="polite">
              {error}
            </p>
          ) : null}
          <div className="mt-6 flex justify-end gap-2">
            <AlertDialog.Close
              disabled={busy}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Cancelar
            </AlertDialog.Close>
            <button
              type="button"
              disabled={busy}
              className={buttonVariants({ variant: "destructive", size: "sm" })}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await onConfirm();
                  setOpen(false);
                } catch (reason) {
                  setError(
                    reason instanceof Error
                      ? reason.message
                      : "Não foi possível concluir a ação.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Aguarde..." : "Confirmar"}
            </button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
