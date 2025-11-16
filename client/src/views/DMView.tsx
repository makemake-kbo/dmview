import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import MapControls from '../components/MapControls';
import MapWorkspace from '../components/MapWorkspace';
import type { WorkspaceMode } from '../components/MapWorkspace';
import ResizableColumns from '../components/ResizableColumns';
import TokenSidebar from '../components/TokenSidebar';
import type { CharacterFormValues, TokenFormValues } from '../components/TokenSidebar';
import { useSession } from '../hooks/useSession';
import {
  addToken,
  createPreset,
  removeToken,
  removePreset,
  setMapUrl,
  setTokenOrder,
  updateToken,
  updateWarp,
  uploadMapFile,
} from '../lib/api';
import type { SessionState, WarpPoint } from '../types';
import { DEFAULT_WARP } from '../types';

const DMView = () => {
  const { sessionId = '' } = useParams();
  const { session, status, connectionState, error, setSession } = useSession(sessionId);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('tokens');
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [isMapModalOpen, setMapModalOpen] = useState(false);

  const projectorUrl = useMemo(() => {
    if (typeof window === 'undefined' || !sessionId) return '';
    return `${window.location.origin}/projector/${sessionId.toUpperCase()}`;
  }, [sessionId]);

  const handleSessionUpdate = (next: SessionState) => {
    setSession(next);
    setPendingMessage(null);
  };

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
              mapUrl={session.map.image_url}
              warp={session.map.warp}
              tokens={session.tokens}
              mode={workspaceMode}
              onModeChange={setWorkspaceMode}
              onOpenMapModal={() => setMapModalOpen(true)}
              onWarpCommit={handleWarpCommit}
              onTokenMove={handleTokenMove}
              onResetWarp={() => handleWarpCommit(session.map.warp?.corners ?? DEFAULT_WARP.corners)}
              selectedTokenId={selectedTokenId}
              onSelectToken={setSelectedTokenId}
            />
          }
          right={
            <div className="sidebar">
              <TokenSidebar
                tokens={session.tokens}
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
              <MapControls currentUrl={session.map.image_url} onSetUrl={handleMapUrl} onUpload={handleUpload} />
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
