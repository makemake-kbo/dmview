import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MapView, Token, WarpConfig, WarpPoint } from '../types';
import { DEFAULT_MAP_VIEW, DEFAULT_WARP } from '../types';
import { ensureWarp } from '../lib/homography';
import { ensureMapView, normalizeMapView } from '../lib/mapView';

export type WorkspaceMode = 'view' | 'edit' | 'client';

interface MapWorkspaceProps {
  mapUrl?: string | null;
  warp?: WarpConfig | null;
  view?: MapView | null;
  tokens: Token[];
  mode: WorkspaceMode;
  onModeChange(mode: WorkspaceMode): void;
  onOpenMapModal(): void;
  onWarpCommit(corners: WarpPoint[]): void;
  onViewCommit(view: MapView): void;
  onTokenMove(tokenId: string, position: WarpPoint): void;
  onResetWarp(): void;
  onResetView(): void;
  selectedTokenId?: string | null;
  showViewOverlay: boolean;
  onToggleViewOverlay(next: boolean): void;
}

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const distanceSquared = (a: WarpPoint, b: WarpPoint) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};
const rotatePoint = (point: WarpPoint, angleDeg: number): WarpPoint => {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
};
const viewSpaceToStage = (point: WarpPoint, view: MapView): WarpPoint => {
  const size = 1 / (view.zoom || 1);
  const offset = {
    x: (point.x - 0.5) * size,
    y: (point.y - 0.5) * size,
  };
  const rotated = rotatePoint(offset, view.rotation || 0);
  return {
    x: 0.5 + rotated.x,
    y: 0.5 + rotated.y,
  };
};
const stageToViewSpace = (point: WarpPoint, view: MapView): WarpPoint => {
  const size = 1 / (view.zoom || 1);
  const offset = {
    x: point.x - 0.5,
    y: point.y - 0.5,
  };
  const unrotated = rotatePoint(offset, -(view.rotation || 0));
  return {
    x: clamp(unrotated.x / size + 0.5),
    y: clamp(unrotated.y / size + 0.5),
  };
};
const distanceToSegmentSquared = (p: WarpPoint, a: WarpPoint, b: WarpPoint) => {
  const lengthSquared = distanceSquared(a, b);
  if (lengthSquared === 0) return distanceSquared(p, a);
  const t = clamp(
    ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / lengthSquared,
    0,
    1,
  );
  return distanceSquared(
    p,
    {
      x: a.x + t * (b.x - a.x),
      y: a.y + t * (b.y - a.y),
    },
  );
};
const strokeTouchesPoint = (points: WarpPoint[], point: WarpPoint, radiusSquared: number) => {
  if (points.length === 0) return false;
  if (points.length === 1) return distanceSquared(points[0], point) <= radiusSquared;
  for (let index = 1; index < points.length; index += 1) {
    if (distanceToSegmentSquared(point, points[index - 1], points[index]) <= radiusSquared) {
      return true;
    }
  }
  return false;
};
const splitStrokePoints = (points: WarpPoint[], point: WarpPoint, radiusSquared: number) => {
  if (points.length <= 1) {
    const touched = distanceSquared(points[0] ?? point, point) <= radiusSquared;
    return { segments: touched ? [] : [points], touched };
  }
  const segments: WarpPoint[][] = [];
  let current: WarpPoint[] = [points[0]];
  let touched = false;
  for (let index = 1; index < points.length; index += 1) {
    const next = points[index];
    const hit = distanceToSegmentSquared(point, points[index - 1], next) <= radiusSquared;
    if (hit) {
      touched = true;
      if (current.length > 1) {
        segments.push(current);
      }
      current = [next];
    } else {
      current.push(next);
    }
  }
  if (current.length > 1) {
    segments.push(current);
  }
  return { segments, touched };
};
const generateStrokeId = () => `stroke-${Math.random().toString(16).slice(2)}-${Date.now()}`;
const DEFAULT_STROKE_WIDTH = 0.006;
const DRAW_SAMPLE_EPSILON = 0.0015;
const ERASER_RADIUS = 0.02;
const STROKE_ERASER_RADIUS = 0.03;

const WorkspaceHints: Record<WorkspaceMode, string> = {
  view: 'Pan and zoom locally to inspect the map. This is DM-only and does not affect the projector.',
  edit: 'Use the tools to annotate the map, show a grid, and drag tokens into position.',
  client: 'Shape the player projection, toggle the overlay, and adjust warp handles as needed.',
};

const modeLabel: Record<WorkspaceMode, string> = {
  view: 'View mode',
  edit: 'Map edit mode',
  client: 'Client view mode',
};

const TokenIcons: Record<Token['kind'], string> = {
  pc: '🛡️',
  enemy: '⚔️',
  npc: '👤',
  prop: '📍',
};
const TokenOutlineColors: Record<Token['kind'], string> = {
  pc: '#38bdf8',
  enemy: '#ef4444',
  npc: '#22c55e',
  prop: '#cbd5e1',
};

const editTools: Array<{ id: 'pencil' | 'eraser' | 'stroke-eraser'; label: string; icon: string }> = [
  { id: 'pencil', label: 'Pencil', icon: '✏️' },
  { id: 'eraser', label: 'Eraser', icon: '🧽' },
  { id: 'stroke-eraser', label: 'Stroke eraser', icon: '🖌️' },
];

const DEFAULT_GRID = { enabled: false, width: 50, height: 50 };

const MapWorkspace = ({
  mapUrl,
  warp,
  view,
  tokens,
  mode,
  onModeChange,
  onWarpCommit,
  onOpenMapModal,
  onViewCommit,
  onTokenMove,
  onResetWarp,
  onResetView,
  selectedTokenId,
  showViewOverlay,
  onToggleViewOverlay,
}: MapWorkspaceProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [draftCorners, setDraftCorners] = useState<WarpPoint[]>(ensureWarp(warp).corners);
  const [draggingHandle, setDraggingHandle] = useState<number | null>(null);
  const [draggingToken, setDraggingToken] = useState<string | null>(null);
  const [tokenDrafts, setTokenDrafts] = useState<Record<string, WarpPoint>>({});
  const [viewDraft, setViewDraft] = useState<MapView>(ensureMapView(view ?? DEFAULT_MAP_VIEW));
  const [draggingView, setDraggingView] = useState(false);
  const [localView, setLocalView] = useState<{ zoom: number; offsetX: number; offsetY: number }>({
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
  });
  const [panningLocalView, setPanningLocalView] = useState(false);
  const localPanRef = useRef<{ x: number; y: number } | null>(null);
  const [editTool, setEditTool] = useState<'pencil' | 'eraser' | 'stroke-eraser'>('pencil');
  const [pencilColor, setPencilColor] = useState('#f59e0b');
  const [gridPopoverOpen, setGridPopoverOpen] = useState(false);
  const [gridConfig, setGridConfig] = useState(DEFAULT_GRID);
  const [warpToolOpen, setWarpToolOpen] = useState(false);
  const [warpHandlesEnabled, setWarpHandlesEnabled] = useState(false);
  const [drawPopoverOpen, setDrawPopoverOpen] = useState(false);
  const [zoomPopoverOpen, setZoomPopoverOpen] = useState(false);
  const [rotationPopoverOpen, setRotationPopoverOpen] = useState(false);
  const [overlayPopoverOpen, setOverlayPopoverOpen] = useState(false);
  const [strokes, setStrokes] = useState<Array<{ id: string; color: string; width: number; points: WarpPoint[] }>>(
    [],
  );
  const [drawingStrokeId, setDrawingStrokeId] = useState<string | null>(null);
  const [isErasing, setIsErasing] = useState(false);
  const eraserModeRef = useRef<'soft' | 'stroke'>('soft');
  const lastDrawnPointRef = useRef<WarpPoint | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const viewCommitTimerRef = useRef<number | null>(null);
  const [aspectRatio, setAspectRatio] = useState(1);

  useEffect(() => {
    setDraftCorners(ensureWarp(warp).corners.map((corner) => ({ ...corner })));
  }, [warp?.corners]);

  useEffect(() => {
    setViewDraft(ensureMapView(view));
  }, [view?.center?.x, view?.center?.y, view?.zoom, view?.rotation]);

  useEffect(() => {
    setTokenDrafts({});
  }, [tokens.map((token) => token.id).join(':')]);

  useEffect(() => {
    if (!mapUrl) {
      setAspectRatio(1);
      return;
    }
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      if (image.naturalWidth && image.naturalHeight) {
        setAspectRatio(image.naturalWidth / image.naturalHeight);
      }
    };
    image.src = mapUrl;
    return () => {
      image.onload = null;
    };
  }, [mapUrl]);

  useEffect(() => {
    setGridPopoverOpen(false);
    setWarpToolOpen(false);
    setDrawPopoverOpen(false);
    setZoomPopoverOpen(false);
    setRotationPopoverOpen(false);
    setOverlayPopoverOpen(false);
    setPanningLocalView(false);
    localPanRef.current = null;
    setDrawingStrokeId(null);
    setIsErasing(false);
    lastDrawnPointRef.current = null;
    if (mode === 'client') {
      setWarpHandlesEnabled(true);
    }
  }, [mode]);

  const getNormalizedPoint = useCallback(
    (clientX: number, clientY: number): WarpPoint | null => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return null;
      return {
        x: clamp((clientX - rect.left) / rect.width),
        y: clamp((clientY - rect.top) / rect.height),
      };
    },
    [],
  );

  const appendPointToStroke = useCallback((strokeId: string, point: WarpPoint) => {
    setStrokes((prev) =>
      prev.map((stroke) => {
        if (stroke.id !== strokeId) return stroke;
        const lastPoint = stroke.points[stroke.points.length - 1];
        if (lastPoint && distanceSquared(lastPoint, point) < DRAW_SAMPLE_EPSILON * DRAW_SAMPLE_EPSILON) {
          return stroke;
        }
        return { ...stroke, points: [...stroke.points, point] };
      }),
    );
    lastDrawnPointRef.current = point;
  }, []);

  const startStroke = useCallback(
    (point: WarpPoint) => {
      const strokeId = generateStrokeId();
      setStrokes((prev) => [
        ...prev,
        {
          id: strokeId,
          color: pencilColor,
          width: DEFAULT_STROKE_WIDTH,
          points: [point],
        },
      ]);
      setDrawingStrokeId(strokeId);
      lastDrawnPointRef.current = point;
    },
    [pencilColor],
  );

  const eraseAtPoint = useCallback((point: WarpPoint) => {
    const mode = eraserModeRef.current;
    const radius = mode === 'stroke' ? STROKE_ERASER_RADIUS : ERASER_RADIUS;
    const radiusSquared = radius * radius;
    setStrokes((prev) =>
      mode === 'stroke'
        ? prev.filter((stroke) => !strokeTouchesPoint(stroke.points, point, radiusSquared))
        : prev.flatMap((stroke) => {
            const { segments, touched } = splitStrokePoints(stroke.points, point, radiusSquared);
            if (!touched) return [stroke];
            if (segments.length === 0) return [];
            return segments.map((points, index) => ({
              ...stroke,
              id: `${stroke.id}-${index}-${generateStrokeId()}`,
              points,
            }));
          }),
    );
  }, []);

  const pushViewUpdate = useCallback(
    (next: MapView, debounceMs = 0) => {
      const normalized = normalizeMapView(next);
      setViewDraft(normalized);
      if (viewCommitTimerRef.current) {
        window.clearTimeout(viewCommitTimerRef.current);
        viewCommitTimerRef.current = null;
      }
      if (debounceMs > 0) {
        viewCommitTimerRef.current = window.setTimeout(() => {
          onViewCommit(normalized);
          viewCommitTimerRef.current = null;
        }, debounceMs);
      } else {
        onViewCommit(normalized);
      }
    },
    [onViewCommit],
  );

  const currentView = useMemo(() => normalizeMapView(viewDraft ?? DEFAULT_MAP_VIEW), [viewDraft]);

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      if (
        draggingHandle === null &&
        !draggingToken &&
        !draggingView &&
        !panningLocalView &&
        !drawingStrokeId &&
        !isErasing
      ) {
        return;
      }
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = clamp((event.clientX - rect.left) / rect.width);
      const y = clamp((event.clientY - rect.top) / rect.height);

      if (draggingView) {
        if (!lastPointerRef.current) {
          lastPointerRef.current = { x: event.clientX, y: event.clientY };
          return;
        }
        const deltaX = (event.clientX - lastPointerRef.current.x) / rect.width;
        const deltaY = (event.clientY - lastPointerRef.current.y) / rect.height;
        lastPointerRef.current = { x: event.clientX, y: event.clientY };
        setViewDraft((prev) =>
          normalizeMapView({
            ...prev,
            center: {
              x: prev.center.x + deltaX,
              y: prev.center.y + deltaY,
            },
          }),
        );
      }

      if (panningLocalView) {
        if (!localPanRef.current) {
          localPanRef.current = { x: event.clientX, y: event.clientY };
          return;
        }
        const deltaX = event.clientX - localPanRef.current.x;
        const deltaY = event.clientY - localPanRef.current.y;
        localPanRef.current = { x: event.clientX, y: event.clientY };
        setLocalView((prev) => ({
          ...prev,
          offsetX: prev.offsetX + deltaX,
          offsetY: prev.offsetY + deltaY,
        }));
      }

      if (drawingStrokeId && mode === 'edit') {
        appendPointToStroke(drawingStrokeId, { x, y });
      }

      if (isErasing && mode === 'edit') {
        eraseAtPoint({ x, y });
      }

      if (draggingHandle !== null) {
        setDraftCorners((prev) => {
          const next = prev.map((corner) => ({ ...corner }));
          next[draggingHandle] = stageToViewSpace({ x, y }, currentView);
          return next;
        });
      }

      if (draggingToken) {
        setTokenDrafts((prev) => ({
          ...prev,
          [draggingToken]: { x, y },
        }));
      }
    };

    const handleUp = () => {
      if (draggingHandle !== null) {
        setDraggingHandle(null);
        onWarpCommit([...draftCorners]);
      }
      if (draggingToken) {
        const coords = tokenDrafts[draggingToken];
        if (coords) {
          onTokenMove(draggingToken, coords);
        }
        setDraggingToken(null);
      }
      if (draggingView) {
        pushViewUpdate(viewDraft);
        setDraggingView(false);
        lastPointerRef.current = null;
      }
      if (drawingStrokeId) {
        setDrawingStrokeId(null);
        lastDrawnPointRef.current = null;
      }
      if (isErasing) {
        setIsErasing(false);
      }
      if (panningLocalView) {
        setPanningLocalView(false);
        localPanRef.current = null;
      }
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);

    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [
    draggingHandle,
    draggingToken,
    draggingView,
    panningLocalView,
    draftCorners,
    onTokenMove,
    onWarpCommit,
    tokenDrafts,
    viewDraft,
    drawingStrokeId,
    appendPointToStroke,
    mode,
    isErasing,
    eraseAtPoint,
    pushViewUpdate,
    currentView,
  ]);

  useEffect(() => {
    return () => {
      if (viewCommitTimerRef.current) {
        window.clearTimeout(viewCommitTimerRef.current);
      }
    };
  }, []);

  const handleWarpPointerDown = (index: number, event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDraggingHandle(index);
  };

  const handleTokenPointerDown = (token: Token, event: React.PointerEvent<HTMLDivElement>) => {
    if (mode !== 'edit') return;
    event.preventDefault();
    event.stopPropagation();
    setDraggingToken(token.id);
    setTokenDrafts((prev) => ({
      ...prev,
      [token.id]: { x: token.x, y: token.y },
    }));
  };

  const handleStagePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (mode === 'edit') {
      const point = getNormalizedPoint(event.clientX, event.clientY);
      if (!point) return;
      if (editTool === 'pencil') {
        event.preventDefault();
        startStroke(point);
        return;
      }
      if (editTool === 'eraser' || editTool === 'stroke-eraser') {
        event.preventDefault();
        eraserModeRef.current = editTool === 'stroke-eraser' ? 'stroke' : 'soft';
        setIsErasing(true);
        eraseAtPoint(point);
        return;
      }
    }

    if (mode === 'view') {
      event.preventDefault();
      setPanningLocalView(true);
      localPanRef.current = { x: event.clientX, y: event.clientY };
      return;
    }

    if (mode === 'client') {
      const target = event.target as HTMLElement;
      if (target.closest('.projector-frame') || target.closest('.warp-handle')) return;
      event.preventDefault();
      setDraggingView(true);
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
    }
  };

  const handleViewPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (mode !== 'client') return;
    event.preventDefault();
    event.stopPropagation();
    setDraggingView(true);
    lastPointerRef.current = { x: event.clientX, y: event.clientY };
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (mode === 'view') {
      if (event.cancelable) {
        event.preventDefault();
      }
      const delta = event.deltaY;
      const scale = 1 + Math.sign(delta) * -1 * Math.min(Math.abs(delta) * 0.001, 0.12);
      const nextZoom = clamp(localView.zoom * scale, 0.5, 3);
      setLocalView((prev) => ({
        ...prev,
        zoom: nextZoom,
      }));
      return;
    }
    if (mode !== 'client') return;
    if (event.cancelable) {
      event.preventDefault();
    }
    const delta = event.deltaY;
    const scale = 1 + Math.sign(delta) * -1 * Math.min(Math.abs(delta) * 0.001, 0.12);
    pushViewUpdate(
      {
        ...viewDraft,
        zoom: viewDraft.zoom * scale,
      },
      120,
    );
  };

  const handleRotationChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    pushViewUpdate(
      {
        ...viewDraft,
        rotation: Number(event.target.value),
      },
      80,
    );
  };

  const handleZoomChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    pushViewUpdate(
      {
        ...viewDraft,
        zoom: Number(event.target.value),
      },
      80,
    );
  };

  const handleGridSizeChange = (dimension: 'width' | 'height') => (event: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = Number(event.target.value);
    const safeValue = Number.isNaN(parsed) ? 0 : parsed;
    setGridConfig((prev) => ({
      ...prev,
      [dimension]: clamp(safeValue, 8, 400),
    }));
  };

  const handleGridToggle = (enabled: boolean) => {
    setGridConfig((prev) => ({
      ...prev,
      enabled,
    }));
  };

  const toggleWarpTool = () => {
    setWarpToolOpen((prev) => !prev);
    setZoomPopoverOpen(false);
    setRotationPopoverOpen(false);
    setOverlayPopoverOpen(false);
  };

  const toggleDrawPopover = () => {
    setDrawPopoverOpen((prev) => !prev);
    setGridPopoverOpen(false);
  };

  const toggleGridPopover = () => {
    setGridPopoverOpen((prev) => !prev);
    setDrawPopoverOpen(false);
  };

  const toggleZoomPopover = () => {
    setZoomPopoverOpen((prev) => !prev);
    setRotationPopoverOpen(false);
    setOverlayPopoverOpen(false);
    setWarpToolOpen(false);
  };

  const toggleRotationPopover = () => {
    setRotationPopoverOpen((prev) => !prev);
    setZoomPopoverOpen(false);
    setOverlayPopoverOpen(false);
    setWarpToolOpen(false);
  };

  const toggleOverlayPopover = () => {
    setOverlayPopoverOpen((prev) => !prev);
    setZoomPopoverOpen(false);
    setRotationPopoverOpen(false);
    setWarpToolOpen(false);
  };

  const currentCorners = useMemo(() => draftCorners ?? DEFAULT_WARP.corners, [draftCorners]);

  const getTokenPosition = (token: Token) => tokenDrafts[token.id] || { x: token.x, y: token.y };

  const pointerCursor = mode === 'edit' ? 'grab' : 'default';
  const selectionSize = 100 / currentView.zoom;
  const warpHandlesVisible = mode === 'client' && warpToolOpen && warpHandlesEnabled;
  const frameLayerVisible = mode === 'client' && (showViewOverlay || warpToolOpen);
  const warpHandlePositions = useMemo(
    () => currentCorners.map((corner) => viewSpaceToStage(corner, currentView)),
    [currentCorners, currentView],
  );
  const showGridOverlay = mode === 'edit' && gridConfig.enabled;
  const renderableStrokes = useMemo(() => strokes.filter((stroke) => stroke.points.length > 0), [strokes]);
  const mapStageStyle = useMemo<CSSProperties>(
    () => ({
      aspectRatio,
      '--map-aspect': aspectRatio,
    }),
    [aspectRatio],
  );
  const contentStyle =
    mode === 'view'
      ? { transform: `translate(${localView.offsetX}px, ${localView.offsetY}px) scale(${localView.zoom})` }
      : mode === 'client'
        ? {
            transform: `translate(${(0.5 - currentView.center.x) * 100}%, ${
              (0.5 - currentView.center.y) * 100
            }%)`,
          }
        : undefined;
  const stageClassName = `map-stage ${!mapUrl ? 'empty' : ''} ${
    mode === 'view' || mode === 'client' ? 'view-mode' : ''
  } ${panningLocalView || (draggingView && mode === 'client') ? 'panning' : ''} ${
    mode === 'client' ? 'client-mode' : ''
  }`;

  return (
    <section className="map-workspace">
      <header className="workspace-header">
        <div className="workspace-primary">
          <span className="eyebrow">Battle map</span>
          <p className="workspace-hint">{WorkspaceHints[mode]}</p>
        </div>
        <div className="workspace-actions">
          <span className="pill">{modeLabel[mode]}</span>
        </div>
      </header>
      <div
        className={stageClassName}
        ref={containerRef}
        style={mapStageStyle}
        onWheel={handleWheel}
        onPointerDown={handleStagePointerDown}
      >
        <div className="map-stage__content" style={contentStyle}>
          <div className="map-stage__surface">
            {mapUrl ? (
              <div className="map-stage__image" style={{ backgroundImage: `url(${mapUrl})` }} />
            ) : (
              <div className="map-stage__placeholder">Upload a battle map to get started.</div>
            )}
            {showGridOverlay && (
              <div
                className="map-grid-overlay"
                style={
                  {
                    '--grid-width': `${gridConfig.width}px`,
                    '--grid-height': `${gridConfig.height}px`,
                  } as React.CSSProperties
                }
              />
            )}
            <div className="map-stage__overlay">
              {renderableStrokes.length > 0 && (
                <svg
                  className="drawing-layer"
                  viewBox="0 0 1 1"
                  preserveAspectRatio="none"
                  style={{ width: '100%', height: '100%' }}
                  aria-hidden
                >
                  {renderableStrokes.map((stroke) =>
                    stroke.points.length === 1 ? (
                      <circle
                        key={stroke.id}
                        cx={stroke.points[0].x}
                        cy={stroke.points[0].y}
                        r={stroke.width / 2}
                        fill={stroke.color}
                      />
                    ) : (
                      <polyline
                        key={stroke.id}
                        fill="none"
                        stroke={stroke.color}
                        strokeWidth={stroke.width}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        points={stroke.points.map((point) => `${point.x},${point.y}`).join(' ')}
                      />
                    ),
                  )}
                </svg>
              )}
              {tokens.map((token) => {
                const position = getTokenPosition(token);
                const selected = token.id === selectedTokenId;
                return (
                  <div
                    key={token.id}
                    className={`token-chip ${token.kind} ${selected ? 'selected' : ''} ${
                      token.visible ? '' : 'muted'
                    }`}
                    style={{
                      left: `${position.x * 100}%`,
                      top: `${position.y * 100}%`,
                      cursor: pointerCursor,
                      borderColor: TokenOutlineColors[token.kind],
                    }}
                    onPointerDown={(event) => handleTokenPointerDown(token, event)}
                  >
                    <span className="token-chip__icon" aria-hidden>
                      {TokenIcons[token.kind]}
                    </span>
                    <span className="token-chip__label">{token.name}</span>
                    {token.stats?.hp !== undefined && token.stats?.max_hp !== undefined && (
                      <span className="token-chip__stat">
                        {token.stats.hp}/{token.stats.max_hp}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        {frameLayerVisible && (
          <div className="map-stage__frame-layer">
            <div
              className={`projector-frame ${mode === 'client' ? 'interactive' : ''} ${
                draggingView ? 'dragging' : ''
              }`}
              style={{
                width: `${selectionSize}%`,
                height: `${selectionSize}%`,
                left: '50%',
                top: '50%',
                transform: `translate(-50%, -50%) rotate(${currentView.rotation}deg)`,
              }}
              onPointerDown={handleViewPointerDown}
            >
              <span className="projector-frame__label">Player view</span>
            </div>
            {warpHandlesVisible &&
              warpHandlePositions.map((corner, index) => (
                <button
                  key={`corner-${index}`}
                  className={`warp-handle ${draggingHandle === index ? 'dragging' : ''}`}
                  style={{ left: `${corner.x * 100}%`, top: `${corner.y * 100}%` }}
                  onPointerDown={(event) => handleWarpPointerDown(index, event)}
                />
              ))}
          </div>
        )}
      </div>
      <div className="workspace-dock">
        <div className="dock-group">
          <button type="button" className="tool-button primary" onClick={onOpenMapModal}>
            <span aria-hidden>🗺️</span>
            <span>Battle map</span>
          </button>
        </div>
        <div className="dock-group dock-modes" role="group" aria-label="Workspace mode">
          {(Object.keys(modeLabel) as WorkspaceMode[]).map((item) => (
            <button
              key={item}
              type="button"
              className={`tool-button chip ${item === mode ? 'active' : ''}`}
              onClick={() => onModeChange(item)}
              aria-pressed={item === mode}
            >
              {modeLabel[item]}
            </button>
          ))}
        </div>
        {(mode === 'edit' || mode === 'client') && (
          <div className="dock-group dock-context">
            {mode === 'edit' && (
              <>
                <div className="toolbar-item">
                  <button
                    type="button"
                    className={`tool-button ${drawPopoverOpen ? 'active' : ''}`}
                    onClick={toggleDrawPopover}
                    aria-pressed={drawPopoverOpen}
                  >
                    <span aria-hidden>✏️</span>
                    <span>Draw</span>
                  </button>
                  {drawPopoverOpen && (
                    <div className="tool-popover above">
                      <div className="map-tool-group">
                        {editTools.map((tool) => (
                          <button
                            key={tool.id}
                            type="button"
                            className={`tool-button ${editTool === tool.id ? 'active' : ''}`}
                            onClick={() => setEditTool(tool.id)}
                            aria-pressed={editTool === tool.id}
                          >
                            <span aria-hidden>{tool.icon}</span>
                            <span>{tool.label}</span>
                          </button>
                        ))}
                      </div>
                      <label className="color-chip">
                        <span className="color-chip__label">Pencil</span>
                        <input
                          type="color"
                          value={pencilColor}
                          onChange={(event) => setPencilColor(event.target.value)}
                        />
                      </label>
                    </div>
                  )}
                </div>
                <div className="toolbar-item">
                  <button
                    type="button"
                    className={`tool-button ${gridPopoverOpen || gridConfig.enabled ? 'active' : ''}`}
                    onClick={toggleGridPopover}
                    aria-pressed={gridPopoverOpen || gridConfig.enabled}
                  >
                    <span aria-hidden>#</span>
                    <span>Grid</span>
                  </button>
                  {gridPopoverOpen && (
                    <div className="tool-popover above">
                      <label className="popover-row">
                        <input
                          type="checkbox"
                          checked={gridConfig.enabled}
                          onChange={(event) => handleGridToggle(event.target.checked)}
                        />
                        <span>Show grid overlay</span>
                      </label>
                      <label className="popover-row">
                        <span>Cell width</span>
                        <input
                          type="number"
                          min={8}
                          max={400}
                          value={gridConfig.width}
                          onChange={handleGridSizeChange('width')}
                        />
                      </label>
                      <label className="popover-row">
                        <span>Cell height</span>
                        <input
                          type="number"
                          min={8}
                          max={400}
                          value={gridConfig.height}
                          onChange={handleGridSizeChange('height')}
                        />
                      </label>
                    </div>
                  )}
                </div>
              </>
            )}
            {mode === 'client' && (
              <>
                <div className="toolbar-item">
                  <button
                    type="button"
                    className={`tool-button ${warpToolOpen ? 'active' : ''}`}
                    onClick={toggleWarpTool}
                    aria-pressed={warpToolOpen}
                  >
                    <span aria-hidden>🧭</span>
                    <span>Warp</span>
                  </button>
                  {warpToolOpen && (
                    <div className="tool-popover above">
                      <label className="popover-row">
                        <input
                          type="checkbox"
                          checked={warpHandlesEnabled}
                          onChange={(event) => setWarpHandlesEnabled(event.target.checked)}
                        />
                        <span>Show warp handles</span>
                      </label>
                      <button type="button" className="ghost small" onClick={onResetWarp}>
                        Reset warp
                      </button>
                    </div>
                  )}
                </div>
                <div className="toolbar-item">
                  <button
                    type="button"
                    className={`tool-button ${zoomPopoverOpen ? 'active' : ''}`}
                    onClick={toggleZoomPopover}
                    aria-pressed={zoomPopoverOpen}
                  >
                    <span aria-hidden>🔎</span>
                    <span>Zoom</span>
                  </button>
                  {zoomPopoverOpen && (
                    <div className="tool-popover above">
                      <label className="projector-control">
                        <span>Zoom</span>
                        <input
                          type="range"
                          min={0.3}
                          max={8}
                          step={0.05}
                          value={currentView.zoom}
                          onChange={handleZoomChange}
                        />
                        <span className="projector-control__value">{currentView.zoom.toFixed(2)}x</span>
                      </label>
                    </div>
                  )}
                </div>
                <div className="toolbar-item">
                  <button
                    type="button"
                    className={`tool-button ${rotationPopoverOpen ? 'active' : ''}`}
                    onClick={toggleRotationPopover}
                    aria-pressed={rotationPopoverOpen}
                  >
                    <span aria-hidden>↻</span>
                    <span>Rotation</span>
                  </button>
                  {rotationPopoverOpen && (
                    <div className="tool-popover above">
                      <label className="projector-control">
                        <span>Rotation</span>
                        <input
                          type="range"
                          min={-180}
                          max={180}
                          step={1}
                          value={currentView.rotation}
                          onChange={handleRotationChange}
                        />
                        <span className="projector-control__value">{Math.round(currentView.rotation)}°</span>
                      </label>
                    </div>
                  )}
                </div>
                <div className="toolbar-item">
                  <button
                    type="button"
                    className={`tool-button ${overlayPopoverOpen || showViewOverlay ? 'active' : ''}`}
                    onClick={toggleOverlayPopover}
                    aria-pressed={overlayPopoverOpen || showViewOverlay}
                  >
                    <span aria-hidden>🎯</span>
                    <span>Player view</span>
                  </button>
                  {overlayPopoverOpen && (
                    <div className="tool-popover above">
                      <label className="popover-row">
                        <input
                          type="checkbox"
                          checked={showViewOverlay}
                          onChange={(event) => onToggleViewOverlay(event.target.checked)}
                        />
                        <span>Show player overlay</span>
                      </label>
                      <button className="ghost small" onClick={onResetView}>
                        Reset client view
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
};

export default MapWorkspace;
