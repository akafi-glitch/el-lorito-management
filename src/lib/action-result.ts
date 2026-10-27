/** What every Server Action returns: success or a message staff can read. */
export type ActionResult = { ok: true; message: string } | { ok: false; message: string };
