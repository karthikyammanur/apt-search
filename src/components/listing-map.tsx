"use client";

import { useEffect, useRef, useState } from "react";
import type { BoardItem, MapPoints } from "@/lib/queries";
import { mapModel } from "@/lib/queries/map-model";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * MapLibre finds its worker script next to the file it was loaded from. Next moves that file into a
 * hashed chunk, so the default path does not exist and the worker never starts: the style loads but no
 * tile is drawn (a grey map with only the attribution). The script is served from public/ instead.
 */
export const MAP_WORKER_URL = "/maplibre/maplibre-gl-worker.mjs";
export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

const PIN = "flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-xs font-medium";

export function ListingMap({ items, points }: { items: BoardItem[]; points: MapPoints }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const model = mapModel(items, points.office);
  useEffect(() => {
    let disposed = false;
    let map: import("maplibre-gl").Map | undefined;
    import("maplibre-gl")
      .then((maplibre) => {
        if (disposed || !container.current) return;
        const { Map, Marker, Popup } = maplibre;
        try {
          maplibre.setWorkerUrl(MAP_WORKER_URL);
          map = new Map({
            container: container.current,
            style: MAP_STYLE_URL,
            center: points.office ? [points.office.lng, points.office.lat] : [-122.14, 37.44],
            zoom: 11,
            attributionControl: { compact: true },
          });
          const live = map;
          // Stations: a small dot, the name on hover (the title) and on tap (a popup).
          for (const station of points.stations) {
            const dot = document.createElement("button");
            dot.type = "button";
            dot.title = station.name;
            dot.setAttribute("aria-label", `${station.name} Caltrain station`);
            dot.className = "h-2.5 w-2.5 rounded-full border border-white bg-ink";
            new Marker({ element: dot })
              .setLngLat([station.lng, station.lat])
              .setPopup(new Popup({ offset: 8, closeButton: false }).setText(station.name))
              .addTo(live);
          }
          if (points.office) {
            const office = document.createElement("span");
            office.textContent = "Office";
            office.setAttribute("aria-label", "Your office");
            office.className = "rounded-thumb bg-primary px-2 py-1 text-xs font-medium text-white";
            new Marker({ element: office }).setLngLat([points.office.lng, points.office.lat]).addTo(live);
          }
          // Listing pins: solid for a street address, hollow when the place is only approximate.
          for (const pin of model.pins) {
            const element = document.createElement("a");
            element.textContent = pin.label;
            element.setAttribute("href", pin.href);
            element.setAttribute("aria-label", pin.approximate ? `Listing ${pin.label}, approximate location` : `Listing ${pin.label}`);
            element.className = pin.approximate
              ? `${PIN} border-2 border-ink bg-white text-ink`
              : `${PIN} border-2 border-ink bg-ink text-white`;
            new Marker({ element }).setLngLat([pin.lng, pin.lat]).addTo(live);
          }
          if (model.fit) {
            live.fitBounds(
              [
                [model.fit[0], model.fit[1]],
                [model.fit[2], model.fit[3]],
              ],
              { padding: 50, maxZoom: 15, duration: 0 },
            );
          }
        } catch {
          setError(true);
        }
      })
      .catch(() => setError(true));
    return () => {
      disposed = true;
      map?.remove();
    };
    // The model is rebuilt from the same two props, so those are what the map depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, points]);
  return (
    <div className="mt-6">
      <div ref={container} role="region" aria-label="Listing map" className="h-[420px] w-full" />
      {error && <p role="status">Map unavailable. Switch to List to see listings.</p>}
      {!points.office && <p className="text-sm text-attention">Office location: Unknown</p>}
      <p className="mt-2 text-sm text-muted-foreground">
        Pins follow list order. A hollow pin is an approximate location. {model.unknownLocation} listings have an Unknown location.
      </p>
    </div>
  );
}
