import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createSession } from '../lib/api';
import { buildSessionPath, extractSessionId } from '../lib/session';

const LandingView = () => {
  const navigate = useNavigate();
  const [sessionName, setSessionName] = useState('');
  const [creating, setCreating] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const session = await createSession({ name: sessionName || undefined });
      navigate(`/dm/${buildSessionPath(session.id, session.name)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const handleJoin = (role: 'dm' | 'projector') => {
    const trimmed = joinCode.trim();
    if (!trimmed) return;
    const id = extractSessionId(trimmed);
    if (!id) return;
    const remainder = trimmed.slice(id.length).replace(/^[-\s]+/, '');
    const path = buildSessionPath(id, remainder || undefined);
    navigate(`/${role}/${path}`);
  };

  return (
    <main className="landing">
      <section className="hero">
        <div>
          <p className="eyebrow">Projector-ready</p>
          <h1>
            Bring your battle maps to the table <span>with live control</span>
          </h1>
          <p>
            Create a DM session, warp the surface to match your physical table, and keep every
            creature&apos;s stats in sync with the projection client.
          </p>
          <div className="hero-actions">
            <input
              type="text"
              placeholder="Optional session name"
              value={sessionName}
              onChange={(event) => setSessionName(event.target.value)}
            />
            <button onClick={handleCreate} disabled={creating}>
              {creating ? 'Creating…' : 'Start a DM session'}
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </div>
      </section>
      <section className="join-panel">
        <h2>Join an existing session</h2>
        <div className="join-row">
          <input
            type="text"
            placeholder="Session code (e.g. ABC123)"
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value)}
          />
          <button className="ghost" onClick={() => handleJoin('dm')}>
            DM view
          </button>
          <button onClick={() => handleJoin('projector')}>Projector view</button>
        </div>
        <p className="muted">Share the session code with your projector client.</p>
      </section>
    </main>
  );
};

export default LandingView;
