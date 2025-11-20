from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class WarpPoint(BaseModel):
    x: float
    y: float


DEFAULT_WARP = [
    WarpPoint(x=0.05, y=0.05),
    WarpPoint(x=0.95, y=0.05),
    WarpPoint(x=0.95, y=0.95),
    WarpPoint(x=0.05, y=0.95),
]


class WarpConfig(BaseModel):
    corners: List[WarpPoint] = Field(default_factory=lambda: [p.copy() for p in DEFAULT_WARP])


class MapView(BaseModel):
    center: WarpPoint = Field(default_factory=lambda: WarpPoint(x=0.5, y=0.5))
    zoom: float = 1.0
    rotation: float = 0.0


class MapState(BaseModel):
    image_url: Optional[str] = None
    warp: WarpConfig = Field(default_factory=WarpConfig)
    grid_size: Optional[float] = None
    view: MapView = Field(default_factory=MapView)


class TokenStats(BaseModel):
    hp: Optional[int] = None
    max_hp: Optional[int] = None
    initiative: Optional[float] = None
    spell_slots: Dict[str, int] = Field(default_factory=dict)


class Token(BaseModel):
    id: str
    name: str
    kind: Literal["pc", "npc", "prop"]
    color: str = "#ffffff"
    x: float = 0.5
    y: float = 0.5
    visible: bool = True
    notes: Optional[str] = None
    stats: TokenStats = Field(default_factory=TokenStats)


class SessionState(BaseModel):
    id: str
    name: Optional[str] = None
    map: MapState = Field(default_factory=MapState)
    tokens: List[Token] = Field(default_factory=list)
    token_order: List[str] = Field(default_factory=list)
    presets: List["TokenPreset"] = Field(default_factory=list)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class SessionCreateRequest(BaseModel):
    name: Optional[str] = None
    session_id: Optional[str] = None


class MapUrlRequest(BaseModel):
    url: str


class WarpUpdateRequest(BaseModel):
    warp: WarpConfig


class MapViewUpdateRequest(BaseModel):
    view: MapView


class TokenCreateRequest(BaseModel):
    name: str
    kind: Literal["pc", "npc", "prop"] = "pc"
    color: str = "#ffffff"
    x: float = 0.5
    y: float = 0.5
    visible: bool = True
    notes: Optional[str] = None
    stats: TokenStats = Field(default_factory=TokenStats)


class TokenUpdateRequest(BaseModel):
    name: Optional[str] = None
    kind: Optional[Literal["pc", "npc", "prop"]] = None
    color: Optional[str] = None
    x: Optional[float] = None
    y: Optional[float] = None
    visible: Optional[bool] = None
    notes: Optional[str] = None
    stats: Optional[TokenStats] = None


class TokenMoveRequest(BaseModel):
    x: float
    y: float


class TokenOrderUpdateRequest(BaseModel):
    order: List[str]


class TokenPreset(BaseModel):
    id: str
    name: str
    kind: Literal["pc", "npc", "prop"] = "pc"
    color: str = "#ffffff"
    stats: TokenStats = Field(default_factory=TokenStats)
    notes: Optional[str] = None


class PresetCreateRequest(BaseModel):
    name: str
    kind: Literal["pc", "npc", "prop"] = "pc"
    color: str = "#ffffff"
    stats: TokenStats = Field(default_factory=TokenStats)
    notes: Optional[str] = None


class PresetUpdateRequest(BaseModel):
    name: Optional[str] = None
    kind: Optional[Literal["pc", "npc", "prop"]] = None
    color: Optional[str] = None
    stats: Optional[TokenStats] = None
    notes: Optional[str] = None
