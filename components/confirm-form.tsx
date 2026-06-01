"use client";

import type { ReactNode } from "react";

/**
 * Form de confirmação client-side. Server components não conseguem usar
 * onSubmit inline, então delegamos isso aqui pra evitar "Functions cannot
 * be passed to Client Components".
 */
export function ConfirmForm({
  action,
  message,
  children,
  className,
}: {
  action: (formData: FormData) => void | Promise<void>;
  message: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <form
      action={action}
      className={className}
      onSubmit={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </form>
  );
}
