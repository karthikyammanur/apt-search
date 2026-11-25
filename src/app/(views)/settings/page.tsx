import { getSettings } from "@/lib/queries";
import { ViewShell, fieldClass, primaryButton } from "@/components/view-shell";
import { saveSettings } from "../actions";
import { requireLogin } from "../auth";

export default async function Settings({
  searchParams,
}: {
  searchParams: Promise<{ result?: string }>;
}) {
  await requireLogin();
  const { settings, weights } = await getSettings();
  const params = await searchParams;
  const fields = [
    ["officeAddress", "Office", "text"],
    ["region", "Region", "text"],
    ["budgetCapCents", "Most you'll pay, all-in (cents)", "number"],
    ["moveInEarliest", "Earliest move-in", "date"],
    ["moveInLatest", "Latest move-in", "date"],
    ["startDate", "Start date", "date"],
    ["moveOut", "Move out", "date"],
    ["maxCommuteMinutes", "Longest commute (minutes)", "number"],
  ] as const;
  return (
    <ViewShell current="settings">
      <h1>Settings</h1>
      <p className="mt-2 text-muted-foreground">Saving re-checks every listing.</p>
      {params.result && (
        <p role="status" className="mt-4">
          {params.result}
        </p>
      )}
      <form action={saveSettings} className="mt-8">
        {fields.map(([key, label, type]) => (
          <div
            key={key}
            className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-line py-4"
          >
            <label htmlFor={key}>{label}</label>
            <input
              id={key}
              name={key}
              type={type}
              required
              min={type === "number" ? 1 : undefined}
              defaultValue={settings[key]}
              className={`${fieldClass} w-full sm:w-[320px]`}
            />
          </div>
        ))}
        <fieldset className="border-t border-line py-4">
          <legend className="pt-4">Must have</legend>
          <div className="flex flex-wrap gap-x-7">
            {(
              [
                ["requirePrivateBedroom", "Private bedroom"],
                ["requirePrivateBath", "Private bathroom"],
                ["requireFurnished", "Furnished"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex min-h-touch items-center gap-3">
                <input
                  name={key}
                  type="checkbox"
                  defaultChecked={settings[key]}
                  className="accent-ink"
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <section className="border-t border-line py-4">
          <h2>How much each matters</h2>
          <p className="text-sm text-muted-foreground">Ask in chat to adjust these weights.</p>
          {weights.map((weight) => (
            <div key={weight.factor} className="flex justify-between py-2">
              <span>{weight.label}</span>
              <span>{Math.round(weight.weight * 100)}%</span>
            </div>
          ))}
        </section>
        <button className={`${primaryButton} mt-8`}>Save</button>
      </form>
    </ViewShell>
  );
}
