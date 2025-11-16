import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import type { Token, TokenKind } from '../types';

export type TokenFormValues = {
  name: string;
  kind: TokenKind;
  color: string;
  hp: string;
  maxHp: string;
  initiative: string;
};

interface TokenSidebarProps {
  tokens: Token[];
  selectedTokenId?: string | null;
  onSelectToken(id: string): void;
  onAddToken(values: TokenFormValues): void;
  onToggleVisibility(token: Token): void;
  onDeleteToken(tokenId: string): void;
  onUpdateToken(tokenId: string, payload: TokenFormValues & { notes: string; visible: boolean; spellSlots: Record<number, string> }): void;
}

const defaultForm = (): TokenFormValues => ({
  name: '',
  kind: 'pc',
  color: '#38bdf8',
  hp: '',
  maxHp: '',
  initiative: '',
});

const slotLevels = [1, 2, 3, 4, 5, 6, 7, 8, 9];

const TokenSidebar = ({
  tokens,
  selectedTokenId,
  onSelectToken,
  onAddToken,
  onToggleVisibility,
  onDeleteToken,
  onUpdateToken,
}: TokenSidebarProps) => {
  const [formValues, setFormValues] = useState<TokenFormValues>(defaultForm);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!formValues.name.trim()) return;
    onAddToken(formValues);
    setFormValues(defaultForm());
  };

  const selectedToken = tokens.find((token) => token.id === selectedTokenId) || tokens[0];

  return (
    <aside className="token-sidebar">
      <h2>Tokens</h2>
      <form className="token-form" onSubmit={handleSubmit}>
        <label>
          Name
          <input
            type="text"
            value={formValues.name}
            maxLength={40}
            onChange={(event) => setFormValues((prev) => ({ ...prev, name: event.target.value }))}
            required
          />
        </label>
        <label>
          Type
          <select
            value={formValues.kind}
            onChange={(event) =>
              setFormValues((prev) => ({ ...prev, kind: event.target.value as TokenKind }))
            }
          >
            <option value="pc">Player</option>
            <option value="npc">NPC</option>
            <option value="prop">Prop</option>
          </select>
        </label>
        <label>
          Color
          <input
            type="color"
            value={formValues.color}
            onChange={(event) => setFormValues((prev) => ({ ...prev, color: event.target.value }))}
          />
        </label>
        <div className="form-grid">
          <label>
            HP
            <input
              type="number"
              inputMode="numeric"
              value={formValues.hp}
              onChange={(event) => setFormValues((prev) => ({ ...prev, hp: event.target.value }))}
            />
          </label>
          <label>
            Max HP
            <input
              type="number"
              inputMode="numeric"
              value={formValues.maxHp}
              onChange={(event) => setFormValues((prev) => ({ ...prev, maxHp: event.target.value }))}
            />
          </label>
          <label>
            Init.
            <input
              type="number"
              inputMode="numeric"
              value={formValues.initiative}
              onChange={(event) =>
                setFormValues((prev) => ({ ...prev, initiative: event.target.value }))
              }
            />
          </label>
        </div>
        <button type="submit">Add token</button>
      </form>

      <div className="token-list">
        {tokens.length === 0 ? (
          <p className="muted">No tokens yet.</p>
        ) : (
          tokens.map((token) => (
            <div key={token.id} className={`token-row ${token.id === selectedTokenId ? 'selected' : ''}`}>
              <button className="token-row__main" onClick={() => onSelectToken(token.id)}>
                <span className="token-dot" style={{ background: token.color }} />
                <div>
                  <strong>{token.name}</strong>
                  <small>{token.kind.toUpperCase()}</small>
                </div>
              </button>
              <div className="token-row__actions">
                <button type="button" className="ghost" onClick={() => onToggleVisibility(token)}>
                  {token.visible ? 'Hide' : 'Show'}
                </button>
                <button type="button" className="danger" onClick={() => onDeleteToken(token.id)}>
                  Remove
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {selectedToken ? (
        <TokenDetails token={selectedToken} onUpdate={(payload) => onUpdateToken(selectedToken.id, payload)} />
      ) : (
        <p className="muted">Select a token to edit stats.</p>
      )}
    </aside>
  );
};

const TokenDetails = ({
  token,
  onUpdate,
}: {
  token: Token;
  onUpdate: (payload: TokenFormValues & { notes: string; visible: boolean; spellSlots: Record<number, string> }) => void;
}) => {
  const [values, setValues] = useState(() => createDetailState(token));

  useEffect(() => {
    setValues(createDetailState(token));
  }, [token.id]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onUpdate(values);
  };

  return (
    <form className="token-details" onSubmit={handleSubmit}>
      <h3>Selected: {token.name}</h3>
      <label>
        Name
        <input
          type="text"
          value={values.name}
          onChange={(event) => setValues((prev) => ({ ...prev, name: event.target.value }))}
        />
      </label>
      <label>
        Type
        <select
          value={values.kind}
          onChange={(event) => setValues((prev) => ({ ...prev, kind: event.target.value as TokenKind }))}
        >
          <option value="pc">Player</option>
          <option value="npc">NPC</option>
          <option value="prop">Prop</option>
        </select>
      </label>
      <label>
        Color
        <input
          type="color"
          value={values.color}
          onChange={(event) => setValues((prev) => ({ ...prev, color: event.target.value }))}
        />
      </label>
      <div className="form-grid">
        <label>
          HP
          <input
            type="number"
            value={values.hp}
            onChange={(event) => setValues((prev) => ({ ...prev, hp: event.target.value }))}
          />
        </label>
        <label>
          Max HP
          <input
            type="number"
            value={values.maxHp}
            onChange={(event) => setValues((prev) => ({ ...prev, maxHp: event.target.value }))}
          />
        </label>
        <label>
          Initiative
          <input
            type="number"
            value={values.initiative}
            onChange={(event) =>
              setValues((prev) => ({ ...prev, initiative: event.target.value }))
            }
          />
        </label>
      </div>
      <label>
        Notes
        <textarea
          rows={3}
          value={values.notes}
          onChange={(event) => setValues((prev) => ({ ...prev, notes: event.target.value }))}
        />
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={values.visible}
          onChange={(event) => setValues((prev) => ({ ...prev, visible: event.target.checked }))}
        />
        Visible to players
      </label>
      <div className="spell-slots">
        <span>Spell slots</span>
        <div className="slot-grid">
          {slotLevels.map((level) => (
            <label key={level}>
              L{level}
              <input
                type="number"
                min={0}
                value={values.spellSlots[level] ?? '0'}
                onChange={(event) =>
                  setValues((prev) => ({
                    ...prev,
                    spellSlots: {
                      ...prev.spellSlots,
                      [level]: event.target.value,
                    },
                  }))
                }
              />
            </label>
          ))}
        </div>
      </div>
      <div className="token-details__actions">
        <button type="button" className="ghost" onClick={() => setValues(createDetailState(token))}>
          Reset
        </button>
        <button type="submit">Save</button>
      </div>
    </form>
  );
};

const createDetailState = (token: Token) => ({
  name: token.name,
  kind: token.kind,
  color: token.color,
  hp: token.stats?.hp?.toString() ?? '',
  maxHp: token.stats?.max_hp?.toString() ?? '',
  initiative: token.stats?.initiative?.toString() ?? '',
  notes: token.notes ?? '',
  visible: token.visible,
  spellSlots: slotLevels.reduce<Record<number, string>>((acc, level) => {
    const key = String(level);
    acc[level] = token.stats?.spell_slots?.[key]?.toString() ?? '0';
    return acc;
  }, {}),
});

export default TokenSidebar;
