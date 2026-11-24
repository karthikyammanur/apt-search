// The shared app header from docs/ui/Main.dc.html: app name on the left, a text nav on the right,
// the current page underlined and marked with aria-current. It sits in the same 760 px column as
// the content, with no background, border or icons, wraps at phone width, and every link is at
// least 44 px tall. A server component: no client JS, no env reads.

import Link from "next/link";

export const NAV_ITEMS = [
  { id: "listings", label: "Listings", href: "/" },
  { id: "chat", label: "Chat", href: "/chat" },
  { id: "sources", label: "Sources", href: "/leads" },
  { id: "settings", label: "Settings", href: "/settings" },
] as const;

export type NavId = (typeof NAV_ITEMS)[number]["id"];

export type AppHeaderProps = {
  /** The page being shown. Listing detail, compare and requirements pages pass "listings". */
  current?: NavId;
};

export function AppHeader({ current }: AppHeaderProps) {
  return (
    <header className="mx-auto flex w-full max-w-column flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 pt-5">
      <Link href="/" className="flex min-h-touch items-center text-base font-semibold text-ink no-underline">
        Apartment finder
      </Link>
      <nav aria-label="Main" className="flex flex-wrap gap-6">
        {NAV_ITEMS.map((item) => {
          const active = item.id === current;
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "flex min-h-touch items-center text-[15px] text-ink underline underline-offset-[6px]"
                  : "flex min-h-touch items-center text-[15px] text-muted-foreground no-underline hover:text-ink"
              }
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

export default AppHeader;
