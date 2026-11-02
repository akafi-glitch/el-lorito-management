"use client";

import { createPortal } from "react-dom";

import { formatRate } from "@/features/billing/tax";
import { formatCents } from "@/features/menu/money";

import { printableWidthMm, receiptAmount, type KitchenReceiptData, type ReceiptData } from "../receipt";

export function paperStyle(paperWidthMm: 58 | 80) {
  const width = printableWidthMm(paperWidthMm);
  return { width: `${paperWidthMm}mm`, padding: `2mm ${(paperWidthMm - width) / 2}mm 6mm` };
}

export function PageRule({ paperWidthMm }: { paperWidthMm: 58 | 80 }) {
  return <style>{`@media print { @page { size: ${paperWidthMm}mm auto; margin: 0; } }`}</style>;
}

/**
 * The customer bill for the thermal printer. It is placed straight under <body> and is only
 * visible when printing (globals.css hides everything else then), so one short strip of paper
 * comes out: black text, no backgrounds, sized to the paper.
 */
export function Receipt({ receipt, paperWidthMm, isCopy }: { receipt: ReceiptData; paperWidthMm: 58 | 80; isCopy: boolean }) {
  return createPortal(
    <div className="receipt-print" data-testid="receipt" style={paperStyle(paperWidthMm)}>
      <PageRule paperWidthMm={paperWidthMm} />
      <div className="receipt-center">
        <div className="receipt-title">{receipt.restaurantName}</div>
        {isCopy ? <div>COPY</div> : null}
      </div>
      <hr />
      <ReceiptRow left={`TICKET #${receipt.ticketNumber}`} right="" />
      <ReceiptRow left={`WAITER: ${receipt.waiterNumber}`} right="" />
      <ReceiptRow left={`TABLE: ${receipt.tables}`} right="" />
      <ReceiptRow left={`TIME: ${receipt.printedAt}`} right="" />
      <hr />
      {receipt.lines.map((line, index) => (
        <div key={index} className="receipt-line">
          <ReceiptRow left={`${line.quantity} × ${line.name}`} right={formatCents(line.totalCents)} />
          <div className="receipt-each">@ {receiptAmount(line.unitCents)} each</div>
        </div>
      ))}
      <hr />
      <ReceiptRow left="Food Subtotal" right={formatCents(receipt.totals.foodSubtotalCents)} />
      <ReceiptRow left="Liquor Subtotal" right={formatCents(receipt.totals.liquorSubtotalCents)} />
      <ReceiptRow left={`Food Tax (${formatRate(receipt.totals.rates.food)})`} right={formatCents(receipt.totals.foodTaxCents)} />
      <ReceiptRow left={`Liquor Tax (${formatRate(receipt.totals.rates.liquor)})`} right={formatCents(receipt.totals.liquorTaxCents)} />
      <hr />
      <div className="receipt-total">
        <ReceiptRow left="TOTAL" right={formatCents(receipt.totals.totalCents)} />
      </div>
      <hr />
      <div className="receipt-center receipt-thanks">THANK YOU!</div>
    </div>,
    document.body,
  );
}

/**
 * Kitchen receipts: large, bold, and with no prices at all (the data has none). Several orders sent
 * together come out one after the other, each with its own heading.
 */
export function KitchenReceipts({ receipts, paperWidthMm }: { receipts: readonly KitchenReceiptData[]; paperWidthMm: 58 | 80 }) {
  return createPortal(
    <div className="receipt-print kitchen-receipt" data-testid="kitchen-receipt" style={paperStyle(paperWidthMm)}>
      <PageRule paperWidthMm={paperWidthMm} />
      {receipts.map((receipt, index) => (
        <div key={index} className="kitchen-order">
          <div className="kitchen-title">{receipt.title}</div>
          {receipt.isReprint ? <div className="kitchen-reprint">** REPRINT **</div> : null}
          <div className="kitchen-ticket">TICKET #{receipt.ticketNumber}</div>
          <div className="kitchen-meta">TABLE: {receipt.tables}</div>
          <div className="kitchen-meta">WAITER: {receipt.waiterNumber}</div>
          <div className="kitchen-meta">ORDER: {receipt.orderNumber}</div>
          <div className="kitchen-time">TIME: {receipt.time}</div>
          <hr />
          {receipt.lines.map((line, lineIndex) => (
            <div key={lineIndex} className="kitchen-item">
              {line.quantity} × {line.name}
            </div>
          ))}
          {receipt.notes ? (
            <>
              <hr />
              <div className="kitchen-note">NOTE: {receipt.notes}</div>
            </>
          ) : null}
        </div>
      ))}
    </div>,
    document.body,
  );
}

export function ReceiptRow({ left, right }: { left: string; right: string }) {
  return (
    <div className="receipt-row">
      <span>{left}</span>
      <span>{right}</span>
    </div>
  );
}
