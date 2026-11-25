import { getLeads, getSourceRuns } from "@/lib/queries";
import { ViewShell, primaryButton, fieldClass } from "@/components/view-shell";
import { pasteListing } from "../actions";
import { requireLogin } from "../auth";

export default async function Leads({
  searchParams,
}: {
  searchParams: Promise<{ result?: string }>;
}) {
  await requireLogin();
  const [sources, leads, params] = await Promise.all([getSourceRuns(), getLeads(), searchParams]);
  const now = new Date().getTime();
  const due = (at: string | null) => !at || now - Date.parse(at) > 20 * 60 * 60 * 1000;
  return (
    <ViewShell current="sources">
      <h1>Sources</h1>
      <ul className="mt-6">
        {sources.channels.map((source) => (
          <li key={source.channel} className="flex justify-between gap-4 border-t border-line py-4">
            <span>
              {source.channel === "facebook_capture"
                ? "Facebook groups"
                : source.channel === "supost"
                  ? "SUPost"
                  : source.channel.replaceAll("_", " ")}
            </span>
            <span
              className={
                source.channel === "facebook_capture" && due(source.lastOkAt)
                  ? "text-attention"
                  : "text-muted-foreground"
              }
            >
              {source.channel === "facebook_capture" && due(source.lastOkAt)
                ? "Capture due"
                : (source.lastError ??
                  (source.lastRunAt ? `${source.newLast24h} new today` : "Never run"))}
            </span>
          </li>
        ))}
      </ul>
      {sources.facebookGroups.map((group) => (
        <div
          key={group.groupName}
          className="flex justify-between gap-4 border-t border-line py-4 text-sm"
        >
          <span>{group.groupName}</span>
          <span className={due(group.lastCapturedAt) ? "text-attention" : "text-muted-foreground"}>
            {due(group.lastCapturedAt) ? "Capture due, " : ""}Last capture{" "}
            {new Date(group.lastCapturedAt).toLocaleDateString("en-US", { timeZone: "UTC" })}
          </span>
        </div>
      ))}
      <p className="mt-4 text-sm text-muted-foreground">
        For Facebook, open a group, scroll a little, and click the extension. It only reads
        what&apos;s on your screen.
      </p>
      <section>
        <h2>Possible roommates</h2>
        <p className="text-sm text-muted-foreground">Only after you&apos;ve met on video.</p>
        <ul className="mt-4">
          {leads.map((lead) => (
            <li key={lead.id} className="border-t border-line py-4">
              <div className="flex justify-between gap-4">
                <span>{lead.posterName ?? "Unknown name"}</span>
                <span className="text-sm text-muted-foreground">
                  {lead.status.replaceAll("_", " ")}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{lead.notes ?? lead.text}</p>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>
          <label htmlFor="paste">Paste a listing</label>
        </h2>
        <form action={pasteListing}>
          <textarea
            id="paste"
            name="text"
            required
            maxLength={30000}
            rows={3}
            placeholder="From a text, a group chat, anywhere"
            className={`${fieldClass} w-full`}
          />
          <button className={`${primaryButton} mt-3`}>Check it</button>
        </form>
        {params.result && (
          <p role="status" className="mt-3">
            {params.result}
          </p>
        )}
      </section>
    </ViewShell>
  );
}
