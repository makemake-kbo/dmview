from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Dict, Set

from fastapi import (
    FastAPI,
    File,
    Request,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .models import (
    MapUrlRequest,
    SessionCreateRequest,
    SessionState,
    TokenCreateRequest,
    TokenUpdateRequest,
    WarpUpdateRequest,
)
from .state import SessionManager

app = FastAPI(title="DM Projection Surface API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

sessions = SessionManager()


class WebSocketManager:
    def __init__(self) -> None:
        self._connections: Dict[str, Set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, session_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections.setdefault(session_id, set()).add(websocket)

    async def disconnect(self, session_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            conns = self._connections.get(session_id)
            if conns and websocket in conns:
                conns.remove(websocket)
            if conns and len(conns) == 0:
                self._connections.pop(session_id, None)

    async def broadcast_state(self, session_id: str, state: SessionState) -> None:
        async with self._lock:
            targets = list(self._connections.get(session_id, set()))
        payload = {"type": "state", "payload": jsonable_encoder(state)}
        to_drop: list[WebSocket] = []
        for connection in targets:
            try:
                await connection.send_json(payload)
            except RuntimeError:
                to_drop.append(connection)
        for conn in to_drop:
            await self.disconnect(session_id, conn)

    async def send_state(self, session_id: str, websocket: WebSocket, state: SessionState) -> None:
        payload = {"type": "state", "payload": jsonable_encoder(state)}
        await websocket.send_json(payload)


ws_manager = WebSocketManager()


@app.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/api/sessions", response_model=SessionState)
async def create_session(payload: SessionCreateRequest) -> SessionState:
    session = await sessions.create_session(payload)
    return session


@app.get("/api/sessions/{session_id}", response_model=SessionState)
async def read_session(session_id: str) -> SessionState:
    return await sessions.require_session(session_id)


def _normalize_session_id(session_id: str) -> str:
    return session_id.upper()


async def _broadcast(session_id: str, state: SessionState) -> SessionState:
    await ws_manager.broadcast_state(_normalize_session_id(session_id), state)
    return state


@app.post("/api/sessions/{session_id}/map/url", response_model=SessionState)
async def set_map_url(session_id: str, payload: MapUrlRequest) -> SessionState:
    normalized = _normalize_session_id(session_id)
    state = await sessions.set_map_url(normalized, payload)
    return await _broadcast(normalized, state)


@app.post("/api/sessions/{session_id}/map/upload", response_model=SessionState)
async def upload_map(session_id: str, request: Request, file: UploadFile = File(...)) -> SessionState:
    normalized = _normalize_session_id(session_id)
    session = await sessions.require_session(normalized)
    session_folder = UPLOAD_DIR / session.id
    session_folder.mkdir(parents=True, exist_ok=True)
    suffix = Path(file.filename).suffix or ".png"
    safe_name = f"map{suffix}"
    destination = session_folder / safe_name
    with destination.open("wb") as buffer:
        while chunk := await file.read(1024 * 1024):
            buffer.write(chunk)
    relative_path = f"{session.id}/{safe_name}"
    url = str(request.url_for("uploads", path=relative_path))
    state = await sessions.set_map_image(normalized, url)
    return await _broadcast(normalized, state)


@app.post("/api/sessions/{session_id}/warp", response_model=SessionState)
async def update_warp(session_id: str, payload: WarpUpdateRequest) -> SessionState:
    normalized = _normalize_session_id(session_id)
    state = await sessions.set_warp(normalized, payload.warp)
    return await _broadcast(normalized, state)


@app.post("/api/sessions/{session_id}/tokens", response_model=SessionState)
async def create_token(session_id: str, payload: TokenCreateRequest) -> SessionState:
    normalized = _normalize_session_id(session_id)
    await sessions.add_token(normalized, payload)
    state = await sessions.require_session(normalized)
    return await _broadcast(normalized, state)


@app.put("/api/sessions/{session_id}/tokens/{token_id}", response_model=SessionState)
async def update_token(session_id: str, token_id: str, payload: TokenUpdateRequest) -> SessionState:
    normalized = _normalize_session_id(session_id)
    await sessions.update_token(normalized, token_id, payload)
    state = await sessions.require_session(normalized)
    return await _broadcast(normalized, state)


@app.delete("/api/sessions/{session_id}/tokens/{token_id}", response_model=SessionState)
async def delete_token(session_id: str, token_id: str) -> SessionState:
    normalized = _normalize_session_id(session_id)
    await sessions.delete_token(normalized, token_id)
    state = await sessions.require_session(normalized)
    return await _broadcast(normalized, state)


@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str) -> None:
    try:
        session = await sessions.require_session(session_id)
    except Exception:
        await websocket.close(code=4404)
        return

    normalized = session.id

    await ws_manager.connect(normalized, websocket)
    await ws_manager.send_state(normalized, websocket, session)

    try:
        while True:
            data = await websocket.receive_text()
            if data.strip().lower() == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        await ws_manager.disconnect(normalized, websocket)
    except RuntimeError:
        await ws_manager.disconnect(normalized, websocket)
