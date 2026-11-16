import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Crosshair, Globe, Map as MapIcon } from "lucide-react";

interface GeofenceMapPickerProps {
  latitude: number;
  longitude: number;
  radiusM: number;
  onChange: (lat: number, lon: number) => void;
}

type TileMode = "osm" | "satellite";

const OSM_TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const ESRI_SAT_TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

const PIN_ICON = L.divIcon({
  className: "geo-pin-wrapper",
  html: `<div class="geo-pin-dot" title="Geser pin ke lokasi presensi"><span></span></div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

export default function GeofenceMapPicker({
  latitude,
  longitude,
  radiusM,
  onChange,
}: GeofenceMapPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [tileMode, setTileMode] = useState<TileMode>("osm");

  const safeLat = Number.isFinite(latitude) ? latitude : 1.4172;
  const safeLon = Number.isFinite(longitude) ? longitude : 124.9835;
  const safeRadius = Number.isFinite(radiusM) && radiusM > 0 ? radiusM : 50;

  // Initialize Leaflet map once
  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    const map = L.map(el, {
      center: [safeLat, safeLon],
      zoom: 17,
      zoomControl: true,
      attributionControl: true,
    });

    const layer = L.tileLayer(OSM_TILE_URL, {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(map);
    tileLayerRef.current = layer;

    const circle = L.circle([safeLat, safeLon], {
      radius: safeRadius,
      color: "#0E8F7E",
      fillColor: "#3CC4AE",
      fillOpacity: 0.2,
      weight: 2,
    }).addTo(map);
    circleRef.current = circle;

    const marker = L.marker([safeLat, safeLon], {
      draggable: true,
      icon: PIN_ICON,
      autoPan: true,
    }).addTo(map);
    markerRef.current = marker;

    marker.on("drag", () => {
      const pos = marker.getLatLng();
      circle.setLatLng(pos);
    });

    marker.on("dragend", () => {
      const pos = marker.getLatLng();
      circle.setLatLng(pos);
      onChangeRef.current(pos.lat, pos.lng);
    });

    map.on("click", (ev: L.LeafletMouseEvent) => {
      marker.setLatLng(ev.latlng);
      circle.setLatLng(ev.latlng);
      onChangeRef.current(ev.latlng.lat, ev.latlng.lng);
    });

    mapRef.current = map;

    // Recalculate size after mount transition settles
    const timer = window.setTimeout(() => {
      map.invalidateSize();
    }, 150);

    return () => {
      window.clearTimeout(timer);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
      tileLayerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switch between OpenStreetMap and Satellite tile layers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }

    const nextLayer =
      tileMode === "satellite"
        ? L.tileLayer(ESRI_SAT_TILE_URL, {
            maxZoom: 19,
            attribution: "&copy; Esri World Imagery",
          })
        : L.tileLayer(OSM_TILE_URL, {
            maxZoom: 19,
            attribution: "&copy; OpenStreetMap",
          });

    nextLayer.addTo(map);
    tileLayerRef.current = nextLayer;
  }, [tileMode]);

  // Sync external coordinate updates (e.g. from GPS button)
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    const circle = circleRef.current;
    if (!map || !marker || !circle) return;

    const current = marker.getLatLng();
    const moved =
      Math.abs(current.lat - safeLat) > 0.000001 ||
      Math.abs(current.lng - safeLon) > 0.000001;

    if (moved) {
      const next = L.latLng(safeLat, safeLon);
      marker.setLatLng(next);
      circle.setLatLng(next);
      map.flyTo(next, Math.max(map.getZoom(), 17), { duration: 0.45 });
    }
  }, [safeLat, safeLon]);

  // Sync radius circle size
  useEffect(() => {
    if (circleRef.current) {
      circleRef.current.setRadius(safeRadius);
    }
  }, [safeRadius]);

  const handleRecenter = () => {
    if (!mapRef.current) return;
    mapRef.current.flyTo([safeLat, safeLon], Math.max(mapRef.current.getZoom(), 17), {
      duration: 0.4,
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-full bg-surface-2/80 p-0.5 text-[11px] font-semibold">
          <button
            type="button"
            onClick={() => setTileMode("osm")}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 transition ${
              tileMode === "osm"
                ? "bg-primary text-white shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            <MapIcon className="size-3.5" aria-hidden /> Peta Jalan
          </button>
          <button
            type="button"
            onClick={() => setTileMode("satellite")}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 transition ${
              tileMode === "satellite"
                ? "bg-primary text-white shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            <Globe className="size-3.5" aria-hidden /> Satelit
          </button>
        </div>

        <button
          type="button"
          onClick={handleRecenter}
          className="soft-inset inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold text-primary hover:bg-primary-soft"
        >
          <Crosshair className="size-3.5" aria-hidden /> Pusatkan ke Pin
        </button>
      </div>

      <div
        ref={containerRef}
        className="relative isolate z-0 h-64 w-full overflow-hidden rounded-2xl border border-line/70 sm:h-72"
        aria-label="Peta penentuan titik lokasi presensi"
      />

      <p className="text-[11px] text-muted">
        Geser pin hijau atau tap langsung pada peta untuk menentukan titik acuan. Lingkaran menandakan area radius{" "}
        <strong>{safeRadius}m</strong>.
      </p>
    </div>
  );
}
