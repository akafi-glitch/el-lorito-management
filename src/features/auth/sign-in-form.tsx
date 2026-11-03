"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";

import { signIn, type SignInState } from "./actions";
import { Turnstile } from "./turnstile";

const initialState: SignInState = { error: null, username: "" };

export function SignInForm({ next, siteKey }: { next: string; siteKey: string }) {
  const [state, formAction, pending] = useActionState(signIn, initialState);
  const [captchaToken, setCaptchaToken] = useState("");

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="next" value={next} />
      {siteKey && <input type="hidden" name="captchaToken" value={captchaToken} />}
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
      {siteKey && <Turnstile siteKey={siteKey} token={captchaToken} resetAfterError={state.error ? state : null} onTokenChange={setCaptchaToken} />}
      <p id="sign-in-error" role="alert" aria-live="assertive" className="min-h-6 text-base font-semibold text-danger">
        {state.error}
      </p>
      <Button type="submit" disabled={pending || Boolean(siteKey && !captchaToken)} className="w-full text-lg">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
