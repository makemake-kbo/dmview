# DM Projection Surface

Super quick notes for getting both halves of the app running locally.

## Client (React/Vite)

```bash
cd client
npm install          # only needed once
npm run dev          # starts Vite on http://localhost:5173
```

## Server (FastAPI)

```bash
cd server
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

That gives you a REST/WebSocket API on `http://localhost:8000` and the client on `http://localhost:5173`. Point the client env vars (or proxy settings) at the server port if needed.
