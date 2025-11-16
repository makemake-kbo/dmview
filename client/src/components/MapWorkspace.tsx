import { useEffect, useMemo, useRef, useState } from 'react';
import type { Token, WarpConfig, WarpPoint } from '../types';
import { DEFAULT_WARP } from '../types';
import { ensureWarp } from '../lib/homography';

export type WorkspaceMode = 'warp' | 'tokens';

interface MapWorkspaceProps {
  mapUrl?: string | null;
  warp?: WarpConfig | null;
  tokens: Token[];
  mode: WorkspaceMode;
  onModeChange(mode: WorkspaceMode): void;
  onOpenMapModal(): void;
  onWarpCommit(corners: WarpPoint[]): void;
  onTokenMove(tokenId: string, position: WarpPoint): void;
  onResetWarp(): void;
  selectedTokenId?: string | null;
  onSelectToken(id: string | null): void;
}

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

const WorkspaceHints: Record<WorkspaceMode, string> = {
  warp: 'Drag the four handles to match the physical corners of your table. Changes save when you release.',
  tokens: 'Drag tokens to reposition them. Hidden pieces appear ghosted only for you.',
};

const modeLabel: Record<WorkspaceMode, string> = {
  warp: 'Warp calibration',
  tokens: 'Token placement',
};

const TokenIcons: Record<Token['kind'], string> = {
  pc: '🛡️',
  npc: '👤',
  prop: '📍',
};

const MapWorkspace = ({
  mapUrl,
  warp,
  tokens,
  mode,
  onModeChange,
  onWarpCommit,
  onOpenMapModal,
  onTokenMove,
  onResetWarp,
  selectedTokenId,
  onSelectToken,
}: MapWorkspaceProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [draftCorners, setDraftCorners] = useState<WarpPoint[]>(ensureWarp(warp).corners);
  const [draggingHandle, setDraggingHandle] = useState<number | null>(null);
  const [draggingToken, setDraggingToken] = useState<string | null>(null);
  const [tokenDrafts, setTokenDrafts] = useState<Record<string, WarpPoint>>({});
  const [aspectRatio, setAspectRatio] = useState(1);

  useEffect(() => {
    setDraftCorners(ensureWarp(warp).corners.map((corner) => ({ ...corner })));
  }, [warp?.corners]);

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
      if (draggingHandle === null && !draggingToken) {
        return;
      }
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = clamp((event.clientX - rect.left) / rect.width);
      const y = clamp((event.clientY - rect.top) / rect.height);

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
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);

    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [draggingHandle, draggingToken, draftCorners, onTokenMove, onWarpCommit, tokenDrafts]);

  const handleWarpPointerDown = (index: number, event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDraggingHandle(index);
  };

  const handleTokenPointerDown = (token: Token, event: React.PointerEvent<HTMLDivElement>) => {
    if (mode !== 'tokens') return;
    event.preventDefault();
    event.stopPropagation();
    onSelectToken(token.id);
    setDraggingToken(token.id);
    setTokenDrafts((prev) => ({
      ...prev,
      [token.id]: { x: token.x, y: token.y },
    }));
  };

  const currentCorners = useMemo(() => draftCorners ?? DEFAULT_WARP.corners, [draftCorners]);

  const getTokenPosition = (token: Token) => tokenDrafts[token.id] || { x: token.x, y: token.y };

  const pointerCursor = mode === 'tokens' ? 'grab' : 'default';

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
          {mode === 'warp' && (
            <button className="ghost" onClick={onResetWarp}>
              Reset warp
            </button>
          )}
        </div>
      </header>
      <p className="workspace-hint">{WorkspaceHints[mode]}</p>
      <div
        className={`map-stage ${!mapUrl ? 'empty' : ''}`}
        ref={containerRef}
        style={{ aspectRatio }}
      >
        {mapUrl ? (
          <div className="map-stage__image" style={{ backgroundImage: `url(${mapUrl})` }} />
        ) : (
          <div className="map-stage__placeholder">Upload a battle map to get started.</div>
        )}
        <div className="map-stage__overlay">
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
                onClick={() => onSelectToken(token.id)}
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
