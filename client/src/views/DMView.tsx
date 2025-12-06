import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import MapControls from '../components/MapControls';
import MapWorkspace, { type WorkspaceMode } from '../components/MapWorkspace';
import ResizableColumns from '../components/ResizableColumns';
import TokenSidebar, { type CharacterFormValues, type TokenFormValues } from '../components/TokenSidebar';
import { useSession } from '../hooks/useSession';
import {
  addToken,
  createPreset,
  removeToken,
  removePreset,
  setMapUrl,
  setTokenOrder,
  updateToken,
  updateMapView,
  updateWarp,
  uploadMapFile,
  updateStrokes,
} from '../lib/api';
import { ensureWarp } from '../lib/homography';
import { ensureMapView } from '../lib/mapView';
import type { MapState, MapView, SessionState, Stroke, Token, WarpPoint } from '../types';
import { DEFAULT_MAP_VIEW, DEFAULT_WARP } from '../types';

type SceneState = {
  id: string;
  name: string;
  map: MapState;
  tokens: Token[];
  tokenOrder?: string[];
};

type SessionUpdateOptions = {
  keepMessage?: boolean;
};

const sceneStorageKey = (sessionId: string) => `dm-scenes:${sessionId}`;
const createSceneId = () => `scene-${Math.random().toString(16).slice(2)}-${Date.now()}`;

const cloneWarpCorners = (warp?: MapState['warp'] | null) => ensureWarp(warp).corners.map((corner) => ({ ...corner }));

const cloneMapState = (map?: MapState | null): MapState => ({
  image_url: map?.image_url ?? null,
  warp: { corners: cloneWarpCorners(map?.warp) },
  grid_size: map?.grid_size ?? null,
  view: ensureMapView(map?.view ?? DEFAULT_MAP_VIEW),
  strokes: (map?.strokes ?? []).map((stroke) => ({
    ...stroke,
    points: stroke.points.map((point) => ({ ...point })),
  })),
});

const cloneToken = (token: Token): Token => ({
  ...token,
  stats: {
    hp: token.stats?.hp ?? undefined,
    max_hp: token.stats?.max_hp ?? undefined,
    initiative: token.stats?.initiative ?? undefined,
    spell_slots: token.stats?.spell_slots ? { ...token.stats.spell_slots } : undefined,
  },
});

const createSceneFromSession = (session: SessionState, name?: string): SceneState => ({
  id: createSceneId(),
  name: name ?? 'Scene 1',
  map: cloneMapState(session.map),
  tokens: session.tokens.map(cloneToken),
  tokenOrder: session.token_order ? [...session.token_order] : undefined,
});

const cloneScene = (scene: SceneState, name?: string): SceneState => ({
  id: createSceneId(),
  name: name ?? scene.name,
  map: cloneMapState(scene.map),
  tokens: scene.tokens.map(cloneToken),
  tokenOrder: scene.tokenOrder ? [...scene.tokenOrder] : undefined,
});

const normalizeScene = (scene: SceneState & { token_order?: string[] }): SceneState => ({
  ...scene,
  map: cloneMapState(scene.map),
  tokens: (scene.tokens ?? []).map(cloneToken),
  tokenOrder: scene.tokenOrder ?? scene.token_order ?? undefined,
});

const loadScenesFromStorage = (sessionId: string) => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(sceneStorageKey(sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { scenes?: SceneState[]; activeSceneId?: string | null };
    const scenes = (parsed.scenes ?? []).map(normalizeScene);
    const activeSceneId = parsed.activeSceneId ?? scenes[0]?.id ?? null;
    return scenes.length ? { scenes, activeSceneId } : null;
  } catch {
    return null;
  }
};

const persistScenes = (sessionId: string, scenes: SceneState[], activeSceneId: string | null) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(sceneStorageKey(sessionId), JSON.stringify({ scenes, activeSceneId }));
  } catch {
    // Ignore storage failures (private mode, quota issues, etc.)
  }
};

const warpsEqual = (a?: MapState['warp'] | null, b?: MapState['warp'] | null) => {
  const aCorners = cloneWarpCorners(a);
  const bCorners = cloneWarpCorners(b);
  return aCorners.every(
    (corner, index) =>
      Math.abs(corner.x - bCorners[index].x) < 0.0001 && Math.abs(corner.y - bCorners[index].y) < 0.0001,
  );
};

const viewsEqual = (a?: MapView | null, b?: MapView | null) =>
  !!a &&
  !!b &&
  Math.abs(a.zoom - b.zoom) < 0.0001 &&
  Math.abs(a.rotation - b.rotation) < 0.0001 &&
  Math.abs(a.center.x - b.center.x) < 0.0001 &&
  Math.abs(a.center.y - b.center.y) < 0.0001;

const strokesEqual = (a: Stroke[] = [], b: Stroke[] = []) => {
  if (a.length !== b.length) return false;
  return a.every((stroke, index) => {
    const other = b[index];
    if (!other) return false;
    if (stroke.color !== other.color || stroke.width !== other.width || stroke.points.length !== other.points.length) {
      return false;
    }
    return stroke.points.every(
      (point, pointIndex) =>
        Math.abs(point.x - other.points[pointIndex].x) < 0.0001 &&
        Math.abs(point.y - other.points[pointIndex].y) < 0.0001,
    );
  });
};

const slotsEqual = (a?: Record<string, number> | null, b?: Record<string, number> | null) => {
  const aEntries = Object.entries(a ?? {}).sort(([keyA], [keyB]) => keyA.localeCompare(keyB));
  const bEntries = Object.entries(b ?? {}).sort(([keyA], [keyB]) => keyA.localeCompare(keyB));
  if (aEntries.length !== bEntries.length) return false;
  return aEntries.every(([level, value], index) => bEntries[index][0] === level && bEntries[index][1] === value);
};

const statsEqual = (a?: Token['stats'] | null, b?: Token['stats'] | null) =>
  (a?.hp ?? null) === (b?.hp ?? null) &&
  (a?.max_hp ?? null) === (b?.max_hp ?? null) &&
  (a?.initiative ?? null) === (b?.initiative ?? null) &&
  slotsEqual(a?.spell_slots, b?.spell_slots);

const tokensEqual = (a: Token, b: Token) =>
  a.name === b.name &&
  a.kind === b.kind &&
  a.color === b.color &&
  a.x === b.x &&
  a.y === b.y &&
  a.visible === b.visible &&
  (a.notes ?? '') === (b.notes ?? '') &&
  statsEqual(a.stats, b.stats);

const arraysEqual = (a: string[] = [], b: string[] = []) => a.length === b.length && a.every((item, index) => item === b[index]);

const sceneMatchesSession = (scene: SceneState, next: SessionState) => {
  const orderMatches = arraysEqual(
    scene.tokenOrder ?? scene.tokens.map((token) => token.id),
    next.token_order ?? next.tokens.map((token) => token.id),
  );
  if ((scene.map.image_url ?? null) !== (next.map.image_url ?? null)) return false;
  if (!warpsEqual(scene.map.warp, next.map.warp)) return false;
  if (!viewsEqual(scene.map.view, next.map.view)) return false;
  if (!strokesEqual(scene.map.strokes, next.map.strokes ?? [])) return false;
  if (!orderMatches) return false;
  if (scene.tokens.length !== next.tokens.length) return false;
  const nextById = new Map(next.tokens.map((token) => [token.id, token]));
  return scene.tokens.every((token) => {
    const match = nextById.get(token.id);
    return match ? tokensEqual(token, match) : false;
  });
};

const applySessionToScene = (scene: SceneState, next: SessionState): SceneState => ({
  ...scene,
  map: cloneMapState(next.map),
  tokens: next.tokens.map(cloneToken),
  tokenOrder: next.token_order ? [...next.token_order] : undefined,
});

const buildDesiredOrder = (scene: SceneState, tokens: Token[]) => {
  const orderFromScene = (scene.tokenOrder ?? scene.tokens.map((token) => token.id)).filter((id) =>
    tokens.some((token) => token.id === id),
  );
  const missing = tokens.map((token) => token.id).filter((id) => !orderFromScene.includes(id));
  return [...orderFromScene, ...missing];
};

const DMView = () => {
  const { sessionId = '' } = useParams();
  const { session, status, connectionState, error, setSession } = useSession(sessionId);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('view');
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [isMapModalOpen, setMapModalOpen] = useState(false);
  const [showProjectorOverlay, setShowProjectorOverlay] = useState(true);
  const [scenes, setScenes] = useState<SceneState[]>([]);
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
  const [scenesReady, setScenesReady] = useState(false);
  const isSyncingSceneRef = useRef(false);

  const projectorUrl = useMemo(() => {
    if (typeof window === 'undefined' || !sessionId) return '';
    return `${window.location.origin}/projector/${sessionId.toUpperCase()}`;
  }, [sessionId]);

  useEffect(() => {
    setScenes([]);
    setActiveSceneId(null);
    setScenesReady(false);
    isSyncingSceneRef.current = false;
  }, [sessionId]);

  useEffect(() => {
    if (!session || scenesReady) return;
    const stored = loadScenesFromStorage(session.id);
    if (stored) {
      setScenes(stored.scenes);
      setActiveSceneId(stored.activeSceneId);
    } else {
      const initialScene = createSceneFromSession(session, 'Scene 1');
      setScenes([initialScene]);
      setActiveSceneId(initialScene.id);
    }
    setScenesReady(true);
  }, [session, scenesReady]);

  useEffect(() => {
    if (!session || !scenesReady) return;
    persistScenes(session.id, scenes, activeSceneId);
  }, [session?.id, scenes, activeSceneId, scenesReady]);

  useEffect(() => {
    if (!session || !scenesReady || !activeSceneId) return;
    setScenes((prev) =>
      prev.map((scene) => (scene.id === activeSceneId ? applySessionToScene(scene, session) : scene)),
    );
  }, [session?.map, session?.tokens, session?.map?.strokes, session?.token_order, scenesReady, activeSceneId]);

  const activeScene = useMemo(
    () => scenes.find((scene) => scene.id === activeSceneId) ?? scenes[0] ?? null,
    [scenes, activeSceneId],
  );

  useEffect(() => {
    if (!selectedTokenId || !activeScene) return;
    const exists = activeScene.tokens.some((token) => token.id === selectedTokenId);
    if (!exists) {
      setSelectedTokenId(null);
    }
  }, [selectedTokenId, activeScene]);

  const handleSessionUpdate = (next: SessionState, options?: SessionUpdateOptions) => {
    setSession(next);
    if (activeSceneId) {
      setScenes((prev) =>
        prev.map((scene) => (scene.id === activeSceneId ? applySessionToScene(scene, next) : scene)),
      );
    }
    if (!options?.keepMessage) {
      setPendingMessage(null);
    }
  };

  const applySceneToServer = async (scene: SceneState, options?: { silent?: boolean }) => {
    if (!sessionId || !session) return;
    if (isSyncingSceneRef.current) return;
    isSyncingSceneRef.current = true;
    if (!options?.silent) {
      setPendingMessage('Switching scene…');
    }

    let latest = session;
    const commit = async (action: () => Promise<SessionState>) => {
      const updated = await action();
      latest = updated;
      handleSessionUpdate(updated, { keepMessage: true });
    };

    try {
      const targetUrl = scene.map.image_url ?? '';
      if ((latest.map.image_url ?? '') !== targetUrl) {
        await commit(() => setMapUrl(sessionId, targetUrl));
      }
      if (!warpsEqual(scene.map.warp, latest.map.warp)) {
        await commit(() => updateWarp(sessionId, cloneWarpCorners(scene.map.warp)));
      }
      if (!viewsEqual(scene.map.view, latest.map.view)) {
        await commit(() => updateMapView(sessionId, scene.map.view));
      }
      if (!strokesEqual(scene.map.strokes ?? [], latest.map.strokes ?? [])) {
        await commit(() => updateStrokes(sessionId, scene.map.strokes ?? []));
      }

      for (const token of latest.tokens) {
        const stillNeeded = scene.tokens.some((item) => item.id === token.id);
        if (!stillNeeded) {
          await commit(() => removeToken(sessionId, token.id));
        }
      }

      const currentById = new Map(latest.tokens.map((token) => [token.id, token]));
      for (const token of scene.tokens) {
        const match = currentById.get(token.id);
        if (match) {
          if (!tokensEqual(match, token)) {
            await commit(() =>
              updateToken(sessionId, token.id, {
                name: token.name,
                kind: token.kind,
                color: token.color,
                x: token.x,
                y: token.y,
                visible: token.visible,
                notes: token.notes ?? undefined,
                stats: token.stats,
              }),
            );
          }
        } else {
          await commit(() =>
            addToken(sessionId, {
              name: token.name,
              kind: token.kind,
              color: token.color,
              x: token.x,
              y: token.y,
              visible: token.visible,
              notes: token.notes ?? undefined,
              stats: token.stats,
            }),
          );
        }
      }

      const desiredOrder = buildDesiredOrder(scene, latest.tokens);
      const latestOrder = latest.token_order ?? latest.tokens.map((token) => token.id);
      if (!arraysEqual(desiredOrder, latestOrder)) {
        await commit(() => setTokenOrder(sessionId, desiredOrder));
      }

      if (!options?.silent) {
        setPendingMessage(null);
      }
    } catch (err) {
      if (!options?.silent) {
        setPendingMessage(err instanceof Error ? err.message : String(err));
      }
      throw err;
    } finally {
      isSyncingSceneRef.current = false;
    }
  };

  useEffect(() => {
    if (!session || !scenesReady || !activeScene) return;
    if (!sceneMatchesSession(activeScene, session)) {
      void applySceneToServer(activeScene, { silent: true });
    }
  }, [session, scenesReady, activeScene]);

  const handleSceneSelect = async (sceneId: string) => {
    if (sceneId === activeSceneId) return;
    const nextScene = scenes.find((scene) => scene.id === sceneId);
    if (!nextScene) return;
    setActiveSceneId(sceneId);
    if (session) {
      try {
        await applySceneToServer(nextScene);
      } catch {
        // Errors are surfaced via the pending message toaster.
      }
    }
  };

  const handleAddScene = async () => {
    const template = activeScene ?? (session ? createSceneFromSession(session, 'Scene 1') : null);
    if (!template) return;
    const nextScene = cloneScene(template, `Scene ${scenes.length + 1}`);
    setScenes((prev) => [...prev, nextScene]);
    setActiveSceneId(nextScene.id);
    if (session) {
      try {
        await applySceneToServer(nextScene);
      } catch {
        // Errors are surfaced via the pending message toaster.
      }
    }
  };

  const handleRemoveScene = async (sceneId: string) => {
    if (scenes.length <= 1) return;
    const remaining = scenes.filter((scene) => scene.id !== sceneId);
    const nextActive =
      activeSceneId === sceneId
        ? remaining[0]
        : scenes.find((scene) => scene.id === activeSceneId) ?? remaining[0];
    setScenes(remaining);
    setActiveSceneId(nextActive?.id ?? null);
    if (session && nextActive) {
      try {
        await applySceneToServer(nextActive);
      } catch {
        // Errors are surfaced via the pending message toaster.
      }
    }
  };

  const viewMap =
    activeScene?.map ??
    session?.map ?? {
      image_url: null,
      warp: DEFAULT_WARP,
      view: DEFAULT_MAP_VIEW,
      strokes: [],
    };
  const viewTokens = activeScene?.tokens ?? session?.tokens ?? [];

  const handleMapUrl = async (url: string) => {
    if (!sessionId) return;
    const updated = await setMapUrl(sessionId, url);
    handleSessionUpdate(updated);
  };

  const handleUpload = async (file: File) => {
    if (!sessionId) return;
    setPendingMessage('Uploading map…');
    const updated = await uploadMapFile(sessionId, file);
    handleSessionUpdate(updated);
  };

  const handleWarpCommit = async (corners: WarpPoint[]) => {
    if (!sessionId) return;
    const updated = await updateWarp(sessionId, corners);
    handleSessionUpdate(updated);
  };

  const handleTokenMove = async (tokenId: string, position: WarpPoint) => {
    if (!sessionId) return;
    const updated = await updateToken(sessionId, tokenId, position);
    handleSessionUpdate(updated);
  };

  const handleToggleVisibility = async (tokenId: string, visible: boolean) => {
    if (!sessionId) return;
    const updated = await updateToken(sessionId, tokenId, { visible });
    handleSessionUpdate(updated);
  };

  const handleDeleteToken = async (tokenId: string) => {
    if (!sessionId) return;
    const updated = await removeToken(sessionId, tokenId);
    handleSessionUpdate(updated);
    if (selectedTokenId === tokenId) {
      setSelectedTokenId(null);
    }
  };

  const handleTokenDetailUpdate = async (
    tokenId: string,
    payload: TokenFormValues & { notes: string; visible: boolean; spellSlots: Record<number, string> },
  ) => {
    if (!sessionId) return;
    const stats = buildStatsPayload(payload, payload.spellSlots);
    const updated = await updateToken(sessionId, tokenId, {
      name: payload.name,
      color: payload.color,
      kind: payload.kind,
      visible: payload.visible,
      notes: payload.notes,
      stats,
    });
    handleSessionUpdate(updated);
  };

  const handleTokenOrderUpdate = async (order: string[]) => {
    if (!sessionId) return;
    const updated = await setTokenOrder(sessionId, order);
    handleSessionUpdate(updated);
  };

  const handleSpawnFromPreset = async (presetId: string) => {
    if (!sessionId || !session) return;
    const preset = session.presets.find((item) => item.id === presetId);
    if (!preset) return;
    const updated = await addToken(sessionId, {
      name: preset.name,
      kind: preset.kind,
      color: preset.color,
      notes: preset.notes ?? undefined,
      stats: preset.stats,
    });
    handleSessionUpdate(updated);
  };

  const handleCreatePreset = async (values: CharacterFormValues) => {
    if (!sessionId) return;
    const stats = buildStatsPayload(values, values.spellSlots);
    const updated = await createPreset(sessionId, {
      name: values.name,
      kind: values.kind,
      color: values.color,
      notes: values.notes,
      stats,
    });
    handleSessionUpdate(updated);
  };

  const handleCreateOneOff = async (values: CharacterFormValues) => {
    if (!sessionId) return;
    const stats = buildStatsPayload(values, values.spellSlots);
    const updated = await addToken(sessionId, {
      name: values.name,
      kind: values.kind,
      color: values.color,
      notes: values.notes,
      stats,
      visible: values.visible,
    });
    handleSessionUpdate(updated);
  };

  const handleDeletePreset = async (presetId: string) => {
    if (!sessionId) return;
    const updated = await removePreset(sessionId, presetId);
    handleSessionUpdate(updated);
  };

  const handleViewCommit = async (next: MapView) => {
    if (!sessionId) return;
    const updated = await updateMapView(sessionId, next);
    handleSessionUpdate(updated);
  };

  const handleStrokesCommit = async (next: Stroke[]) => {
    if (!sessionId) return;
    const updated = await updateStrokes(sessionId, next);
    handleSessionUpdate(updated);
  };

  const handleResetView = () => {
    handleViewCommit({ ...DEFAULT_MAP_VIEW, center: { ...DEFAULT_MAP_VIEW.center } });
  };

  if (!sessionId) {
    return (
      <main className="screen center">
        <p>No session id provided.</p>
        <Link to="/">Back home</Link>
      </main>
    );
  }

  if (status === 'loading' || !session) {
    return (
      <main className="screen center">
        <p>Loading session…</p>
      </main>
    );
  }

  if (status === 'error') {
    return (
      <main className="screen center">
        <p>Unable to load session.</p>
        {error && <p className="error">{error}</p>}
        <Link to="/">Back home</Link>
      </main>
    );
  }

  return (
    <main className="dm-layout">
      <header className="dm-header">
        <div>
          <p className="eyebrow">Session</p>
          <h1>{session.id}</h1>
          <p className="muted">Share with projector: {projectorUrl}</p>
        </div>
        <div className="status-pills">
          <span className={`pill ${status}`}>{status}</span>
          <span className={`pill ${connectionState}`}>{connectionState}</span>
        </div>
      </header>
      <section className="workspace">
        <ResizableColumns
          left={
            <MapWorkspace
              mapUrl={viewMap.image_url}
              warp={viewMap.warp}
              view={viewMap.view}
              strokes={viewMap.strokes}
              tokens={viewTokens}
              mode={workspaceMode}
              onModeChange={setWorkspaceMode}
              onOpenMapModal={() => setMapModalOpen(true)}
              onWarpCommit={handleWarpCommit}
              onViewCommit={handleViewCommit}
              onStrokesCommit={handleStrokesCommit}
              onTokenMove={handleTokenMove}
              onResetWarp={() => handleWarpCommit(DEFAULT_WARP.corners.map((corner) => ({ ...corner })))}
              onResetView={handleResetView}
              selectedTokenId={selectedTokenId}
              showViewOverlay={showProjectorOverlay}
              onToggleViewOverlay={setShowProjectorOverlay}
              scenes={scenes}
              activeSceneId={activeSceneId}
              onSelectScene={handleSceneSelect}
              onAddScene={handleAddScene}
              onRemoveScene={handleRemoveScene}
            />
          }
          right={
            <div className="sidebar">
              <TokenSidebar
                tokens={viewTokens}
                presets={session.presets}
                selectedTokenId={selectedTokenId}
                onSelectToken={setSelectedTokenId}
                onReorderTokens={handleTokenOrderUpdate}
                onSpawnFromPreset={handleSpawnFromPreset}
                onToggleVisibility={(token) => handleToggleVisibility(token.id, !token.visible)}
                onDeleteToken={handleDeleteToken}
                onUpdateToken={(tokenId, payload) => handleTokenDetailUpdate(tokenId, payload)}
                onCreatePreset={handleCreatePreset}
                onCreateOneOff={handleCreateOneOff}
                onDeletePreset={handleDeletePreset}
              />
            </div>
          }
        />
      </section>
      {isMapModalOpen && (
        <div className="modal-overlay">
          <div className="modal">
            <header className="modal-header">
              <div>
                <p className="eyebrow">Battle map</p>
                <h2>Manage your projection</h2>
                <p className="muted small">Load a remote image or upload a fresh render for this table.</p>
              </div>
              <button type="button" className="ghost" onClick={() => setMapModalOpen(false)}>
                Close
              </button>
            </header>
            <div className="modal-body single-column">
              <MapControls currentUrl={viewMap.image_url} onSetUrl={handleMapUrl} onUpload={handleUpload} />
            </div>
          </div>
        </div>
      )}
      {pendingMessage && <div className="toaster">{pendingMessage}</div>}
    </main>
  );
};

const numberOrUndefined = (value: string) => {
  if (value === '' || Number.isNaN(Number(value))) return undefined;
  return Number(value);
};

const buildStatsPayload = (
  values: TokenFormValues,
  slots?: Record<number, string>,
): {
  hp?: number;
  max_hp?: number;
  initiative?: number;
  spell_slots?: Record<string, number>;
} => ({
  hp: numberOrUndefined(values.hp),
  max_hp: numberOrUndefined(values.maxHp),
  initiative: numberOrUndefined(values.initiative),
  spell_slots: slots
    ? Object.entries(slots).reduce<Record<string, number>>((acc, [level, amount]) => {
        const parsed = Number(amount);
        if (!Number.isNaN(parsed)) {
          acc[String(level)] = parsed;
        }
        return acc;
      }, {})
    : undefined,
});

export default DMView;
