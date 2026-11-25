"use client";

/* eslint-disable @next/next/no-img-element -- Photos load directly in the browser; the server must not download them. */

import { useState } from "react";

export function Photo({
  url,
  originalUrl,
  thumbnail = false,
}: {
  url: string | null;
  originalUrl: string | null;
  thumbnail?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      className={`${thumbnail ? "h-[72px] w-[72px] shrink-0" : "h-[300px] w-full sm:h-[380px]"} flex items-center justify-center overflow-hidden rounded-thumb bg-thumb`}
    >
      {url && !failed ? (
        <img
          src={url}
          alt="Listing photo"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : originalUrl ? (
        <a
          className="p-1 text-center text-xs text-muted-foreground"
          href={originalUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open original post
        </a>
      ) : (
        <span className="text-xs text-muted-foreground">No photo</span>
      )}
    </div>
  );
}
export function PhotoGallery({
  urls,
  originalUrl,
}: {
  urls: string[];
  originalUrl: string | null;
}) {
  const [index, setIndex] = useState(0);
  const [touch, setTouch] = useState<number | null>(null);
  const move = (delta: number) => setIndex((n) => (n + delta + urls.length) % urls.length);
  return (
    <div
      tabIndex={0}
      role="group"
      aria-label="Listing photos"
      onKeyDown={(event) => {
        if (urls.length && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
          event.preventDefault();
          move(event.key === "ArrowRight" ? 1 : -1);
        }
      }}
      onTouchStart={(event) => setTouch(event.changedTouches[0]?.clientX ?? null)}
      onTouchEnd={(event) => {
        const x = event.changedTouches[0]?.clientX;
        if (urls.length && touch !== null && x !== undefined && Math.abs(x - touch) > 35)
          move(x < touch ? 1 : -1);
      }}
    >
      <Photo key={index} url={urls[index] ?? null} originalUrl={originalUrl} />
      {urls.length > 0 && (
        <div className="flex items-center justify-end gap-4 text-sm">
          <button onClick={() => move(-1)} aria-label="Previous photo">
            Previous
          </button>
          <span>
            {index + 1} / {urls.length}
          </span>
          <button onClick={() => move(1)} aria-label="Next photo">
            Next
          </button>
        </div>
      )}
    </div>
  );
}
