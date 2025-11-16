export type WarpPoint = {
  x: number;
  y: number;
};

export type WarpConfig = {
  corners: WarpPoint[];
};

export type MapState = {
  image_url: string | null;
  warp: WarpConfig;
  grid_size?: number | null;
};

export type SpellSlots = Record<string, number>;

export type TokenStats = {
  hp?: number | null;
  max_hp?: number | null;
  initiative?: number | null;
  spell_slots?: SpellSlots;
};

export type TokenKind = 'pc' | 'npc' | 'prop';

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

export type SessionState = {
  id: string;
  name?: string | null;
  map: MapState;
  tokens: Token[];
  updated_at: string;
};

export type SessionRole = 'dm' | 'projector';

export const DEFAULT_WARP: WarpConfig = {
  corners: [
    { x: 0.05, y: 0.05 },
    { x: 0.95, y: 0.05 },
    { x: 0.95, y: 0.95 },
    { x: 0.05, y: 0.95 },
  ],
};
