"use client";

import { useEffect, useRef, useState } from "react";
import type { BoardItem, MapPoints } from "@/lib/queries";
import "maplibre-gl/dist/maplibre-gl.css";

export function ListingMap({ items, points }: { items: BoardItem[]; points: MapPoints }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let disposed = false;
    let map: import("maplibre-gl").Map | undefined;
    import("maplibre-gl")
      .then(({ Map, Marker, LngLatBounds }) => {
        if (disposed || !container.current) return;
        try {
          map = new Map({
            container: container.current,
            style: "https://tiles.openfreemap.org/styles/positron",
            center: points.office ? [points.office.lng, points.office.lat] : [-122.14, 37.44],
            zoom: 11,
            attributionControl: { compact: true },
          });
          const bounds = new LngLatBounds();
          function pin(lat: number, lng: number, label: string, href?: string) {
            const element = document.createElement(href ? "a" : "span");
            element.textContent = label;
            element.setAttribute("aria-label", label);
            if (href) element.setAttribute("href", href);
            element.className = "bg-ink text-white rounded-full px-3 py-2 text-xs";
            new Marker({ element }).setLngLat([lng, lat]).addTo(map!);
            bounds.extend([lng, lat]);
          }
          items.forEach((item, index) => {
            if (item.lat !== null && item.lng !== null)
              pin(item.lat, item.lng, String(index + 1), `/listing/${item.id}`);
          });
          if (points.office) pin(points.office.lat, points.office.lng, "Your office");
          points.stations.forEach((station) => pin(station.lat, station.lng, station.name));
          if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 50, maxZoom: 13, duration: 0 });
        } catch {
          setError(true);
        }
      })
      .catch(() => setError(true));
    return () => {
      disposed = true;
      map?.remove();
    };
  }, [items, points]);
  return (
    <div className="mt-6">
      <div ref={container} role="region" aria-label="Listing map" className="h-[420px] w-full" />
      {error && <p role="status">Map unavailable. Switch to List to see listings.</p>}
      {!points.office && <p className="text-sm text-attention">Office location: Unknown</p>}
      <p className="mt-2 text-sm text-muted-foreground">
        Pins follow list order.{" "}
        {items.filter((item) => item.lat === null || item.lng === null).length} listings have an
        Unknown location.
      </p>
    </div>
  );
}
