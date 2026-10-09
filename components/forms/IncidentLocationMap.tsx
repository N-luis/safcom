'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import {
  Box, Typography, TextField, Button, IconButton, CircularProgress,
  InputAdornment, List, ListItemButton, ListItemText, Alert, Chip,
} from '@mui/material';
import {
  Search, MyLocation, RestartAlt, Place, CheckCircle, Close,
} from '@mui/icons-material';
import {
  BARANGAY_CENTER, DEFAULT_ZOOM, isValidCoordinate, isWithinBarangay, roundCoord,
  type ResolvedLocation,
} from '@/lib/geo';

/**
 * Where the incident happened, picked off a street map.
 *
 * This is not the officers' risk map and shares nothing with it: no zones, no
 * counts, no colours that mean anything. It is a plain street map whose only
 * job is to turn "by the sari-sari store on the corner" into a point and a
 * road name, because a resident describing a place they are frightened of
 * should not also have to work out which entry in a dropdown it falls under.
 */

export interface PickedLocation extends ResolvedLocation {
  /** True once the resident has put a pin down; false while it is empty. */
  chosen: boolean;
}

const ACCENT = '#14b8a6';

/** Built in code so no icon asset has to resolve through the bundler. */
const pinIcon = L.divIcon({
  className: '',
  html: `<div style="
    width:28px;height:28px;border-radius:50% 50% 50% 0;
    background:${ACCENT};border:2.5px solid #fff;
    transform:rotate(-45deg);box-shadow:0 3px 10px rgba(12,30,70,.45);
  "></div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 28],
});

/** Click anywhere to drop or move the pin. */
function ClickCapture({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: e => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

/** Imperative recentre, since MapContainer only reads center on mount. */
function Recenter({ lat, lng, zoom }: { lat: number; lng: number; zoom?: number }) {
  const map = useMap();
  useEffect(() => { map.setView([lat, lng], zoom ?? map.getZoom()); }, [map, lat, lng, zoom]);
  return null;
}

export default function IncidentLocationMap({ value, onChange, disabled }: {
  value: PickedLocation | null;
  onChange: (next: PickedLocation | null) => void;
  disabled?: boolean;
}) {
  const [resolving, setResolving] = useState(false);
  const [notice, setNotice] = useState<string>('');
  const [problem, setProblem] = useState<string>('');

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<(ResolvedLocation & { title: string })[]>([]);

  const [view, setView] = useState({ lat: BARANGAY_CENTER.lat, lng: BARANGAY_CENTER.lng, zoom: DEFAULT_ZOOM });
  const requestId = useRef(0);

  /**
   * The pin moved. The point is kept whatever the provider says - a report
   * must never be blocked because a road has no name in the map data.
   */
  const pick = useCallback(async (lat: number, lng: number) => {
    if (disabled) return;
    const id = ++requestId.current;
    const base: PickedLocation = {
      chosen: true,
      latitude: roundCoord(lat), longitude: roundCoord(lng),
      street: null, barangay: null, municipality: null, province: null, label: null,
    };
    onChange(base);
    setProblem(''); setNotice(''); setResolving(true);

    try {
      const res = await fetch(`/api/resident/geo/reverse?lat=${base.latitude}&lng=${base.longitude}`, {
        credentials: 'include',
      });
      if (id !== requestId.current) return;
      const json = await res.json().catch(() => null);
      const found: ResolvedLocation | null = json?.data?.location ?? null;

      if (found?.street) {
        onChange({ ...found, chosen: true });
        setNotice('Location selected successfully.');
      } else if (found) {
        onChange({ ...found, chosen: true });
        setProblem('We could not find a street name for that spot. Please check the pin, or type the street below.');
      } else {
        setProblem('The address lookup is unavailable right now. Your pin is saved - please type the street below.');
      }
    } catch {
      if (id === requestId.current) {
        setProblem('The address lookup did not respond. Your pin is saved - please type the street below.');
      }
    } finally {
      if (id === requestId.current) setResolving(false);
    }
  }, [disabled, onChange]);

  /**
   * Search runs on a pause in typing, not on every keystroke, which is also
   * what the provider's usage policy asks for.
   *
   * Everything happens inside the timer rather than in the body of the effect:
   * a state change made while the effect runs re-renders on the spot, and the
   * spinner has nothing to say during the pause anyway.
   */
  useEffect(() => {
    const q = query.trim();
    const t = setTimeout(async () => {
      if (q.length < 3) { setResults([]); setSearching(false); return; }
      setSearching(true);
      try {
        const res = await fetch(`/api/resident/geo/search?q=${encodeURIComponent(q)}`, { credentials: 'include' });
        const json = await res.json().catch(() => null);
        setResults(json?.data?.results ?? []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [query]);

  const useMyLocation = () => {
    setProblem(''); setNotice('');
    if (!('geolocation' in navigator)) {
      setProblem('This device cannot share its location. Please pick the spot on the map.');
      return;
    }
    setResolving(true);
    // Only ever on a press: nothing asks for location when the form opens, and
    // the position is not recorded until the resident pins it.
    navigator.geolocation.getCurrentPosition(
      pos => {
        setResolving(false);
        setView({ lat: pos.coords.latitude, lng: pos.coords.longitude, zoom: 18 });
        setNotice('Map moved to where you are. Tap the spot where the incident happened.');
      },
      () => {
        setResolving(false);
        setProblem('Location permission was not given. Please pick the spot on the map instead.');
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const reset = () => {
    requestId.current++;
    onChange(null);
    setNotice(''); setProblem(''); setResolving(false);
    setView({ lat: BARANGAY_CENTER.lat, lng: BARANGAY_CENTER.lng, zoom: DEFAULT_ZOOM });
  };

  const outside = useMemo(
    () => value?.chosen && isValidCoordinate(value.latitude, value.longitude)
      && !isWithinBarangay(value.latitude, value.longitude),
    [value],
  );

  const label = { fontSize: '0.78rem', fontWeight: 700, color: '#64748b' };

  return (
    <Box sx={{ border: '1px solid #e2e8f0', borderRadius: 2, overflow: 'hidden' }}>
      {/* ── Search ── */}
      <Box sx={{ p: { xs: 1.25, sm: 1.5 }, borderBottom: '1px solid #e2e8f0', position: 'relative' }}>
        <TextField
          size="small"
          fullWidth
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search a street or landmark…"
          disabled={disabled}
          slotProps={{
            input: {
              startAdornment: <InputAdornment position="start"><Search sx={{ fontSize: 18, color: '#94a3b8' }} /></InputAdornment>,
              endAdornment: (
                <InputAdornment position="end">
                  {searching
                    ? <CircularProgress size={15} sx={{ color: ACCENT }} />
                    : query && (
                      <IconButton size="small" aria-label="Clear search" onClick={() => setQuery('')}>
                        <Close sx={{ fontSize: 16 }} />
                      </IconButton>
                    )}
                </InputAdornment>
              ),
            },
          }}
          sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
        />
        {results.length > 0 && (
          <List dense sx={{
            position: 'absolute', zIndex: 1200, left: 12, right: 12, mt: 0.5,
            bgcolor: '#fff', border: '1px solid #e2e8f0', borderRadius: 2,
            boxShadow: '0 12px 30px rgba(12,30,70,0.16)', maxHeight: 220, overflowY: 'auto',
          }}>
            {results.map((r, i) => (
              <ListItemButton
                key={`${r.latitude},${r.longitude},${i}`}
                onClick={() => {
                  setResults([]); setQuery('');
                  setView({ lat: r.latitude, lng: r.longitude, zoom: 18 });
                }}
                sx={{ minHeight: 44 }}
              >
                <ListItemText
                  primary={r.street ?? r.title}
                  secondary={r.label ?? undefined}
                  slotProps={{
                    primary: { sx: { fontSize: '0.86rem', fontWeight: 600, color: '#0c1e46' } },
                    secondary: { sx: { fontSize: '0.76rem', color: '#64748b' } },
                  }}
                />
              </ListItemButton>
            ))}
          </List>
        )}
      </Box>

      {/* ── Map ── */}
      <Box sx={{ position: 'relative', height: { xs: 260, sm: 320 } }}>
        <MapContainer
          center={[BARANGAY_CENTER.lat, BARANGAY_CENTER.lng]}
          zoom={DEFAULT_ZOOM}
          scrollWheelZoom
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={19}
          />
          <ClickCapture onPick={pick} />
          <Recenter lat={view.lat} lng={view.lng} zoom={view.zoom} />
          {value?.chosen && (
            <Marker
              position={[value.latitude, value.longitude]}
              icon={pinIcon}
              draggable={!disabled}
              eventHandlers={{
                dragend: e => { const p = e.target.getLatLng(); pick(p.lat, p.lng); },
              }}
            />
          )}
        </MapContainer>

        {resolving && (
          <Box sx={{
            position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
            zIndex: 1000, bgcolor: '#fff', borderRadius: 999, px: 1.5, py: 0.6,
            display: 'flex', alignItems: 'center', gap: 0.75,
            boxShadow: '0 4px 14px rgba(12,30,70,0.2)',
          }}>
            <CircularProgress size={13} sx={{ color: ACCENT }} />
            <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: '#0c1e46' }}>
              Finding the address…
            </Typography>
          </Box>
        )}
      </Box>

      {/* ── Controls ── */}
      <Box sx={{
        p: { xs: 1.25, sm: 1.5 }, display: 'flex', gap: 1, flexWrap: 'wrap',
        borderTop: '1px solid #e2e8f0',
      }}>
        <Button
          onClick={useMyLocation}
          disabled={disabled || resolving}
          startIcon={<MyLocation sx={{ fontSize: 17 }} />}
          variant="outlined"
          sx={{ minHeight: 44, flex: { xs: '1 1 100%', sm: '0 0 auto' }, borderRadius: 2, textTransform: 'none', fontWeight: 600, borderColor: '#cbd5e1', color: '#334155' }}
        >
          Use my location
        </Button>
        <Button
          onClick={reset}
          disabled={disabled || !value?.chosen}
          startIcon={<RestartAlt sx={{ fontSize: 17 }} />}
          variant="outlined"
          sx={{ minHeight: 44, flex: { xs: '1 1 100%', sm: '0 0 auto' }, borderRadius: 2, textTransform: 'none', fontWeight: 600, borderColor: '#cbd5e1', color: '#334155' }}
        >
          Reset location
        </Button>
      </Box>

      {/* ── What was chosen ── */}
      <Box sx={{ px: { xs: 1.25, sm: 1.5 }, pb: { xs: 1.25, sm: 1.5 } }}>
        {!value?.chosen && !problem && (
          <Typography sx={{ fontSize: '0.82rem', color: '#94a3b8' }}>
            No location selected yet.
          </Typography>
        )}

        {notice && value?.chosen && (
          <Alert
            icon={<CheckCircle sx={{ fontSize: 18 }} />}
            severity="success"
            sx={{ py: 0.25, borderRadius: 2, fontSize: '0.82rem' }}
          >
            {notice}
          </Alert>
        )}
        {problem && (
          <Alert severity="warning" sx={{ py: 0.25, borderRadius: 2, fontSize: '0.82rem' }}>
            {problem}
          </Alert>
        )}

        {value?.chosen && (
          <Box sx={{ mt: 1, bgcolor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 2, p: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1 }}>
              <Place sx={{ fontSize: 16, color: ACCENT }} />
              <Typography sx={{ ...label, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Selected incident location
              </Typography>
              {outside && (
                <Chip label="Outside the barangay" size="small"
                  sx={{ ml: 'auto', height: 20, fontSize: '0.68rem', fontWeight: 700, bgcolor: '#fff7ed', color: '#b45309' }} />
              )}
            </Box>
            {([
              ['Street', value.street ?? 'Not identified — type it below'],
              ['Barangay', value.barangay ?? '—'],
              ['Municipality', value.municipality ?? '—'],
              ['Province', value.province ?? '—'],
              ['Latitude', value.latitude.toFixed(6)],
              ['Longitude', value.longitude.toFixed(6)],
            ] as [string, string][]).map(([k, v]) => (
              <Box key={k} sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 0.3 }}>
                <Typography sx={{ ...label, minWidth: 104, fontWeight: 500, color: '#94a3b8' }}>{k}</Typography>
                <Typography sx={{ fontSize: '0.82rem', color: '#0c1e46', fontWeight: 600, wordBreak: 'break-word' }}>
                  {v}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}
