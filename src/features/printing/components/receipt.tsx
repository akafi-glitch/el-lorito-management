"use client";

import { createPortal } from "react-dom";

import { formatRate } from "@/features/billing/tax";
import { formatCents } from "@/features/menu/money";

import { printableWidthMm, type ReceiptData } from "../receipt";

/**
 * The customer ticket for the thermal printer. It is placed straight under <body> and is only
 * visible when printing (globals.css hides everything else then), so one short strip of paper
 * comes out: black text, no backgrounds, sized to the paper.
 */
export function Receipt({ receipt, paperWidthMm }: { receipt: ReceiptData; paperWidthMm: 58 | 80 }) {
  const amount = (cents: number) => formatCents(cents).replace("$", "");
  const width = printableWidthMm(paperWidthMm);

  return createPortal(
    <div
      className="receipt-print"
      data-testid="receipt"
      style={{ width: `${paperWidthMm}mm`, padding: `2mm ${(paperWidthMm - width) / 2}mm 6mm` }}
    >
      <style>{`@media print { @page { size: ${paperWidthMm}mm auto; margin: 0; } }`}</style>
      <div className="receipt-center">
        <div className="receipt-title">{receipt.restaurantName}</div>
        <div>{receipt.restaurantSubtitle}</div>
      </div>
      <hr />
      <Row left={`Ticket #${receipt.ticketNumber}`} right="" />
      <Row left={`Table ${receipt.tables}`} right="" />
      <Row left={`Waiter #${receipt.waiterNumber}`} right="" />
      <Row left={receipt.printedAt} right="" />
      <hr />
      {receipt.lines.map((line, index) => (
        <div key={index} className="receipt-line">
          <Row left={`${line.quantity} ${line.name}`} right={amount(line.totalCents)} />
          {line.quantity > 1 ? <div className="receipt-each">@ {amount(line.unitCents)} each</div> : null}
        </div>
      ))}
      <hr />
      <Row left="Food subtotal" right={amount(receipt.totals.foodSubtotalCents)} />
      <Row left="Liquor subtotal" right={amount(receipt.totals.liquorSubtotalCents)} />
      <Row left={`Food tax (${formatRate(receipt.totals.rates.food)})`} right={amount(receipt.totals.foodTaxCents)} />
      <Row left={`Liquor tax (${formatRate(receipt.totals.rates.liquor)})`} right={amount(receipt.totals.liquorTaxCents)} />
      <hr />
      <div className="receipt-total">
        <Row left="TOTAL" right={formatCents(receipt.totals.totalCents)} />
      </div>
    </div>,
    document.body,
  );
}

function Row({ left, right }: { left: string; right: string }) {
  return (
    <div className="receipt-row">
      <span>{left}</span>
      <span>{right}</span>
    </div>
  );
}
