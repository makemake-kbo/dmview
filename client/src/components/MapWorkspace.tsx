import { useEffect, useMemo, useRef, useState } from 'react';
import type { MapView, Token, WarpConfig, WarpPoint } from '../types';
import { DEFAULT_MAP_VIEW, DEFAULT_WARP } from '../types';
import { ensureWarp } from '../lib/homography';
import { ensureMapView, normalizeMapView } from '../lib/mapView';

export type WorkspaceMode = 'warp' | 'tokens' | 'projector';

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
  warp: 'Drag the four handles to match the physical corners of your table. Changes save when you release.',
  tokens: 'Drag tokens to reposition them. Hidden pieces appear ghosted only for you.',
  projector: 'Drag the selection to pan, scroll to zoom, and rotate the dial to twist the player view.',
};

const modeLabel: Record<WorkspaceMode, string> = {
  warp: 'Warp calibration',
  tokens: 'Token placement',
  projector: 'Projection view',
};

const TokenIcons: Record<Token['kind'], string> = {
  pc: '🛡️',
  npc: '👤',
  prop: '📍',
};

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
    const handleMove = (event: PointerEvent) => {
      if (draggingHandle === null && !draggingToken && !draggingView) {
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
    if (mode !== 'tokens') return;
    event.preventDefault();
    event.stopPropagation();
    setDraggingToken(token.id);
    setTokenDrafts((prev) => ({
      ...prev,
      [token.id]: { x: token.x, y: token.y },
    }));
  };

  const handleViewPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (mode !== 'projector') return;
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
    if (mode !== 'projector') return;
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

  const currentCorners = useMemo(() => draftCorners ?? DEFAULT_WARP.corners, [draftCorners]);

  const getTokenPosition = (token: Token) => tokenDrafts[token.id] || { x: token.x, y: token.y };

  const pointerCursor = mode === 'tokens' || mode === 'projector' ? 'grab' : 'default';
  const currentView = useMemo(() => normalizeMapView(viewDraft ?? DEFAULT_MAP_VIEW), [viewDraft]);
  const selectionSize = 100 / currentView.zoom;

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
        <div className="workspace-actions">
          {mode === 'projector' && (
            <>
              <button className="ghost" onClick={() => onToggleViewOverlay(!showViewOverlay)}>
                {showViewOverlay ? 'Hide overlay' : 'Show overlay'}
              </button>
              <button className="ghost" onClick={onResetView}>
                Reset view
              </button>
            </>
          )}
          {mode === 'warp' && (
            <button className="ghost" onClick={onResetWarp}>
              Reset warp
            </button>
          )}
        </div>
      </header>
      <p className="workspace-hint">{WorkspaceHints[mode]}</p>
      {mode === 'projector' && (
        <div className="projector-toolbar">
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
          <label className="projector-toggle">
            <input
              type="checkbox"
              checked={showViewOverlay}
              onChange={(event) => onToggleViewOverlay(event.target.checked)}
            />
            <span>Show player overlay</span>
          </label>
        </div>
      )}
      <div
        className={`map-stage ${!mapUrl ? 'empty' : ''}`}
        ref={containerRef}
        style={{ aspectRatio }}
        onWheel={handleWheel}
      >
        {mapUrl ? (
          <div className="map-stage__image" style={{ backgroundImage: `url(${mapUrl})` }} />
        ) : (
          <div className="map-stage__placeholder">Upload a battle map to get started.</div>
        )}
        <div className="map-stage__overlay">
          {showViewOverlay && (
            <div
              className={`projector-frame ${mode === 'projector' ? 'interactive' : ''} ${
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
          {mode === 'warp' &&
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
    </section>
  );
};

export default MapWorkspace;
