"use client";

import { useEffect, useRef } from "react";

type ModalProps = {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
};

/**
 * A focused dialog built on the browser's own <dialog>: it traps keyboard focus, closes with Escape,
 * and returns focus to the button that opened it.
 */
export function Modal({ title, onClose, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby="modal-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose(); // tap outside the box
      }}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-glaze bg-paper p-0 text-ink backdrop:bg-ink/50"
    >
      <div className="p-6">
        <h2 id="modal-title" className="text-2xl font-bold text-ink">
          {title}
        </h2>
        <div className="mt-4">{children}</div>
      </div>
    </dialog>
  );
}
