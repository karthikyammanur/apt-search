"use client";

import { useState } from "react";
export function CopyDraft({ text }: { text: string }) {
  const [draft, setDraft] = useState(text);
  const [message, setMessage] = useState("");
  return (
    <>
      <label className="sr-only" htmlFor="draft">
        Draft message
      </label>
      <textarea
        id="draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={4}
        className="w-full rounded-field border border-field p-3"
      />
      <button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(draft);
            setMessage("Copied");
          } catch {
            setMessage("Select the draft and copy it manually.");
          }
        }}
        className="mt-2"
      >
        Copy
      </button>
      <span role="status" className="ml-4 text-sm text-muted-foreground">
        {message}
      </span>
    </>
  );
}
