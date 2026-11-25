import type { ReactNode } from "react";
import { AppHeader, type NavId } from "./app-header";

export function ViewShell({
  children,
  current = "listings",
}: {
  children: ReactNode;
  current?: NavId;
}) {
  return (
    <>
      <AppHeader current={current} />
      <main className="mx-auto w-full max-w-column px-6 pb-16 pt-12 text-body [&_a]:inline-flex [&_a]:min-h-touch [&_a]:items-center [&_button]:min-h-touch [&_input]:min-h-touch [&_h1]:text-title [&_h1]:font-semibold [&_h2]:mb-3 [&_h2]:font-semibold [&_section]:mt-10">
        {children}
      </main>
    </>
  );
}
export const primaryButton = "min-h-touch rounded-field bg-ink px-6 text-white disabled:opacity-50";
export const fieldClass = "min-h-touch min-w-0 rounded-thumb border border-field px-3 py-2 bg-bg";
