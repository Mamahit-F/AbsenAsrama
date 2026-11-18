import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { AlertTriangle, Crosshair, Globe, Map as MapIcon, ShieldCheck } from "lucide-react";
import { UNKLAB_BOUNDS, UNKLAB_CENTER, UNKLAB_POLYGON, isInsideUnklabBounds } from "../lib/unklabBounds";

interface GeofenceMapPickerProps {
  latitude: number;
  longitude: number;
  radiusM: number;
  onChange: (lat: number, lon: number) => void;
  onRejectOutside?: (message: string) => void;
}

type TileMode = "osm" | "satellite";

const OSM_TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const ESRI_SAT_TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

const UNKLAB_RING: L.LatLngExpression[] = UNKLAB_POLYGON.map(([lat, lon]) => [lat, lon]);

// Sedikit ruang pandang di sekitar batas kampus agar garis batas & area terlarang terlihat jelas
const PAN_MAX_BOUNDS = L.latLngBounds(
  [UNKLAB_BOUNDS.minLat - 0.0020, UNKLAB_BOUNDS.minLon - 0.0020],
  [UNKLAB_BOUNDS.maxLat + 0.0020, UNKLAB_BOUNDS.maxLon + 0.0020],
);

const OUTSIDE_MASK_POLYGON: L.LatLngExpression[][] = [
  [
    [-85, -180],
    [-85, 180],
    [85, 180],
    [85, -180],
  ],
  UNKLAB_RING,
];

const PIN_ICON = L.divIcon({
  className: "geo-pin-wrapper",
  html: `<div class="geo-pin-dot" title="Geser pin ke lokasi presensi (area UNKLAB)"><span></span></div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

const OUTSIDE_ERR_MSG =
  "Koordinat harus berada di dalam batas area Kampus UNKLAB. Titik di luar batas tidak dapat dipilih.";

export default function GeofenceMapPicker({
  latitude,
  longitude,
  radiusM,
  onChange,
  onRejectOutside,
}: GeofenceMapPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const boundsPolyRef = useRef<L.Polygon | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onRejectRef = useRef(onRejectOutside);
  onRejectRef.current = onRejectOutside;

  const initialLat = isInsideUnklabBounds(latitude, longitude) ? latitude : UNKLAB_CENTER.lat;
  const initialLon = isInsideUnklabBounds(latitude, longitude) ? longitude : UNKLAB_CENTER.lon;
  const lastValidRef = useRef<L.LatLng>(L.latLng(initialLat, initialLon));

  const [tileMode, setTileMode] = useState<TileMode>("osm");
  const [outsideWarning, setOutsideWarning] = useState<string | null>(null);
  const warningTimerRef = useRef<number | null>(null);
  const flashTimerRef = useRef<number | null>(null);

  const safeLat = initialLat;
  const safeLon = initialLon;
  const safeRadius = Number.isFinite(radiusM) && radiusM > 0 ? radiusM : 50;

  useEffect(() => {
    return () => {
      if (warningTimerRef.current !== null) window.clearTimeout(warningTimerRef.current);
      if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    };
  }, []);

  // Initialize Leaflet map once
  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    const triggerOutsideReject = (msg = OUTSIDE_ERR_MSG) => {
      setOutsideWarning(msg);
      if (warningTimerRef.current !== null) window.clearTimeout(warningTimerRef.current);
      warningTimerRef.current = window.setTimeout(() => {
        warningTimerRef.current = null;
        setOutsideWarning(null);
      }, 3600);

      if (boundsPolyRef.current) {
        boundsPolyRef.current.setStyle({ color: "#e11d48", weight: 3 });
        if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
        flashTimerRef.current = window.setTimeout(() => {
          flashTimerRef.current = null;
          boundsPolyRef.current?.setStyle({ color: "#0E8F7E", weight: 2.5 });
        }, 700);
      }

      onRejectRef.current?.(msg);
    };

    const map = L.map(el, {
      center: [safeLat, safeLon],
      zoom: 17,
      minZoom: 16,
      maxZoom: 19,
      maxBounds: PAN_MAX_BOUNDS,
      maxBoundsViscosity: 0.92,
      zoomControl: true,
      attributionControl: true,
    });

    const layer = L.tileLayer(OSM_TILE_URL, {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(map);
    tileLayerRef.current = layer;

    // Mask gelap untuk area di luar batas kampus UNKLAB
    L.polygon(OUTSIDE_MASK_POLYGON, {
      color: "transparent",
      fillColor: "#0f172a",
      fillOpacity: 0.36,
      interactive: false,
    }).addTo(map);

    // Garis batas presisi area kampus UNKLAB yang diperbolehkan
    const boundsPoly = L.polygon(UNKLAB_RING, {
      color: "#0E8F7E",
      weight: 2.5,
      dashArray: "7 6",
      fill: false,
      interactive: false,
    }).addTo(map);
    boundsPolyRef.current = boundsPoly;

    const circle = L.circle([safeLat, safeLon], {
      radius: safeRadius,
      color: "#0E8F7E",
      fillColor: "#3CC4AE",
      fillOpacity: 0.22,
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
      if (isInsideUnklabBounds(pos.lat, pos.lng)) {
        circle.setLatLng(pos);
      } else {
        circle.setLatLng(lastValidRef.current);
      }
    });

    marker.on("dragend", () => {
      const pos = marker.getLatLng();
      if (!isInsideUnklabBounds(pos.lat, pos.lng)) {
        const valid = lastValidRef.current;
        marker.setLatLng(valid);
        circle.setLatLng(valid);
        triggerOutsideReject();
        return;
      }
      lastValidRef.current = pos;
      circle.setLatLng(pos);
      setOutsideWarning(null);
      onChangeRef.current(pos.lat, pos.lng);
    });

    map.on("click", (ev: L.LeafletMouseEvent) => {
      if (!isInsideUnklabBounds(ev.latlng.lat, ev.latlng.lng)) {
        triggerOutsideReject();
        return;
      }
      lastValidRef.current = ev.latlng;
      marker.setLatLng(ev.latlng);
      circle.setLatLng(ev.latlng);
      setOutsideWarning(null);
      onChangeRef.current(ev.latlng.lat, ev.latlng.lng);
    });

    mapRef.current = map;

    const timer = window.setTimeout(() => {
      map.invalidateSize();
    }, 150);

    return () => {
      window.clearTimeout(timer);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
      boundsPolyRef.current = null;
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

    if (!isInsideUnklabBounds(latitude, longitude)) return;

    const current = marker.getLatLng();
    const moved =
      Math.abs(current.lat - latitude) > 0.000001 ||
      Math.abs(current.lng - longitude) > 0.000001;

    if (moved) {
      const next = L.latLng(latitude, longitude);
      lastValidRef.current = next;
      marker.setLatLng(next);
      circle.setLatLng(next);
      map.flyTo(next, Math.max(map.getZoom(), 17), { duration: 0.45 });
    }
  }, [latitude, longitude]);

  // Sync radius circle size
  useEffect(() => {
    if (circleRef.current) {
      circleRef.current.setRadius(safeRadius);
    }
  }, [safeRadius]);

  const handleRecenter = () => {
    if (!mapRef.current) return;
    const valid = lastValidRef.current;
    mapRef.current.flyTo([valid.lat, valid.lng], Math.max(mapRef.current.getZoom(), 17), {
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
        aria-label="Peta penentuan titik lokasi presensi khusus area UNKLAB"
      />

      {outsideWarning && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-[11.5px] font-semibold text-danger"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{outsideWarning}</span>
        </div>
      )}

      <div className="flex items-start gap-1.5 text-[11px] text-muted">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
        <span>
          Area yang diperbolehkan dibatasi garis putus-putus hijau (<strong>Kampus UNKLAB</strong>). Geser pin
          atau tap di dalam area tersebut untuk mengatur titik radius <strong>{safeRadius}m</strong>.
        </span>
      </div>
    </div>
  );
}
