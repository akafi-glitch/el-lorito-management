"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { requestRefresh } from "@/features/sync/refresh";

import { printCustomerAction } from "../actions";

import { PrintFlow, type PrintStart } from "./print-flow";

/**
 * Another copy of a locked customer receipt, with its own message. On Management nobody has typed a
 * number yet, so employeeNumber can come from a field there.
 */
export function ReprintButton({
  employeeNumber,
  paperWidthMm,
  ticketId,
  disabled,
}: {
  employeeNumber: string;
  paperWidthMm: 58 | 80;
  ticketId: number;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function start(): Promise<PrintStart> {
    setError(null);
    const result = await printCustomerAction({ employeeNumber, ticketId, version: null, clientKey: crypto.randomUUID() });
    if (!result.ok) return { message: result.message };
    return {
      job: {
        attemptIds: [result.attemptId],
        content: { kind: "customer", receipt: result.receipt, isCopy: result.isCopy },
      },
    };
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p role="alert" className="rounded-xl border-2 border-danger bg-danger/10 px-4 py-3 text-base font-semibold text-danger">
          {error}
        </p>
      ) : null}
      <PrintFlow
        employeeNumber={employeeNumber}
        paperWidthMm={paperWidthMm}
        label="Reprint Customer Receipt"
        disabled={disabled}
        start={start}
        onError={setError}
        onDone={() => {
          if (!requestRefresh()) router.refresh();
        }}
      />
    </div>
  );
}
