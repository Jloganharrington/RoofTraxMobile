import { Loader2, AlertCircle, MapPin } from 'lucide-react';
import { MapContainer, TileLayer, CircleMarker, useMap } from 'react-leaflet';
import { useEffect } from 'react';
import type { LatLngBoundsExpression } from 'leaflet';
import { useGetCanvassingHeatmapWidget } from '@workspace/api-client-react';

// Color by door-knock result
function markerColor(result: string | null | undefined): string {
  switch (result) {
    case 'appointment':    return '#22c55e'; // green
    case 'no_appointment': return '#f97316'; // orange
    case 'no_answer':      return '#94a3b8'; // slate
    default:               return '#6b7280'; // muted gray
  }
}

// Auto-fit the map to all points once they're loaded
function FitBounds({ bounds }: { bounds: LatLngBoundsExpression }) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 13 });
  }, [map, bounds]);
  return null;
}

export function CanvassingHeatmapWidget() {
  const { data, isLoading, isError } = useGetCanvassingHeatmapWidget();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <AlertCircle className="h-4 w-4 flex-shrink-0" />
        Could not load heatmap data.
      </div>
    );
  }

  const { points, total, capped, windowDays } = data;

  if (points.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
        <MapPin className="h-8 w-8" />
        <p className="text-sm">No canvassing pins in the last {windowDays} days.</p>
      </div>
    );
  }

  // Compute bounds for auto-fit
  const lats = points.map(p => p.lat);
  const lngs = points.map(p => p.lng);
  const bounds: LatLngBoundsExpression = [
    [Math.min(...lats), Math.min(...lngs)],
    [Math.max(...lats), Math.max(...lngs)],
  ];
  // Fallback center (mid-US) if all points identical
  const center: [number, number] = [
    (Math.min(...lats) + Math.max(...lats)) / 2,
    (Math.min(...lngs) + Math.max(...lngs)) / 2,
  ];

  return (
    <div className="space-y-2">
      {/* Map — scroll-wheel zoom disabled so widget doesn't hijack page scroll */}
      <div className="rounded-md overflow-hidden border h-48">
        <MapContainer
          center={center}
          zoom={10}
          scrollWheelZoom={false}
          style={{ height: '100%', width: '100%' }}
          attributionControl={false}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <FitBounds bounds={bounds} />
          {points.map((p, i) => (
            <CircleMarker
              key={i}
              center={[p.lat, p.lng]}
              radius={5}
              pathOptions={{
                fillColor: markerColor(p.doorKnockResult),
                fillOpacity: 0.75,
                color: 'transparent',
                weight: 0,
              }}
            />
          ))}
        </MapContainer>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        <LegendDot color="#22c55e" label="Appointment" />
        <LegendDot color="#f97316" label="No appt" />
        <LegendDot color="#94a3b8" label="No answer" />
      </div>

      {/* Footer */}
      <p className="text-[10px] text-muted-foreground/60">
        {capped ? `Showing ${points.length} of ${total} pins` : `${total} pins`}
        {' · '}last {windowDays} days
      </p>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="inline-block h-2 w-2 rounded-full flex-shrink-0" style={{ background: color }} />
      {label}
    </span>
  );
}
