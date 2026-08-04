/**
 * MapPage — Live territory map for managers and admins.
 *
 * Shows all company pins (colour-coded by workflow) and clocked-in/out rep
 * location dots. Auto-refreshes rep positions every 30 seconds.
 */
import { useMemo, useState, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Marker,
  Popup,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';
import { formatDistanceToNow } from 'date-fns';
import {
  useListPins,
  useListTeamLocations,
  useGetMyProfile,
  getListPinsQueryKey,
  getListTeamLocationsQueryKey,
} from '@workspace/api-client-react';
import { Shell } from '@/components/layout/Shell';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, AlertCircle } from 'lucide-react';
import type { Pin, TeamLocation } from '@workspace/api-client-react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CENTER: [number, number] = [39.5, -98.35]; // geographic centre of the US
const DEFAULT_ZOOM = 5;
const REFRESH_INTERVAL_MS = 30_000;

const WORKFLOW_COLORS: Record<string, string> = {
  insurance: '#3b82f6', // blue-500
  retail: '#22c55e',    // green-500
};

const CLOCKEDIN_COLOR = '#f97316';  // orange-500
const CLOCKEDOUT_COLOR = '#9ca3af'; // gray-400

// ---------------------------------------------------------------------------
// Map auto-fit helper
// ---------------------------------------------------------------------------

function AutoFit({
  pins,
  locations,
}: {
  pins: Pin[];
  locations: TeamLocation[];
}) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (fitted.current) return;
    const points: [number, number][] = [
      ...pins.map((p) => [p.latitude, p.longitude] as [number, number]),
      ...locations.map((l) => [l.latitude, l.longitude] as [number, number]),
    ];
    if (points.length === 0) return;
    try {
      map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 14 });
      fitted.current = true;
    } catch {
      // bounds may be invalid if all points are identical
    }
  }, [map, pins, locations]);

  return null;
}

// ---------------------------------------------------------------------------
// Rep DivIcon builder
// ---------------------------------------------------------------------------

function buildRepIcon(isClockedIn: boolean): L.DivIcon {
  const color = isClockedIn ? CLOCKEDIN_COLOR : CLOCKEDOUT_COLOR;
  const inner = isClockedIn
    ? `<div style="
        width:14px;height:14px;border-radius:50%;
        background:${color};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35);
        margin:3px;
      "></div>`
    : `<div style="
        width:14px;height:14px;border-radius:50%;
        border:2.5px solid ${color};background:rgba(255,255,255,.3);box-shadow:0 1px 3px rgba(0,0,0,.2);
        margin:3px;
      "></div>`;

  return L.divIcon({
    html: `<div style="width:20px;height:20px;display:flex;align-items:center;justify-content:center;">${inner}</div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    className: '',
  });
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function MapPage() {
  const [, navigate] = useLocation();
  const [selectedRepId, setSelectedRepId] = useState<string>('all');

  // --- Auth / role guard ---------------------------------------------------
  const { data: profileEnv, isLoading: profileLoading } = useGetMyProfile();
  const role = profileEnv?.profile?.role;
  const isAuthorised = role === 'manager' || role === 'admin' || role === 'super_admin';

  // --- Data queries --------------------------------------------------------
  const { data: pinsEnv, isLoading: pinsLoading } = useListPins(undefined, {
    query: { enabled: isAuthorised, queryKey: getListPinsQueryKey() },
  });

  const { data: locEnv, isLoading: locLoading } = useListTeamLocations({
    query: {
      enabled: isAuthorised,
      refetchInterval: REFRESH_INTERVAL_MS,
      queryKey: getListTeamLocationsQueryKey(),
    },
  });

  const pins: Pin[] = pinsEnv?.pins ?? [];
  const locations: TeamLocation[] = locEnv?.locations ?? [];

  // --- Rep list for filter dropdown ----------------------------------------
  const repOptions = useMemo<{ userId: string; name: string }[]>(() => {
    const byId = new Map<string, string>();
    // Collect from locations (has firstName/lastName)
    for (const loc of locations) {
      const name = [loc.firstName, loc.lastName].filter(Boolean).join(' ') || loc.userId;
      byId.set(loc.userId, name);
    }
    // Fill any gaps from pins — they only have userId, so use existing name if we have it
    for (const pin of pins) {
      if (!byId.has(pin.userId)) {
        byId.set(pin.userId, pin.userId);
      }
    }
    return Array.from(byId.entries())
      .map(([userId, name]) => ({ userId, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [pins, locations]);

  // --- Filtered pins -------------------------------------------------------
  const visiblePins = useMemo(
    () =>
      selectedRepId === 'all'
        ? pins
        : pins.filter((p) => p.userId === selectedRepId),
    [pins, selectedRepId],
  );

  // --- Loading / access guard renders --------------------------------------
  const isLoading = profileLoading || pinsLoading || locLoading;

  if (profileLoading) {
    return (
      <Shell>
        <div className="flex items-center justify-center min-h-[70vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </Shell>
    );
  }

  if (!isAuthorised) {
    return (
      <Shell>
        <div className="flex flex-col items-center justify-center min-h-[70vh] gap-3 text-center px-4">
          <AlertCircle className="h-10 w-10 text-destructive" />
          <h1 className="text-xl font-semibold">Access Restricted</h1>
          <p className="text-muted-foreground text-sm max-w-sm">
            The territory map is only available to managers and admins.
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      {/* ------------------------------------------------------------------ */}
      {/* Header toolbar                                                       */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex items-center justify-between gap-4 px-4 py-3 border-b bg-background/80 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">Territory Map</h1>
          {isLoading && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>

        {/* Legend */}
        <div className="hidden sm:flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ background: WORKFLOW_COLORS.insurance }}
            />
            Insurance
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ background: WORKFLOW_COLORS.retail }}
            />
            Retail
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ background: CLOCKEDIN_COLOR }}
            />
            Rep (clocked in)
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 rounded-full border-2"
              style={{ borderColor: CLOCKEDOUT_COLOR }}
            />
            Rep (clocked out)
          </span>
        </div>

        {/* Rep filter */}
        <div className="w-48 shrink-0">
          <Select value={selectedRepId} onValueChange={setSelectedRepId}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="All reps" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All reps</SelectItem>
              {repOptions.map((rep) => (
                <SelectItem key={rep.userId} value={rep.userId}>
                  {rep.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Map                                                                  */}
      {/* ------------------------------------------------------------------ */}
      <div className="relative" style={{ height: 'calc(100vh - 120px)' }}>
        <MapContainer
          center={DEFAULT_CENTER}
          zoom={DEFAULT_ZOOM}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {/* Auto-fit to data on first load */}
          {!isLoading && (pins.length > 0 || locations.length > 0) && (
            <AutoFit pins={pins} locations={locations} />
          )}

          {/* ------- Pin markers ------------------------------------------ */}
          {visiblePins.map((pin) => {
            const color = WORKFLOW_COLORS[pin.workflow] ?? '#6366f1';
            const workflowLabel =
              pin.workflow === 'insurance' ? 'Insurance' : 'Retail';
            const damageLabel =
              pin.damageType
                ?.replace(/_/g, ' ')
                .replace(/\b\w/g, (c) => c.toUpperCase()) ?? null;
            const knockLabel =
              pin.doorKnockResult
                ?.replace(/_/g, ' ')
                .replace(/\b\w/g, (c) => c.toUpperCase()) ?? null;

            return (
              <CircleMarker
                key={pin.id}
                center={[pin.latitude, pin.longitude]}
                radius={7}
                pathOptions={{
                  fillColor: color,
                  color: '#fff',
                  weight: 1.5,
                  fillOpacity: 0.85,
                }}
              >
                <Popup>
                  <div className="text-sm space-y-1 min-w-[180px]">
                    {pin.address && (
                      <p className="font-semibold leading-snug">{pin.address}</p>
                    )}
                    <p>
                      <span className="font-medium">Workflow:</span>{' '}
                      <span
                        className="inline-block px-1.5 py-0.5 rounded text-white text-xs"
                        style={{ background: color }}
                      >
                        {workflowLabel}
                      </span>
                    </p>
                    {damageLabel && (
                      <p>
                        <span className="font-medium">Damage:</span> {damageLabel}
                      </p>
                    )}
                    {knockLabel && (
                      <p>
                        <span className="font-medium">Door knock:</span>{' '}
                        {knockLabel}
                      </p>
                    )}
                    <p className="pt-1">
                      <a
                        href={`/rooftrax-web/leads/${pin.id}`}
                        className="text-blue-600 hover:underline text-xs font-medium"
                        onClick={(e) => {
                          e.preventDefault();
                          navigate(`/leads/${pin.id}`);
                        }}
                      >
                        Open lead →
                      </a>
                    </p>
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}

          {/* ------- Rep location markers ---------------------------------- */}
          {locations.map((loc) => {
            const name =
              [loc.firstName, loc.lastName].filter(Boolean).join(' ') ||
              'Unknown rep';
            const timeAgo = formatDistanceToNow(new Date(loc.updatedAt), {
              addSuffix: true,
            });

            return (
              <Marker
                key={loc.userId}
                position={[loc.latitude, loc.longitude]}
                icon={buildRepIcon(loc.isClockedIn)}
              >
                <Popup>
                  <div className="text-sm space-y-1 min-w-[150px]">
                    <p className="font-semibold">{name}</p>
                    <p>
                      <span
                        className="inline-block px-1.5 py-0.5 rounded text-xs text-white"
                        style={{
                          background: loc.isClockedIn
                            ? CLOCKEDIN_COLOR
                            : CLOCKEDOUT_COLOR,
                        }}
                      >
                        {loc.isClockedIn ? 'Clocked in' : 'Clocked out'}
                      </span>
                    </p>
                    <p className="text-muted-foreground text-xs">
                      Updated {timeAgo}
                    </p>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>
    </Shell>
  );
}
