"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";

import { signIn, type SignInState } from "./actions";

const initialState: SignInState = { error: null, username: "" };

export function SignInForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(signIn, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="next" value={next} />
      <TextField
        label="Username"
        name="username"
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
        defaultValue={state.username}
        aria-invalid={state.error ? true : undefined}
        aria-describedby={state.error ? "sign-in-error" : undefined}
      />
      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        aria-invalid={state.error ? true : undefined}
        aria-describedby={state.error ? "sign-in-error" : undefined}
      />
      <p id="sign-in-error" role="alert" aria-live="assertive" className="min-h-6 text-base font-semibold text-danger">
        {state.error}
      </p>
      <Button type="submit" disabled={pending} className="w-full text-lg">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
