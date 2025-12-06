export type WarpPoint = {
  x: number;
  y: number;
};

export type WarpConfig = {
  corners: WarpPoint[];
};

export type Stroke = {
  id: string;
  color: string;
  width: number;
  points: WarpPoint[];
};

export type MapView = {
  center: WarpPoint;
  zoom: number;
  rotation: number;
};

export type MapState = {
  image_url: string | null;
  warp: WarpConfig;
  grid_size?: number | null;
  view: MapView;
  strokes?: Stroke[];
};

export type SpellSlots = Record<string, number>;

export type TokenStats = {
  hp?: number | null;
  max_hp?: number | null;
  initiative?: number | null;
  spell_slots?: SpellSlots;
};

export type TokenKind = 'pc' | 'npc' | 'enemy' | 'prop';

export type Token = {
  id: string;
  name: string;
  kind: TokenKind;
  color: string;
  x: number;
  y: number;
  visible: boolean;
  notes?: string | null;
  stats: TokenStats;
};

export type TokenPreset = {
  id: string;
  name: string;
  kind: TokenKind;
  color: string;
  notes?: string | null;
  stats: TokenStats;
};

export type SessionState = {
  id: string;
  name?: string | null;
  map: MapState;
  tokens: Token[];
  token_order?: string[];
  presets: TokenPreset[];
  updated_at: string;
};

export type SessionRole = 'dm' | 'projector';

export const DEFAULT_WARP: WarpConfig = {
  corners: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ],
};

export const DEFAULT_MAP_VIEW: MapView = {
  center: { x: 0.5, y: 0.5 },
  zoom: 1,
  rotation: 0,
};
