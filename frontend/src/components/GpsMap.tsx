type GpsMapProps = {
  latitude?: string | number | null;
  longitude?: string | number | null;
  label?: string;
  className?: string;
  empty?: boolean;
  compact?: boolean;
};

export function GpsMap({ latitude, longitude, label = "Captured location", className = "", empty = false, compact = false }: GpsMapProps) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  const valid = Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && latitude !== "" && longitude !== "" && latitude != null && longitude != null;

  if (!valid) {
    if (!empty) return null;
    return <div className={`rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-4 py-5 text-center ${className}`}><div className="mx-auto grid h-9 w-9 place-items-center rounded-full bg-emerald-50 text-lg text-emerald-700">⌖</div><p className="mt-2 text-sm font-semibold text-slate-700">No GPS point captured</p><p className="mt-1 text-xs text-slate-500">Enter or capture both coordinates to preview the location.</p></div>;
  }

  const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.008}%2C${lat - 0.006}%2C${lng + 0.008}%2C${lat + 0.006}&layer=mapnik&marker=${lat}%2C${lng}`;
  return <div className={`overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-sm ${className}`}><iframe title={`${label} map`} src={mapUrl} className={`${compact ? "h-24" : "h-44"} w-full border-0`} loading="lazy" /><div className={`flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white ${compact ? "px-2.5 py-1.5" : "px-3 py-2.5"}`}><div><div className="text-xs font-semibold text-slate-700">{label}</div><div className="font-mono text-[11px] text-slate-500">{lat.toFixed(6)}, {lng.toFixed(6)}</div></div><a href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`} target="_blank" rel="noreferrer" className="text-xs font-bold text-emerald-700 transition hover:text-emerald-900">Open map</a></div></div>;
}
