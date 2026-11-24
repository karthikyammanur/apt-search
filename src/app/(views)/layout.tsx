import type { ReactNode } from "react";
import { requireLogin } from "./auth";

export const dynamic = "force-dynamic";
export default async function ViewsLayout({ children }: { children: ReactNode }) {
  await requireLogin();
  return children;
}
