"use client";

import { createPortal } from "react-dom";

import { formatRate } from "@/features/billing/tax";
import { formatCents } from "@/features/menu/money";

import { printableWidthMm, receiptAmount, type KitchenReceiptData, type ReceiptData } from "../receipt";

function paperStyle(paperWidthMm: 58 | 80) {
  const width = printableWidthMm(paperWidthMm);
  return { width: `${paperWidthMm}mm`, padding: `2mm ${(paperWidthMm - width) / 2}mm 6mm` };
}

function PageRule({ paperWidthMm }: { paperWidthMm: 58 | 80 }) {
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
      <Row left={`TICKET #${receipt.ticketNumber}`} right="" />
      <Row left={`WAITER: ${receipt.waiterNumber}`} right="" />
      <Row left={`TABLE: ${receipt.tables}`} right="" />
      <Row left={`TIME: ${receipt.printedAt}`} right="" />
      <hr />
      {receipt.lines.map((line, index) => (
        <div key={index} className="receipt-line">
          <Row left={`${line.quantity} × ${line.name}`} right={formatCents(line.totalCents)} />
          <div className="receipt-each">@ {receiptAmount(line.unitCents)} each</div>
        </div>
      ))}
      <hr />
      <Row left="Food Subtotal" right={formatCents(receipt.totals.foodSubtotalCents)} />
      <Row left="Liquor Subtotal" right={formatCents(receipt.totals.liquorSubtotalCents)} />
      <Row left={`Food Tax (${formatRate(receipt.totals.rates.food)})`} right={formatCents(receipt.totals.foodTaxCents)} />
      <Row left={`Liquor Tax (${formatRate(receipt.totals.rates.liquor)})`} right={formatCents(receipt.totals.liquorTaxCents)} />
      <hr />
      <div className="receipt-total">
        <Row left="TOTAL" right={formatCents(receipt.totals.totalCents)} />
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

function Row({ left, right }: { left: string; right: string }) {
  return (
    <div className="receipt-row">
      <span>{left}</span>
      <span>{right}</span>
    </div>
  );
}
