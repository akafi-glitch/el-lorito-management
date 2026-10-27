import type { Metadata } from "next";

import { requireActiveUser } from "@/features/auth/session";
import { AccountsManager } from "@/features/staff/components/accounts-manager";
import { loadAccounts } from "@/features/staff/queries";

export const metadata: Metadata = { title: "Sign-in accounts" };

export default async function AccountsPage() {
  const [user, accounts] = await Promise.all([requireActiveUser(), loadAccounts()]);
  return <AccountsManager accounts={accounts} currentUserId={user.userId} />;
}
