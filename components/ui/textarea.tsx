import type { TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea className={cn("min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring", className)} {...props} />; }
