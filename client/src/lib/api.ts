import type { MapView, SessionState, TokenStats, TokenKind, WarpPoint, Stroke } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

const jsonHeaders = {
  'Content-Type': 'application/json',
};

const withBase = (path: string) => `${API_BASE_URL}${path}`;

const normalizeSessionId = (sessionId: string) => sessionId.trim().toUpperCase();

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(withBase(path), options);
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with status ${response.status}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const getApiBaseUrl = () => API_BASE_URL;

export const getWebSocketUrl = (sessionId: string) => {
  const normalized = normalizeSessionId(sessionId);
  const wsProtocol = API_BASE_URL.startsWith('https') ? 'wss' : 'ws';
  const stripped = API_BASE_URL.replace(/^https?:\/\//, '');
  return `${wsProtocol}://${stripped}/ws/${normalized}`;
};

export type SessionCreatePayload = {
  name?: string;
  sessionId?: string;
};

export const createSession = (payload: SessionCreatePayload) =>
  apiFetch<SessionState>('/api/sessions', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      name: payload.name,
      session_id: payload.sessionId,
    }),
  });

export const fetchSession = (sessionId: string) =>
  apiFetch<SessionState>(`/api/sessions/${normalizeSessionId(sessionId)}`);

export const setMapUrl = (sessionId: string, url: string) =>
  apiFetch<SessionState>(`/api/sessions/${normalizeSessionId(sessionId)}/map/url`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ url }),
  });

export const uploadMapFile = async (sessionId: string, file: File) => {
  const form = new FormData();
  form.append('file', file);
  return apiFetch<SessionState>(`/api/sessions/${normalizeSessionId(sessionId)}/map/upload`, {
    method: 'POST',
    body: form,
  });
};

export const updateWarp = (sessionId: string, corners: WarpPoint[]) =>
  apiFetch<SessionState>(`/api/sessions/${normalizeSessionId(sessionId)}/warp`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ warp: { corners } }),
  });

export const updateMapView = (sessionId: string, view: MapView) =>
  apiFetch<SessionState>(`/api/sessions/${normalizeSessionId(sessionId)}/map/view`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ view }),
  });

export const updateStrokes = (sessionId: string, strokes: Stroke[]) =>
  apiFetch<SessionState>(`/api/sessions/${normalizeSessionId(sessionId)}/map/strokes`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ strokes }),
  });

export type TokenInput = {
  name: string;
  kind: TokenKind;
  color: string;
  x?: number;
  y?: number;
  visible?: boolean;
  notes?: string;
  stats?: TokenStats;
};

export const addToken = (sessionId: string, payload: TokenInput) =>
  apiFetch<SessionState>(`/api/sessions/${normalizeSessionId(sessionId)}/tokens`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });

export type TokenUpdateInput = Partial<Pick<TokenInput, 'name' | 'kind' | 'color' | 'x' | 'y' | 'visible' | 'notes'>> & {
  stats?: TokenStats;
};

export const updateToken = (sessionId: string, tokenId: string, payload: TokenUpdateInput) =>
  apiFetch<SessionState>(`/api/sessions/${normalizeSessionId(sessionId)}/tokens/${tokenId}`, {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });

export const removeToken = (sessionId: string, tokenId: string) =>
  apiFetch<SessionState>(`/api/sessions/${normalizeSessionId(sessionId)}/tokens/${tokenId}`, {
    method: 'DELETE',
  });

export const setTokenOrder = (sessionId: string, order: string[]) =>
  apiFetch<SessionState>(`/api/sessions/${normalizeSessionId(sessionId)}/token-order`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ order }),
  });

export type PresetInput = {
  name: string;
  kind: TokenKind;
  color: string;
  stats?: TokenStats;
  notes?: string;
};

export const createPreset = (sessionId: string, payload: PresetInput) =>
  apiFetch<SessionState>(`/api/sessions/${normalizeSessionId(sessionId)}/presets`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });

export const updatePreset = (sessionId: string, presetId: string, payload: PresetInput) =>
  apiFetch<SessionState>(`/api/sessions/${normalizeSessionId(sessionId)}/presets/${presetId}`, {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });

export const removePreset = (sessionId: string, presetId: string) =>
  apiFetch<SessionState>(`/api/sessions/${normalizeSessionId(sessionId)}/presets/${presetId}`, {
    method: 'DELETE',
  });
