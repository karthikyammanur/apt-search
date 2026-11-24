import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import { appliedProposals } from "@/lib/agent/actions";
import { isStoredAssistant, isStoredUser } from "@/lib/agent/history";
import { getChatMessages, getFeedbackEvents } from "@/lib/queries";
import { ChatView, type ChatEntry } from "./chat-view";

export const metadata: Metadata = { title: "Chat · Apartment Finder" };
export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const rows = await getChatMessages({ limit: 60 });
  const applied = [...(await appliedProposals())];
  const undone = (await getFeedbackEvents({ limit: 200 })).filter((e) => e.undoneAt !== null).map((e) => e.id);
  const entries: ChatEntry[] = rows.flatMap((row): ChatEntry[] => {
    if (row.role === "user" && isStoredUser(row.content)) return [{ role: "user", key: `m${row.id}`, text: row.content.text }];
    if (row.role === "assistant" && isStoredAssistant(row.content)) {
      return [{ role: "assistant", key: `m${row.id}`, messageId: row.id, text: row.content.text, tools: row.content.tools, notice: row.content.notice, pending: false }];
    }
    return [];
  });
  return (
    <>
      <AppHeader current="chat" />
      <ChatView initial={entries} applied={applied} undone={undone} />
    </>
  );
}
