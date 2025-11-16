# DM Projection Surface
<img width="3383" height="1368" alt="image" src="https://github.com/user-attachments/assets/3475e870-f53e-49fa-a5a2-d3212c25e40c" />

Make DMing easier and give your players an interactive map they can refrance

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
