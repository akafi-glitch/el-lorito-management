"use client";

import { useState } from "react";

import { buttonClasses } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { TextField } from "@/components/ui/text-field";
import { NoticeBanner, useActionRunner } from "@/components/use-action-runner";
import { PASSWORD_MIN_LENGTH } from "@/features/auth/username";

import { addAccountAction, setAccountActiveAction, setAccountPasswordAction } from "../actions";
import type { AccountListItem } from "../queries";

const emptyDraft = { username: "", displayName: "", password: "", confirm: "" };

/** Administrator sign-in accounts: add, turn off or on, and set a new password. */
export function AccountsManager({ accounts, currentUserId }: { accounts: AccountListItem[]; currentUserId: string }) {
  const { busy, notice, run } = useActionRunner();
  const [draft, setDraft] = useState(emptyDraft);
  const [passwordFor, setPasswordFor] = useState<AccountListItem | null>(null);
  const [newPassword, setNewPassword] = useState({ password: "", confirm: "" });

  return (
    <div className="flex flex-col gap-6">
      <NoticeBanner notice={notice} />

      <section aria-labelledby="add-account" className="rounded-2xl border border-glaze bg-paper p-5">
        <h2 id="add-account" className="text-xl font-bold text-ink">
          Add a sign-in account
        </h2>
        <p className="mt-1 text-sm text-muted">
          These accounts unlock the app on a device. Waiters don&apos;t need one; they use their employee number.
          Passwords need at least {PASSWORD_MIN_LENGTH} characters and are never shown again.
        </p>
        <form
          className="mt-4 grid gap-4 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            run(() => addAccountAction(draft), () => setDraft(emptyDraft));
          }}
        >
          <TextField
            label="Username"
            name="new-username"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={draft.username}
            onChange={(event) => setDraft({ ...draft, username: event.target.value })}
            required
          />
          <TextField
            label="Display name"
            name="new-display-name"
            autoComplete="off"
            value={draft.displayName}
            onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
            required
          />
          <TextField
            label="Password"
            name="new-password"
            type="password"
            autoComplete="new-password"
            value={draft.password}
            onChange={(event) => setDraft({ ...draft, password: event.target.value })}
            required
          />
          <TextField
            label="Type the password again"
            name="new-password-confirm"
            type="password"
            autoComplete="new-password"
            value={draft.confirm}
            onChange={(event) => setDraft({ ...draft, confirm: event.target.value })}
            required
          />
          <div className="sm:col-span-2">
            <button type="submit" disabled={busy} className={buttonClasses("primary")}>
              Add account
            </button>
          </div>
        </form>
      </section>

      <section aria-labelledby="account-list" className="rounded-2xl border border-glaze bg-paper p-5">
        <h2 id="account-list" className="text-xl font-bold text-ink">
          Accounts ({accounts.length})
        </h2>
        <ul className="mt-4 flex flex-col gap-3">
          {accounts.map((account) => {
            const isMe = account.userId === currentUserId;
            return (
              <li
                key={account.userId}
                className={`flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between ${
                  account.isActive ? "border-glaze" : "border-dashed border-status-closed bg-status-closed/10"
                }`}
              >
                <div>
                  <p className="text-lg font-bold text-ink">
                    {account.displayName} <span className="font-normal text-muted">({account.username})</span>
                    {isMe ? <span className="ml-2 text-sm font-semibold text-leaf">You</span> : null}
                  </p>
                  <p className="text-sm text-muted">
                    {account.isActive ? "On" : "Turned off"}. Added {account.createdAt}.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    className={buttonClasses("secondary")}
                    onClick={() => {
                      setNewPassword({ password: "", confirm: "" });
                      setPasswordFor(account);
                    }}
                  >
                    Set new password
                  </button>
                  {isMe ? null : (
                    <button
                      type="button"
                      disabled={busy}
                      className={buttonClasses("secondary")}
                      onClick={() => run(() => setAccountActiveAction({ userId: account.userId, isActive: !account.isActive }))}
                    >
                      {account.isActive ? "Turn off" : "Turn on"}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {passwordFor ? (
        <Modal title={`New password for ${passwordFor.displayName}`} onClose={() => setPasswordFor(null)}>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              run(() => setAccountPasswordAction({ userId: passwordFor.userId, ...newPassword }), () => setPasswordFor(null));
            }}
          >
            <TextField
              label="New password"
              name="set-password"
              type="password"
              autoComplete="new-password"
              value={newPassword.password}
              onChange={(event) => setNewPassword({ ...newPassword, password: event.target.value })}
              required
            />
            <TextField
              label="Type it again"
              name="set-password-confirm"
              type="password"
              autoComplete="new-password"
              value={newPassword.confirm}
              onChange={(event) => setNewPassword({ ...newPassword, confirm: event.target.value })}
              required
            />
            <div className="flex flex-col gap-2 sm:flex-row-reverse">
              <button type="submit" disabled={busy} className={buttonClasses("primary", "flex-1")}>
                Save password
              </button>
              <button type="button" className={buttonClasses("secondary", "flex-1")} onClick={() => setPasswordFor(null)}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
