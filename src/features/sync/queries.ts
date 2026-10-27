import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import { versionRowsSchema, versionsFromRows, type Versions } from "./topics";

/** The current version of every topic (one tiny read). */
export async function loadVersions(): Promise<Versions> {
  const { data, error } = await createAdminClient().from("sync_versions").select("topic, version");
  if (error) throw new Error(`Could not load the change versions: ${error.message}`);
  return versionsFromRows(versionRowsSchema.parse(data));
}
