import { DEFAULT_MAP_VIEW } from '../types';
import type { MapView } from '../types';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const ensureMapView = (view?: MapView | null): MapView => {
  if (!view) return { ...DEFAULT_MAP_VIEW, center: { ...DEFAULT_MAP_VIEW.center } };
  return {
    center: {
      x: view.center?.x ?? DEFAULT_MAP_VIEW.center.x,
      y: view.center?.y ?? DEFAULT_MAP_VIEW.center.y,
    },
    zoom: view.zoom ?? DEFAULT_MAP_VIEW.zoom,
    rotation: view.rotation ?? DEFAULT_MAP_VIEW.rotation,
  };
};

export const normalizeMapView = (view: MapView): MapView => {
  const zoom = clamp(view.zoom || DEFAULT_MAP_VIEW.zoom, 0.2, 8);
  const half = 0.5 / zoom;
  const rotation = ((view.rotation ?? 0) % 360 + 360) % 360;
  return {
    center: {
      x: clamp(view.center.x ?? DEFAULT_MAP_VIEW.center.x, half, 1 - half),
      y: clamp(view.center.y ?? DEFAULT_MAP_VIEW.center.y, half, 1 - half),
    },
    zoom,
    rotation,
  };
};
