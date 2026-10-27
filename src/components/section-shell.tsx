import { TopBar } from "@/components/top-bar";
import { PageHeader } from "@/components/ui/page-header";
import { getSessionState } from "@/features/auth/session";
import { LiveSync } from "@/features/sync/components/live-sync";
import type { Topic, Versions } from "@/features/sync/topics";

type SectionShellProps = {
  title: string;
  description: string;
  children: React.ReactNode;
  /** Use the full screen width (floor map). */
  wide?: boolean;
  /** Keep this page current across devices: the topics it shows and the versions it was drawn with. */
  live?: { watch: readonly Topic[]; versions: Versions };
};

/** Frame for inner pages: top bar, page title with Home button, then the page body. */
export async function SectionShell({ title, description, children, wide = false, live }: SectionShellProps) {
  const session = await getSessionState();
  const displayName = session.status === "signed-in" ? session.user.displayName : "";

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar displayName={displayName} wide={wide} />
      <main className={`mx-auto w-full flex-1 px-4 py-8 sm:px-6 ${wide ? "max-w-[96rem]" : "max-w-6xl"}`}>
        <PageHeader
          title={title}
          description={description}
          status={live ? <LiveSync watch={live.watch} versions={live.versions} /> : null}
        />
        <div className="mt-8">{children}</div>
      </main>
    </div>
  );
}

type ComingSoonProps = { phase: number; items: string[] };

/** Honest placeholder: says what this page will do and which phase builds it. */
export function ComingSoon({ phase, items }: ComingSoonProps) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-glaze bg-paper p-6 sm:p-8">
      <p className="text-lg font-semibold text-ink">Not built yet. Phase {phase} adds:</p>
      <ul className="mt-3 list-disc space-y-1 pl-6 text-base text-muted">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
