import { describe, expect, it } from "vitest";

import { accountErrorMessage, staffErrorMessage } from "./errors";
import {
  accountChangeProblem,
  buildBoard,
  canTakeDuty,
  eligibleFor,
  employeeLabel,
  employeeNumberKey,
  type AccountRef,
  type EmployeeRef,
} from "./rules";
import { addAccountSchema, addEmployeeSchema, assignDutySchema, setPasswordSchema } from "./schema";

const staff: EmployeeRef[] = [
  { id: 1, number: "01", name: "Kafi", role: "waiter", isActive: true },
  { id: 2, number: "02", name: "Jesus", role: "waiter", isActive: true },
  { id: 3, number: "03", name: "Abdullah", role: "chips_runner", isActive: true },
  { id: 4, number: "10", name: "Maria", role: "manager", isActive: true },
  { id: 5, number: "04", name: "Luis", role: "waiter", isActive: false },
];

const sections = [
  { code: "A", name: "A", openToAllWaiters: false },
  { code: "X-1", name: "X(1)", openToAllWaiters: false },
  { code: "BAR", name: "Bar", openToAllWaiters: true },
];

describe("employee numbers", () => {
  it.each([
    ["01", "1"],
    ["1", "1"],
    [" 007 ", "7"],
    ["0", "0"],
    ["000", "0"],
    ["120", "120"],
  ])("%j is looked up as %j", (typed, key) => {
    expect(employeeNumberKey(typed)).toBe(key);
  });

  it("shows staff as name and number", () => {
    expect(employeeLabel(staff[0]!)).toBe("Kafi (01)");
  });
});

describe("who can take which duty", () => {
  it("waiters wait, runners run, managers do both", () => {
    expect(canTakeDuty("waiter", "waiter")).toBe(true);
    expect(canTakeDuty("waiter", "chips_runner")).toBe(false);
    expect(canTakeDuty("chips_runner", "chips_runner")).toBe(true);
    expect(canTakeDuty("chips_runner", "waiter")).toBe(false);
    expect(canTakeDuty("manager", "waiter")).toBe(true);
    expect(canTakeDuty("manager", "chips_runner")).toBe(true);
  });

  it("offers only active, allowed staff, by number", () => {
    expect(eligibleFor("waiter", staff).map((e) => e.name)).toEqual(["Kafi", "Jesus", "Maria"]);
    expect(eligibleFor("chips_runner", staff).map((e) => e.name)).toEqual(["Abdullah", "Maria"]);
  });
});

describe("assignment board", () => {
  it("shows the latest assignment for each section and duty", () => {
    const board = buildBoard(
      sections,
      [
        { sectionCode: "X-1", duty: "waiter", employeeId: 1 },
        { sectionCode: "A", duty: "chips_runner", employeeId: 3 },
        { sectionCode: "BAR", duty: "chips_runner", employeeId: 3 },
      ],
      staff,
    );
    expect(board.map((row) => [row.section.name, row.waiter?.name ?? null, row.runner?.name ?? null])).toEqual([
      ["A", null, "Abdullah"],
      ["X(1)", "Kafi", null],
      ["Bar", null, "Abdullah"],
    ]);
  });

  it("never gives the Bar a waiter (any waiter can bill it)", () => {
    const board = buildBoard(sections, [{ sectionCode: "BAR", duty: "waiter", employeeId: 1 }], staff);
    expect(board[2]).toMatchObject({ takesWaiter: false, waiter: null });
  });
});

describe("administrator accounts", () => {
  const accounts: AccountRef[] = [
    { userId: "u1", username: "kafi", displayName: "Kafi", isActive: true },
    { userId: "u2", username: "maria", displayName: "Maria", isActive: true },
  ];

  it("can't turn off your own account", () => {
    expect(accountChangeProblem(accounts[0]!, false, "u1", accounts)).toMatch(/signed in with/);
  });

  it("can turn off someone else while another account stays on", () => {
    expect(accountChangeProblem(accounts[1]!, false, "u1", accounts)).toBeNull();
  });

  it("keeps at least one account on", () => {
    const lastOn = [accounts[0]!, { ...accounts[1]!, isActive: false }];
    expect(accountChangeProblem(lastOn[0]!, false, "someone-else", lastOn)).toMatch(/at least one/i);
  });

  it("turning an account on is always allowed", () => {
    expect(accountChangeProblem(accounts[0]!, true, "u1", accounts)).toBeNull();
  });
});

describe("input checks", () => {
  it("accepts an employee and trims spaces", () => {
    expect(addEmployeeSchema.parse({ number: " 01 ", name: " Kafi ", role: "waiter" })).toEqual({
      number: "01",
      name: "Kafi",
      role: "waiter",
    });
  });

  it.each([
    [{ number: "A1", name: "Kafi", role: "waiter" }, "Employee numbers are 1 to 6 digits, for example 01."],
    [{ number: "1234567", name: "Kafi", role: "waiter" }, "Employee numbers are 1 to 6 digits, for example 01."],
    [{ number: "01", name: "  ", role: "waiter" }, "Enter a name."],
    [{ number: "01", name: "Kafi", role: "host" }, "Choose a role."],
  ])("refuses %j", (input, message) => {
    const result = addEmployeeSchema.safeParse(input);
    expect(result.error?.issues[0]?.message).toBe(message);
  });

  it("allows clearing an assignment with no employee", () => {
    expect(assignDutySchema.safeParse({ sectionCode: "A", duty: "waiter", employeeId: null }).success).toBe(true);
  });

  it("requires matching passwords of at least 10 characters for new accounts", () => {
    const base = { username: "Maria", displayName: "Maria", password: "long-enough-1", confirm: "long-enough-1" };
    expect(addAccountSchema.parse(base).username).toBe("maria");
    expect(addAccountSchema.safeParse({ ...base, confirm: "different-123" }).error?.issues[0]?.message).toBe(
      "The two passwords don't match.",
    );
    expect(addAccountSchema.safeParse({ ...base, password: "short", confirm: "short" }).success).toBe(false);
    expect(
      setPasswordSchema.safeParse({ userId: "00000000-0000-4000-8000-000000000001", password: "x".repeat(73), confirm: "x".repeat(73) }).success,
    ).toBe(false);
  });
});

describe("messages", () => {
  it("explains database refusals in plain words", () => {
    expect(staffErrorMessage({ message: "no_open_shift" })).toBe("Start a shift first, then assign staff.");
    expect(staffErrorMessage({ message: "role_mismatch", details: "Abdullah" })).toMatch(/^Abdullah can't take this duty/);
    expect(staffErrorMessage({ message: "employee_number_taken", details: "Kafi" })).toMatch(/already used by Kafi/);
    expect(staffErrorMessage({ message: "bar_open_to_all" })).toMatch(/any waiter can bill it/);
    expect(staffErrorMessage({ message: "weird internal text" })).toMatch(/couldn't be saved/);
  });

  it("explains account problems without exposing Auth details", () => {
    expect(accountErrorMessage({ code: "email_exists" })).toBe("That username is already used.");
    expect(accountErrorMessage({ code: "weak_password" })).toMatch(/too weak/);
    expect(accountErrorMessage({ status: 500 })).toMatch(/couldn't be saved/);
  });
});
