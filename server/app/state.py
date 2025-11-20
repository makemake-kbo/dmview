from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Callable, Dict, List, Optional
from uuid import uuid4

from fastapi import HTTPException, status

from .models import (
    MapUrlRequest,
    MapView,
    PresetCreateRequest,
    PresetUpdateRequest,
    SessionCreateRequest,
    SessionState,
    Token,
    TokenCreateRequest,
    TokenPreset,
    TokenOrderUpdateRequest,
    TokenStats,
    TokenUpdateRequest,
    WarpConfig,
)


def _clamp_unit(value: Optional[float]) -> Optional[float]:
    if value is None:
        return None
    return max(0.0, min(1.0, value))


def _clamp_or_default(value: Optional[float], default: float = 0.5) -> float:
    return _clamp_unit(value) if value is not None else default


class SessionManager:
    def __init__(self) -> None:
        self._sessions: Dict[str, SessionState] = {}
        self._lock = asyncio.Lock()

    def _generate_session_id(self) -> str:
        return uuid4().hex[:6].upper()

    async def create_session(self, payload: SessionCreateRequest) -> SessionState:
        async with self._lock:
            session_id = (payload.session_id or self._generate_session_id()).strip()
            if not session_id:
                session_id = self._generate_session_id()
            normalized = session_id.upper()
            if normalized in self._sessions:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Session ID already exists",
                )
            session = SessionState(id=normalized, name=payload.name)
            self._sessions[normalized] = session
            return session

    async def list_sessions(self) -> Dict[str, SessionState]:
        async with self._lock:
            return {key: value for key, value in self._sessions.items()}

    async def require_session(self, session_id: str) -> SessionState:
        normalized = session_id.upper()
        async with self._lock:
            session = self._sessions.get(normalized)
            if not session:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Session not found",
                )
            return session

    async def mutate_session(
        self,
        session_id: str,
        mutator: Callable[[SessionState], None],
    ) -> SessionState:
        normalized = session_id.upper()
        async with self._lock:
            session = self._sessions.get(normalized)
            if not session:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Session not found",
                )
            mutator(session)
            self._sync_token_order(session)
            session.updated_at = datetime.utcnow()
            return session

    async def set_map_url(self, session_id: str, payload: MapUrlRequest) -> SessionState:
        def mutator(session: SessionState) -> None:
            session.map.image_url = payload.url

        return await self.mutate_session(session_id, mutator)

    async def set_map_image(self, session_id: str, url: str) -> SessionState:
        def mutator(session: SessionState) -> None:
            session.map.image_url = url

        return await self.mutate_session(session_id, mutator)

    async def set_warp(self, session_id: str, warp: WarpConfig) -> SessionState:
        def mutator(session: SessionState) -> None:
            session.map.warp = warp

        return await self.mutate_session(session_id, mutator)

    async def set_map_view(self, session_id: str, view: MapView) -> SessionState:
        def mutator(session: SessionState) -> None:
            center = view.center
            zoom = max(0.2, min(8.0, view.zoom))
            # Normalize rotation to keep it bounded for payload size/readability
            rotation = view.rotation % 360
            half_width = 0.5 / zoom
            session.map.view = MapView(
                center=type(center)(
                    x=max(half_width, min(1 - half_width, _clamp_or_default(center.x))),
                    y=max(half_width, min(1 - half_width, _clamp_or_default(center.y))),
                ),
                zoom=zoom,
                rotation=rotation,
            )

        return await self.mutate_session(session_id, mutator)

    async def add_token(self, session_id: str, payload: TokenCreateRequest) -> Token:
        def mutator(session: SessionState) -> Token:
            token = Token(
                id=uuid4().hex,
                name=payload.name,
                kind=payload.kind,
                color=payload.color,
                x=_clamp_or_default(payload.x),
                y=_clamp_or_default(payload.y),
                visible=payload.visible,
                notes=payload.notes,
                stats=payload.stats,
            )
            session.tokens.append(token)
            session.token_order.append(token.id)
            return token

        token_box: Dict[str, Token] = {}

        def capture(session: SessionState) -> None:
            token_box["value"] = mutator(session)

        await self.mutate_session(session_id, capture)
        return token_box["value"]

    async def update_token(self, session_id: str, token_id: str, payload: TokenUpdateRequest) -> Token:
        def mutator(session: SessionState) -> None:
            for token in session.tokens:
                if token.id == token_id:
                    if payload.name is not None:
                        token.name = payload.name
                    if payload.kind is not None:
                        token.kind = payload.kind
                    if payload.color is not None:
                        token.color = payload.color
                    if payload.x is not None:
                        token.x = _clamp_or_default(payload.x, default=token.x)
                    if payload.y is not None:
                        token.y = _clamp_or_default(payload.y, default=token.y)
                    if payload.visible is not None:
                        token.visible = payload.visible
                    if payload.notes is not None:
                        token.notes = payload.notes
                    if payload.stats is not None:
                        merged = token.stats.model_dump()
                        merged.update({k: v for k, v in payload.stats.model_dump(exclude_unset=True).items() if v is not None})
                        token.stats = TokenStats(**merged)
                    token_box["value"] = token
                    return
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Token not found")

        token_box: Dict[str, Token] = {}
        await self.mutate_session(session_id, mutator)
        return token_box["value"]

    async def delete_token(self, session_id: str, token_id: str) -> SessionState:
        def mutator(session: SessionState) -> None:
            session.tokens = [token for token in session.tokens if token.id != token_id]
            session.token_order = [tid for tid in session.token_order if tid != token_id]

        return await self.mutate_session(session_id, mutator)

    async def set_token_order(self, session_id: str, payload: TokenOrderUpdateRequest) -> SessionState:
        def mutator(session: SessionState) -> None:
            desired = payload.order
            id_to_token: Dict[str, Token] = {token.id: token for token in session.tokens}
            ordered: List[Token] = []
            seen: List[str] = []
            for token_id in desired:
                token = id_to_token.pop(token_id, None)
                if not token:
                    continue
                ordered.append(token)
                seen.append(token_id)
            remaining = list(id_to_token.values())
            ordered.extend(remaining)
            session.tokens = ordered
            session.token_order = seen + [token.id for token in remaining]

        return await self.mutate_session(session_id, mutator)

    async def add_preset(self, session_id: str, payload: PresetCreateRequest) -> TokenPreset:
        preset_box: Dict[str, TokenPreset] = {}

        def mutator(session: SessionState) -> None:
            preset = TokenPreset(
                id=uuid4().hex,
                name=payload.name,
                kind=payload.kind,
                color=payload.color,
                stats=payload.stats,
                notes=payload.notes,
            )
            session.presets.append(preset)
            preset_box["value"] = preset

        await self.mutate_session(session_id, mutator)
        return preset_box["value"]

    async def update_preset(self, session_id: str, preset_id: str, payload: PresetUpdateRequest) -> TokenPreset:
        preset_box: Dict[str, TokenPreset] = {}

        def mutator(session: SessionState) -> None:
            for preset in session.presets:
                if preset.id == preset_id:
                    if payload.name is not None:
                        preset.name = payload.name
                    if payload.kind is not None:
                        preset.kind = payload.kind
                    if payload.color is not None:
                        preset.color = payload.color
                    if payload.notes is not None:
                        preset.notes = payload.notes
                    if payload.stats is not None:
                        merged = preset.stats.model_dump()
                        merged.update(
                            {
                                k: v
                                for k, v in payload.stats.model_dump(exclude_unset=True).items()
                                if v is not None
                            }
                        )
                        preset.stats = TokenStats(**merged)
                    preset_box["value"] = preset
                    return
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Preset not found")

        await self.mutate_session(session_id, mutator)
        return preset_box["value"]

    async def delete_preset(self, session_id: str, preset_id: str) -> SessionState:
        def mutator(session: SessionState) -> None:
            session.presets = [preset for preset in session.presets if preset.id != preset_id]

        return await self.mutate_session(session_id, mutator)

    def _sync_token_order(self, session: SessionState) -> None:
        if not session.tokens:
            session.token_order = []
            return

        id_to_token: Dict[str, Token] = {token.id: token for token in session.tokens}
        ordered: List[Token] = []
        seen: List[str] = []
        for token_id in session.token_order:
            token = id_to_token.pop(token_id, None)
            if token is None:
                continue
            ordered.append(token)
            seen.append(token_id)
        remaining = list(id_to_token.values())
        ordered.extend(remaining)
        session.tokens = ordered
        session.token_order = seen + [token.id for token in remaining]
