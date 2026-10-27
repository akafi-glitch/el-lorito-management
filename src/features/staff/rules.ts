/**
 * Staff rules (owner decisions, Oct 26, 2026). Pure code, mirrored by the database functions.
 */

export const ROLES = ["waiter", "chips_runner", "manager"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  waiter: "Waiter",
  chips_runner: "Chips runner",
  manager: "Manager",
};

export const DUTIES = ["waiter", "chips_runner"] as const;
export type Duty = (typeof DUTIES)[number];

export const DUTY_LABEL: Record<Duty, string> = { waiter: "Waiter", chips_runner: "Chips runner" };

/** "007" and "7" are the same number, so staff can type either. */
export function employeeNumberKey(raw: string): string {
  const trimmed = raw.trim().replace(/^0+/, "");
  return trimmed === "" ? "0" : trimmed;
}

/** Waiters take waiter duty, chips runners take runner duty, managers can take either. */
export function canTakeDuty(role: Role, duty: Duty): boolean {
  return role === "manager" || role === duty;
}

export type EmployeeRef = { id: number; number: string; name: string; role: Role; isActive: boolean };

/** How staff appear everywhere: "Kafi (01)". */
export function employeeLabel(employee: Pick<EmployeeRef, "name" | "number">): string {
  return `${employee.name} (${employee.number})`;
}

export type SectionRef = { code: string; name: string; openToAllWaiters: boolean };
export type CurrentAssignment = { sectionCode: string; duty: Duty; employeeId: number };

export type BoardRow = {
  section: SectionRef;
  waiter: EmployeeRef | null;
  runner: EmployeeRef | null;
  /** False for the Bar: any waiter can bill it, so nobody is assigned. */
  takesWaiter: boolean;
};

/** One row per section for the assignment board, in section order. */
export function buildBoard(
  sections: readonly SectionRef[],
  assignments: readonly CurrentAssignment[],
  employees: readonly EmployeeRef[],
): BoardRow[] {
  const byId = new Map(employees.map((employee) => [employee.id, employee]));
  const find = (sectionCode: string, duty: Duty) => {
    const match = assignments.find((a) => a.sectionCode === sectionCode && a.duty === duty);
    return match ? (byId.get(match.employeeId) ?? null) : null;
  };
  return sections.map((section) => ({
    section,
    waiter: section.openToAllWaiters ? null : find(section.code, "waiter"),
    runner: find(section.code, "chips_runner"),
    takesWaiter: !section.openToAllWaiters,
  }));
}

/** Active employees who may take a duty, sorted by number. */
export function eligibleFor(duty: Duty, employees: readonly EmployeeRef[]): EmployeeRef[] {
  return employees
    .filter((employee) => employee.isActive && canTakeDuty(employee.role, duty))
    .sort((a, b) => a.number.localeCompare(b.number, "en", { numeric: true }));
}

export type AccountRef = { userId: string; username: string; displayName: string; isActive: boolean };

/**
 * Administrator accounts: nobody may turn off their own account (no locking yourself out), and at
 * least one account must stay on.
 */
export function accountChangeProblem(
  target: AccountRef,
  makeActive: boolean,
  actorId: string,
  accounts: readonly AccountRef[],
): string | null {
  if (makeActive) return null;
  if (target.userId === actorId) return "You can't turn off the account you're signed in with.";
  const othersOn = accounts.filter((account) => account.isActive && account.userId !== target.userId).length;
  if (othersOn === 0) return "At least one administrator account must stay on.";
  return null;
}
