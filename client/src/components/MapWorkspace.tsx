import { useEffect, useMemo, useRef, useState } from 'react';
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
  npc: '👤',
  prop: '📍',
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
    setPanningLocalView(false);
    localPanRef.current = null;
    if (mode === 'client') {
      setWarpHandlesEnabled(true);
    }
  }, [mode]);

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      if (draggingHandle === null && !draggingToken && !draggingView && !panningLocalView) {
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

      if (draggingHandle !== null) {
        setDraftCorners((prev) => {
          const next = prev.map((corner) => ({ ...corner }));
          next[draggingHandle] = { x, y };
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
    onViewCommit,
    onWarpCommit,
    tokenDrafts,
    viewDraft,
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
    if (mode !== 'view') return;
    event.preventDefault();
    setPanningLocalView(true);
    localPanRef.current = { x: event.clientX, y: event.clientY };
  };

  const handleViewPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (mode !== 'client') return;
    event.preventDefault();
    event.stopPropagation();
    setDraggingView(true);
    lastPointerRef.current = { x: event.clientX, y: event.clientY };
  };

  const pushViewUpdate = (next: MapView, debounceMs = 0) => {
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
  };

  const currentCorners = useMemo(() => draftCorners ?? DEFAULT_WARP.corners, [draftCorners]);

  const getTokenPosition = (token: Token) => tokenDrafts[token.id] || { x: token.x, y: token.y };

  const pointerCursor = mode === 'edit' ? 'grab' : 'default';
  const currentView = useMemo(() => normalizeMapView(viewDraft ?? DEFAULT_MAP_VIEW), [viewDraft]);
  const selectionSize = 100 / currentView.zoom;
  const warpHandlesVisible = mode === 'client' && warpToolOpen && warpHandlesEnabled;
  const showGridOverlay = mode === 'edit' && gridConfig.enabled;
  const contentStyle =
    mode === 'view'
      ? { transform: `translate(${localView.offsetX}px, ${localView.offsetY}px) scale(${localView.zoom})` }
      : undefined;
  const stageClassName = `map-stage ${!mapUrl ? 'empty' : ''} ${mode === 'view' ? 'view-mode' : ''} ${
    panningLocalView ? 'panning' : ''
  }`;

  return (
    <section className="map-workspace">
      <header className="workspace-header">
        <div className="workspace-primary">
          <button type="button" className="workspace-map-trigger" onClick={onOpenMapModal}>
            Battle map
          </button>
          <div className="workspace-tabs">
            {(Object.keys(modeLabel) as WorkspaceMode[]).map((item) => (
              <button
                key={item}
                className={item === mode ? 'active' : ''}
                onClick={() => onModeChange(item)}
              >
                {modeLabel[item]}
              </button>
            ))}
          </div>
        </div>
        <div className="workspace-actions">{mode === 'client' && <span className="muted small">Player-side controls below</span>}</div>
      </header>
      <p className="workspace-hint">{WorkspaceHints[mode]}</p>
      {mode === 'edit' && (
        <div className="map-toolbar">
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
          <div className="map-tool-group">
            <label className="color-chip">
              <span className="color-chip__label">Pencil</span>
              <input type="color" value={pencilColor} onChange={(event) => setPencilColor(event.target.value)} />
            </label>
            <div className="grid-tool">
              <button
                type="button"
                className={`tool-button ${gridConfig.enabled ? 'active' : ''}`}
                onClick={() => setGridPopoverOpen((prev) => !prev)}
                aria-pressed={gridConfig.enabled}
              >
                <span aria-hidden>#</span>
                <span>Grid</span>
              </button>
              {gridPopoverOpen && (
                <div className="tool-popover">
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
          </div>
        </div>
      )}
      <div
        className={stageClassName}
        ref={containerRef}
        style={{ aspectRatio }}
        onWheel={handleWheel}
        onPointerDown={handleStagePointerDown}
      >
        <div className="map-stage__content" style={contentStyle}>
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
            {mode === 'client' && showViewOverlay && (
              <div
                className={`projector-frame ${mode === 'client' ? 'interactive' : ''} ${
                  draggingView ? 'dragging' : ''
                }`}
                style={{
                  width: `${selectionSize}%`,
                  height: `${selectionSize}%`,
                  left: `${currentView.center.x * 100}%`,
                  top: `${currentView.center.y * 100}%`,
                  transform: `translate(-50%, -50%) rotate(${currentView.rotation}deg)`,
                }}
                onPointerDown={handleViewPointerDown}
              >
                <span className="projector-frame__label">Player view</span>
              </div>
            )}
            {warpHandlesVisible &&
              currentCorners.map((corner, index) => (
                <button
                  key={`corner-${index}`}
                  className={`warp-handle ${draggingHandle === index ? 'dragging' : ''}`}
                  style={{ left: `${corner.x * 100}%`, top: `${corner.y * 100}%` }}
                  onPointerDown={(event) => handleWarpPointerDown(index, event)}
                />
              ))}
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
      {mode === 'client' && (
        <div className="client-toolbar">
          <div className="client-tool">
            <button type="button" className={`tool-button ${warpToolOpen ? 'active' : ''}`} onClick={toggleWarpTool}>
              <span aria-hidden>🗺️</span>
              <span>Warp tool</span>
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
          <div className="client-controls">
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
          <div className="client-actions">
            <label className="projector-toggle">
              <input
                type="checkbox"
                checked={showViewOverlay}
                onChange={(event) => onToggleViewOverlay(event.target.checked)}
              />
              <span>Show player overlay</span>
            </label>
            <button className="ghost" onClick={onResetView}>
              Reset client view
            </button>
          </div>
        </div>
      )}
    </section>
  );
};

export default MapWorkspace;
