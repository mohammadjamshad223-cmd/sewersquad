"use client";

import * as React from "react";
import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "./button";
import { Label } from "./input";
import { cn } from "@/lib/utils";

export type ActionState =
  | { ok: true; message?: string; data?: unknown }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

type FormCtx = { state: ActionState | null };
const FormStateContext = React.createContext<FormCtx>({ state: null });

export function useFieldError(name: string): string | undefined {
  const { state } = React.useContext(FormStateContext);
  if (!state || state.ok) return undefined;
  return state.fieldErrors?.[name]?.[0];
}

/**
 * Form bound to a server action via useActionState. Shows toasts for success/error, exposes
 * field errors to <Field>, and optionally redirects / resets / refreshes on success.
 */
/**
 * Success toast. A one-time sign-in link (returned when no email provider is configured) gets a
 * persistent toast with a copy button instead, so staff can hand it over.
 */
export function announceSuccess(state: ActionState, fallback?: string | false) {
  if (!state.ok) return;
  const msg = state.message ?? fallback;
  const data = state.data as { inviteLink?: string; linkNote?: string } | undefined;
  if (data?.inviteLink) {
    const link = data.inviteLink;
    toast.message(msg || "Link created", {
      description: data.linkNote ?? "Single use. It will not be shown again.",
      duration: Infinity,
      closeButton: true,
      action: { label: "Copy link", onClick: () => void navigator.clipboard.writeText(link).then(() => toast.success("Link copied.")) },
    });
  } else if (msg) toast.success(msg);
}

export function ActionForm({
  action,
  children,
  className,
  successMessage,
  onSuccess,
  resetOnSuccess,
  redirectTo,
  refresh = true,
  ...rest
}: {
  action: (state: ActionState, fd: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  className?: string;
  successMessage?: string | false;
  onSuccess?: (state: ActionState) => void;
  resetOnSuccess?: boolean;
  redirectTo?: string;
  refresh?: boolean;
} & Omit<React.FormHTMLAttributes<HTMLFormElement>, "action" | "onSubmit">) {
  const [state, formAction] = useActionState(action, null as unknown as ActionState);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const last = useRef<ActionState | null>(null);

  useEffect(() => {
    if (!state || state === last.current) return;
    last.current = state;
    if (state.ok) {
      announceSuccess(state, successMessage);
      if (resetOnSuccess) formRef.current?.reset();
      onSuccess?.(state);
      if (redirectTo) router.push(redirectTo);
      else if (refresh) router.refresh();
    } else {
      toast.error(state.error);
    }
  }, [state, successMessage, resetOnSuccess, onSuccess, redirectTo, refresh, router]);

  return (
    <FormStateContext.Provider value={{ state }}>
      <form ref={formRef} action={formAction} className={className} noValidate {...rest}>
        {state && !state.ok && (
          <p role="alert" className="mb-4 rounded-md border border-danger/20 bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {state.error}
          </p>
        )}
        {children}
      </form>
    </FormStateContext.Provider>
  );
}

export function SubmitButton({ children, pendingText, ...props }: ButtonProps & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} aria-busy={pending} {...props}>
      {pending && <Loader2 className="animate-spin" aria-hidden />}
      {pending && pendingText ? pendingText : children}
    </Button>
  );
}

export function Field({
  label,
  name,
  hint,
  required,
  className,
  children,
}: {
  label: React.ReactNode;
  name: string;
  hint?: React.ReactNode;
  required?: boolean;
  className?: string;
  children: React.ReactElement<{ id?: string; name?: string; "aria-invalid"?: boolean; "aria-describedby"?: string; required?: boolean }>;
}) {
  const error = useFieldError(name);
  const id = `f-${name}`;
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-err` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
      </Label>
      {React.cloneElement(children, {
        id,
        name: children.props.name ?? name,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy,
        required: required || children.props.required,
      })}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-[12px] text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="text-[12px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** A button that invokes a server action, with confirmation and toast feedback. */
export function ActionButton({
  action,
  confirm,
  successMessage,
  children,
  refresh = true,
  onDone,
  ...props
}: ButtonProps & {
  action: () => Promise<ActionState>;
  confirm?: string;
  successMessage?: string;
  refresh?: boolean;
  onDone?: (s: ActionState) => void;
}) {
  const [pending, start] = React.useTransition();
  const router = useRouter();
  return (
    <Button
      type="button"
      disabled={pending || props.disabled}
      aria-busy={pending}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        start(async () => {
          const res = await action();
          if (res.ok) {
            announceSuccess(res, successMessage);
            if (refresh) router.refresh();
          } else toast.error(res.error);
          onDone?.(res);
        });
      }}
      {...props}
    >
      {pending && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </Button>
  );
}
