import Link from "next/link";
import { getBoard, getListing } from "@/lib/queries";
import { FILTER_LABELS } from "@/components/listing-values";
import { ViewShell } from "@/components/view-shell";
import { requireLogin } from "../auth";

export default async function Requirements() {
  await requireLogin();
  const board = await getBoard();
  const details = await Promise.all(board.items.map((item) => getListing(item.id)));
  return (
    <ViewShell>
      <h1>Requirements</h1>
      <ul className="mt-8">
        {Object.entries(FILTER_LABELS).map(([key, label]) => (
          <li key={key} className="border-t border-line py-4">
            <h2>{label}</h2>
            <div className="flex flex-wrap gap-x-6">
              {(["pass", "fail", "unknown"] as const).map((status) => (
                <Link
                  key={status}
                  className={status === "unknown" ? "text-attention" : "text-muted-foreground"}
                  href={`/?requirement=${key}&check=${status}`}
                >
                  {status === "unknown" ? "Unknown" : status === "pass" ? "Pass" : "Fail"}{" "}
                  {
                    details.filter(
                      (d) =>
                        (d?.filters?.results.find((r) => r.filter === key)?.status ?? "unknown") ===
                        status,
                    ).length
                  }
                </Link>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </ViewShell>
  );
}
