import type { ButtonHTMLAttributes, FormEvent, KeyboardEvent } from 'react';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Token, TokenKind, TokenPreset } from '../types';

export type TokenFormValues = {
  name: string;
  kind: TokenKind;
  color: string;
  hp: string;
  maxHp: string;
  initiative: string;
};

export type CharacterFormValues = TokenFormValues & {
  notes: string;
  visible: boolean;
  spellSlots: Record<number, string>;
};

type TokenUpdatePayload = TokenFormValues & {
  notes: string;
  visible: boolean;
  spellSlots: Record<number, string>;
};

interface TokenSidebarProps {
  tokens: Token[];
  presets: TokenPreset[];
  selectedTokenId?: string | null;
  onSelectToken(id: string | null): void;
  onReorderTokens(order: string[]): void;
  onSpawnFromPreset(presetId: string): void;
  onToggleVisibility(token: Token): void;
  onDeleteToken(tokenId: string): void;
  onUpdateToken(tokenId: string, payload: TokenUpdatePayload): void;
  onCreatePreset(values: CharacterFormValues): Promise<void>;
  onCreateOneOff(values: CharacterFormValues): Promise<void>;
  onDeletePreset(presetId: string): Promise<void>;
}

const slotLevels = [1, 2, 3, 4, 5, 6, 7, 8, 9];

const normalizePresetName = (value: string) => value.trim().toLowerCase();

const findPresetByName = (presets: TokenPreset[], name: string) => {
  const normalized = normalizePresetName(name);
  if (!normalized) return null;
  return presets.find((preset) => normalizePresetName(preset.name) === normalized) ?? null;
};

const createCreatorDefaults = (): CharacterFormValues => ({
  name: '',
  kind: 'pc',
  color: '#38bdf8',
  hp: '',
  maxHp: '',
  initiative: '',
  notes: '',
  visible: true,
  spellSlots: slotLevels.reduce<Record<number, string>>((acc, level) => {
    acc[level] = '';
    return acc;
  }, {}),
});

const TokenSidebar = ({
  tokens,
  presets,
  selectedTokenId,
  onSelectToken,
  onReorderTokens,
  onSpawnFromPreset,
  onToggleVisibility,
  onDeleteToken,
  onUpdateToken,
  onCreatePreset,
  onCreateOneOff,
  onDeletePreset,
}: TokenSidebarProps) => {
  const [selectedPresetId, setSelectedPresetId] = useState<string>('');
  const [isCreatorOpen, setCreatorOpen] = useState(false);
  const [tokenOrder, setTokenOrder] = useState<string[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [detailPresetOverwrite, setDetailPresetOverwrite] = useState<{
    tokenId: string;
    target: TokenPreset;
    values: CharacterFormValues;
  } | null>(null);
  const [detailPresetSavingId, setDetailPresetSavingId] = useState<string | null>(null);
  const [detailPresetError, setDetailPresetError] = useState<{ tokenId: string; message: string } | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const dragLocked = Boolean(selectedTokenId);

  useEffect(() => {
    if (selectedPresetId && presets.some((preset) => preset.id === selectedPresetId)) {
      return;
    }
    setSelectedPresetId(presets[0]?.id ?? '');
  }, [presets, selectedPresetId]);

  useEffect(() => {
    if (tokens.length === 0) {
      setTokenOrder((prev) => (prev.length === 0 ? prev : []));
      return;
    }

    const incomingIds = tokens.map((token) => token.id);
    setTokenOrder((prev) => {
      if (prev.length === 0) return incomingIds;
      const persisted = prev.filter((id) => incomingIds.includes(id));
      const newOnes = incomingIds.filter((id) => !persisted.includes(id));
      const next = [...persisted, ...newOnes];
      if (next.length === prev.length && next.every((id, index) => id === prev[index])) {
        return prev;
      }
      return next;
    });
  }, [tokens]);

  const orderedTokens = useMemo(() => {
    if (tokens.length === 0) return [];
    const lookup = new Map(tokens.map((token) => [token.id, token]));
    const arranged = tokenOrder
      .map((id) => lookup.get(id))
      .filter((token): token is Token => Boolean(token));
    const extras = tokens.filter((token) => !tokenOrder.includes(token.id));
    return [...arranged, ...extras];
  }, [tokenOrder, tokens]);

  const handleSpawnPreset = () => {
    if (!selectedPresetId) return;
    onSpawnFromPreset(selectedPresetId);
  };

  const handleCardSelect = (tokenId: string) => {
    onSelectToken(tokenId);
  };

  const handleDragStart = (event: DragStartEvent) => {
    if (dragLocked) return;
    setDraggingId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setDraggingId(null);
    if (!over || active.id === over.id || dragLocked) return;

    const from = tokenOrder.indexOf(active.id as string);
    const to = tokenOrder.indexOf(over.id as string);
    if (from === -1 || to === -1) return;
    const next = arrayMove(tokenOrder, from, to);
    setTokenOrder(next);
    onReorderTokens(next);
  };

  const handleDragCancel = () => {
    setDraggingId(null);
  };

  const activeToken = draggingId ? tokens.find((token) => token.id === draggingId) : null;
  const handleCollapse = () => onSelectToken(null);
  const appliedSensors = dragLocked ? [] : sensors;

  const commitDetailPreset = async (tokenId: string, values: CharacterFormValues, overwriteId?: string) => {
    setDetailPresetError(null);
    setDetailPresetOverwrite(null);
    setDetailPresetSavingId(tokenId);
    try {
      if (overwriteId) {
        await onDeletePreset(overwriteId);
      }
      await onCreatePreset(values);
    } catch (err) {
      setDetailPresetError({
        tokenId,
        message: err instanceof Error ? err.message : 'Unable to save preset.',
      });
    } finally {
      setDetailPresetSavingId(null);
    }
  };

  const handleSavePresetFromDetails = (tokenId: string, values: CharacterFormValues) => {
    if (!values.name.trim()) {
      setDetailPresetError({ tokenId, message: 'A name is required to create a preset.' });
      return;
    }
    setDetailPresetError(null);
    const existing = findPresetByName(presets, values.name);
    if (existing) {
      setDetailPresetOverwrite({ tokenId, target: existing, values });
      return;
    }
    void commitDetailPreset(tokenId, values);
  };

  const handleConfirmDetailOverwrite = () => {
    if (!detailPresetOverwrite) return;
    const { tokenId, values, target } = detailPresetOverwrite;
    setDetailPresetOverwrite(null);
    void commitDetailPreset(tokenId, values, target.id);
  };

  const handleCancelDetailOverwrite = () => {
    setDetailPresetOverwrite(null);
  };

  const handleClearDetailPresetError = (tokenId: string) => {
    setDetailPresetError((prev) => {
      if (prev?.tokenId === tokenId) {
        return null;
      }
      return prev;
    });
  };

  return (
    <>
      <aside className="token-sidebar">
        <div className="panel preset-spawner">
          <div className="spawner-header">
            <div>
            <p className="eyebrow">Spawn character</p>
            <h2>Session presets</h2>
          </div>
          <button type="button" className="ghost" onClick={() => setCreatorOpen(true)}>
            New character
          </button>
        </div>
        <label>
          Choose preset
          <select
            value={selectedPresetId}
            onChange={(event) => setSelectedPresetId(event.target.value)}
            disabled={presets.length === 0}
          >
            {presets.length === 0 ? (
              <option value="">No presets saved</option>
            ) : (
              presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name} — {preset.kind.toUpperCase()}
                </option>
              ))
            )}
          </select>
        </label>
        <div className="preset-actions">
          <button type="button" onClick={handleSpawnPreset} disabled={!selectedPresetId}>
            Add to map
          </button>
          <button type="button" className="ghost" onClick={() => setCreatorOpen(true)}>
            Manage presets
          </button>
        </div>
      </div>

      <div className="token-board">
        <div className="token-list__header">
          <h3>Active tokens</h3>
          <p className="muted small">{tokens.length} on board</p>
        </div>
        {tokens.length === 0 ? (
          <p className="muted">No tokens yet.</p>
        ) : (
          <DndContext
            sensors={appliedSensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <SortableContext items={orderedTokens.map((token) => token.id)} strategy={rectSortingStrategy}>
              <div className="token-grid">
                {orderedTokens.map((token) => (
                  <SortableTokenCard
                    key={token.id}
                    token={token}
                    selected={token.id === selectedTokenId}
                    draggingId={draggingId}
                    onSelect={() => handleCardSelect(token.id)}
                    onCollapse={handleCollapse}
                    onToggleVisibility={() => onToggleVisibility(token)}
                    onDelete={() => onDeleteToken(token.id)}
                    onUpdate={(payload) => onUpdateToken(token.id, payload)}
                    onSavePreset={(values) => handleSavePresetFromDetails(token.id, values)}
                    onClearPresetError={() => handleClearDetailPresetError(token.id)}
                    presetSaving={detailPresetSavingId === token.id}
                    presetError={detailPresetError?.tokenId === token.id ? detailPresetError.message : null}
                    disableDragging={dragLocked}
                  />
                ))}
              </div>
            </SortableContext>
            <DragOverlay>
              {activeToken ? (
                <TokenCardPreview token={activeToken} selected={activeToken.id === selectedTokenId} />
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>

        {isCreatorOpen && (
          <CharacterModal
            presets={presets}
            onClose={() => setCreatorOpen(false)}
            onCreatePreset={onCreatePreset}
            onCreateOneOff={onCreateOneOff}
            onDeletePreset={onDeletePreset}
          />
        )}
      </aside>
      {detailPresetOverwrite && (
        <div className="confirm-overlay">
          <div className="confirm-modal">
            <h4>Overwrite preset?</h4>
            <p>
              A preset named <strong>{detailPresetOverwrite.target.name}</strong> already exists. Overwrite
              it with the selected character?
            </p>
            <div className="confirm-actions">
              <button type="button" className="ghost" onClick={handleCancelDetailOverwrite}>
                Cancel
              </button>
              <button type="button" onClick={handleConfirmDetailOverwrite}>
                Overwrite
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

const CharacterModal = ({
  presets,
  onClose,
  onCreatePreset,
  onCreateOneOff,
  onDeletePreset,
}: {
  presets: TokenPreset[];
  onClose(): void;
  onCreatePreset(values: CharacterFormValues): Promise<void>;
  onCreateOneOff(values: CharacterFormValues): Promise<void>;
  onDeletePreset(presetId: string): Promise<void>;
}) => {
  const [values, setValues] = useState<CharacterFormValues>(createCreatorDefaults);
  const [submitting, setSubmitting] = useState<'preset' | 'oneoff' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overwriteTarget, setOverwriteTarget] = useState<TokenPreset | null>(null);

  const presetMatchesFormName = () => findPresetByName(presets, values.name);

  const presetToFormValues = (preset: TokenPreset, visible: boolean): CharacterFormValues => ({
    name: preset.name,
    kind: preset.kind,
    color: preset.color,
    hp: preset.stats?.hp != null ? preset.stats.hp.toString() : '',
    maxHp: preset.stats?.max_hp != null ? preset.stats.max_hp.toString() : '',
    initiative: preset.stats?.initiative != null ? preset.stats.initiative.toString() : '',
    notes: preset.notes ?? '',
    visible,
    spellSlots: slotLevels.reduce<Record<number, string>>((acc, level) => {
      const key = String(level);
      const amount = preset.stats?.spell_slots?.[key];
      acc[level] = amount ? amount.toString() : '';
      return acc;
    }, {}),
  });

  const handleAction = async (action: 'preset' | 'oneoff', options?: { overwriteId?: string }) => {
    if (!values.name.trim()) {
      setError('Name is required.');
      return;
    }

    if (action === 'preset' && !options?.overwriteId) {
      const match = presetMatchesFormName();
      if (match) {
        setOverwriteTarget(match);
        return;
      }
    }

    setSubmitting(action);
    setError(null);
    try {
      if (action === 'preset') {
        if (options?.overwriteId) {
          await onDeletePreset(options.overwriteId);
        }
        await onCreatePreset(values);
      } else {
        await onCreateOneOff(values);
      }
      setValues(createCreatorDefaults());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save character.');
    } finally {
      setSubmitting(null);
    }
  };

  const handleLoadPreset = (preset: TokenPreset) => {
    setValues((prev) => presetToFormValues(preset, prev.visible));
  };

  const handleConfirmOverwrite = () => {
    if (!overwriteTarget) return;
    const targetId = overwriteTarget.id;
    setOverwriteTarget(null);
    void handleAction('preset', { overwriteId: targetId });
  };

  const handleCancelOverwrite = () => {
    setOverwriteTarget(null);
  };

  const handleDelete = async (presetId: string) => {
    setSubmitting('delete');
    setError(null);
    try {
      await onDeletePreset(presetId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove preset.');
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <>
      <div className="modal-overlay">
        <div className="modal">
        <header className="modal-header">
          <div>
            <p className="eyebrow">Character library</p>
            <h2>Prep a hero or foe</h2>
            <p className="muted small">
              Save presets for recurring NPCs or drop a one-off directly on the battlefield.
            </p>
          </div>
          <button type="button" className="ghost" onClick={onClose}>
            Close
          </button>
        </header>
        {error && <p className="error">{error}</p>}
        <div className="modal-body">
          <section className="modal-section">
            <h3>Create character</h3>
            <div className="token-form">
              <label>
                Name
                <input
                  type="text"
                  maxLength={40}
                  value={values.name}
                  onChange={(event) => setValues((prev) => ({ ...prev, name: event.target.value }))}
                />
              </label>
              <label>
                Type
                <select
                  value={values.kind}
                  onChange={(event) =>
                    setValues((prev) => ({ ...prev, kind: event.target.value as TokenKind }))
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
                  onChange={(event) =>
                    setValues((prev) => ({ ...prev, visible: event.target.checked }))
                  }
                />
                Visible to projector
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
                        placeholder="0"
                        value={values.spellSlots[level] ?? ''}
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
              <div className="token-details__actions stacked">
                <button type="button" className="ghost" disabled={submitting === 'preset'} onClick={() => handleAction('preset')}>
                  {submitting === 'preset' ? 'Saving…' : 'Save as preset'}
                </button>
                <button type="button" disabled={submitting === 'oneoff'} onClick={() => handleAction('oneoff')}>
                  {submitting === 'oneoff' ? 'Placing…' : 'Create one-off'}
                </button>
              </div>
            </div>
          </section>
          <section className="modal-section">
            <div className="preset-listing">
              <h3>Saved presets</h3>
              {presets.length > 0 && <p className="muted small">Click a preset to load it into the form.</p>}
              {presets.length === 0 ? (
                <p className="muted small">No presets yet—save one from the form on the left.</p>
              ) : (
                <ul>
                  {presets.map((preset) => (
                    <li key={preset.id} className="preset-item">
                      <button
                        type="button"
                        className="preset-item__content"
                        onClick={() => handleLoadPreset(preset)}
                      >
                        <strong>{preset.name}</strong>
                        <p className="muted small">
                          {preset.kind.toUpperCase()} •{' '}
                          {preset.stats.hp != null && preset.stats.max_hp != null
                            ? `${preset.stats.hp}/${preset.stats.max_hp} HP`
                            : 'HP TBD'}
                        </p>
                      </button>
                      <button
                        type="button"
                        className="danger"
                        disabled={submitting === 'delete'}
                        onClick={() => handleDelete(preset.id)}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
      {overwriteTarget && (
        <div className="confirm-overlay">
          <div className="confirm-modal">
            <h4>Overwrite preset?</h4>
            <p>
              A preset named <strong>{overwriteTarget.name}</strong> already exists. Overwrite it with the
              current values?
            </p>
            <div className="confirm-actions">
              <button type="button" className="ghost" onClick={handleCancelOverwrite}>
                Cancel
              </button>
              <button type="button" onClick={handleConfirmOverwrite}>
                Overwrite
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

type SortableTokenCardProps = {
  token: Token;
  selected: boolean;
  draggingId: string | null;
  onSelect(): void;
  onCollapse(): void;
  onToggleVisibility(): void;
  onDelete(): void;
  onUpdate(payload: TokenUpdatePayload): void;
  onSavePreset(values: CharacterFormValues): void;
  onClearPresetError(): void;
  presetSaving: boolean;
  presetError?: string | null;
  disableDragging: boolean;
};

const SortableTokenCard = ({
  token,
  selected,
  draggingId,
  onSelect,
  onCollapse,
  onToggleVisibility,
  onDelete,
  onUpdate,
  onSavePreset,
  onClearPresetError,
  presetSaving,
  presetError,
  disableDragging,
}: SortableTokenCardProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: token.id,
    disabled: disableDragging,
  });

  const style = {
    transform: transform ? CSS.Transform.toString(transform) : undefined,
    transition,
  };

  const dragHandleProps = {
    ...attributes,
    ...listeners,
    disabled: disableDragging,
  } as ButtonHTMLAttributes<HTMLButtonElement>;

  return (
    <div
      ref={setNodeRef}
      className={`token-card-wrapper ${selected ? 'is-selected' : ''}`}
      style={style}
      data-token-id={token.id}
    >
      <TokenCardContent
        token={token}
        selected={selected}
        dragging={Boolean(draggingId === token.id || isDragging)}
        onSelect={onSelect}
        onCollapse={onCollapse}
        onToggleVisibility={onToggleVisibility}
        onDelete={onDelete}
        onUpdate={onUpdate}
        onSavePresetFromDetails={onSavePreset}
        onClearPresetError={onClearPresetError}
        presetSaving={presetSaving}
        presetError={presetError}
        showDetails={selected}
        dragDisabled={disableDragging}
        dragHandleProps={dragHandleProps}
      />
    </div>
  );
};

const TokenCardPreview = ({ token, selected }: { token: Token; selected: boolean }) => (
  <TokenCardContent
    token={token}
    selected={selected}
    dragging
    interactive={false}
    showDetails={false}
    dragDisabled={false}
  />
);

type TokenCardContentProps = {
  token: Token;
  selected: boolean;
  dragging: boolean;
  showDetails?: boolean;
  interactive?: boolean;
  dragDisabled: boolean;
  dragHandleProps?: ButtonHTMLAttributes<HTMLButtonElement>;
  onSelect?(): void;
  onCollapse?(): void;
  onToggleVisibility?(): void;
  onDelete?(): void;
  onUpdate?(payload: TokenUpdatePayload): void;
  onSavePresetFromDetails?(values: CharacterFormValues): void;
  onClearPresetError?(): void;
  presetSaving?: boolean;
  presetError?: string | null;
};

const TokenCardContent = ({
  token,
  selected,
  dragging,
  showDetails = false,
  interactive = true,
  dragDisabled,
  dragHandleProps,
  onSelect,
  onCollapse,
  onToggleVisibility,
  onDelete,
  onUpdate,
  onSavePresetFromDetails,
  onClearPresetError,
  presetSaving = false,
  presetError,
}: TokenCardContentProps) => {
  const detailsRef = useRef<TokenDetailsHandle>(null);
  const slotEntries = getSpellSlotEntries(token);
  const hpDisplay = formatHpRange(token);
  const initiativeDisplay = token.stats?.initiative ?? '—';
  const hideLabel = selected ? 'Hide from players' : 'Hide';
  const removeLabel = selected ? 'Remove from map' : 'Remove';

  const handleToggleDetails = () => {
    if (!interactive) return;
    if (selected) {
      onCollapse?.();
    } else {
      onSelect?.();
    }
  };

  const handleSavePresetClick = () => {
    if (!interactive || !onSavePresetFromDetails) return;
    const currentValues = detailsRef.current?.getCurrentValues();
    if (!currentValues) return;
    onSavePresetFromDetails(currentValues);
  };

  const handleSummaryKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!interactive) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleToggleDetails();
    }
  };

  return (
    <div className={`token-card ${selected ? 'selected' : ''} ${dragging ? 'dragging' : ''}`}>
      <div className="token-card__header">
        {dragHandleProps ? (
          <button
            type="button"
            className={`token-card__drag-handle ${dragDisabled ? 'is-disabled' : ''}`}
            aria-label="Reorder token"
            {...dragHandleProps}
          >
            <span aria-hidden>⠿</span>
          </button>
        ) : (
          <div className="token-card__drag-handle" aria-hidden="true">
            <span>⠿</span>
          </div>
        )}
        <div className="token-card__identity-row">
          <button type="button" className="token-card__identity" onClick={handleToggleDetails} disabled={!interactive}>
            <span className="token-card__dot" style={{ background: token.color }} />
            <div className="token-card__meta">
              <strong>{token.name}</strong>
              <small>{token.kind.toUpperCase()}</small>
            </div>
          </button>
          {interactive && selected && (
            <div className="token-card__toggle-group">
              {onCollapse && (
                <button type="button" className="ghost small token-card__toggle" onClick={onCollapse}>
                  Collapse
                </button>
              )}
              {showDetails && onSavePresetFromDetails && (
                <button
                  type="button"
                  className="small token-card__toggle"
                  onClick={handleSavePresetClick}
                  disabled={presetSaving}
                >
                  {presetSaving ? 'Saving…' : 'Create preset'}
                </button>
              )}
            </div>
          )}
        </div>
        {interactive && (
          <div className="token-card__header-actions">
            <button type="button" className="ghost small" onClick={() => onToggleVisibility?.()}>
              {token.visible ? hideLabel : 'Show'}
            </button>
            <button type="button" className="danger small" onClick={() => onDelete?.()}>
              {removeLabel}
            </button>
          </div>
        )}
      </div>
      <div
        className="token-card__summary-block"
        role={interactive ? 'button' : undefined}
        tabIndex={interactive ? 0 : -1}
        onClick={handleToggleDetails}
        onKeyDown={handleSummaryKeyDown}
      >
        <div className="token-card__stat">
          <span>HP</span>
          <strong>{hpDisplay}</strong>
        </div>
        <div className="token-card__stat">
          <span>Initiative</span>
          <strong>{initiativeDisplay}</strong>
        </div>
      </div>
      <div className="token-card__spells">
        <span>Spell slots:</span>
        {slotEntries.length === 0 ? (
          <p className="token-card__empty">—</p>
        ) : (
          <div className="token-card__slots">
            {slotEntries.map(({ level, amount }) => (
              <span key={level}>
                L{level} <strong>{amount}</strong>
              </span>
            ))}
          </div>
        )}
      </div>
      {showDetails && interactive && onUpdate && (
        <div className="token-card__details">
          <TokenDetails
            ref={detailsRef}
            token={token}
            onUpdate={onUpdate}
            presetError={presetError}
            onClearPresetError={onClearPresetError}
          />
        </div>
      )}
    </div>
  );
};

const formatHpRange = (token: Token) => {
  const hp = token.stats?.hp;
  const maxHp = token.stats?.max_hp;
  if (hp === undefined && maxHp === undefined) return '—';
  const hpDisplay = hp === undefined ? '—' : hp;
  const maxDisplay = maxHp === undefined ? '—' : maxHp;
  return `${hpDisplay}/${maxDisplay}`;
};

const getSpellSlotEntries = (token: Token) => {
  if (!token.stats?.spell_slots) return [];
  return Object.entries(token.stats.spell_slots)
    .map(([level, amount]) => ({
      level: Number(level),
      amount: typeof amount === 'number' ? amount : Number(amount),
    }))
    .filter(({ amount }) => !Number.isNaN(amount) && amount > 0)
    .sort((a, b) => a.level - b.level);
};

type TokenDetailsProps = {
  token: Token;
  onUpdate(payload: TokenUpdatePayload): void;
  presetError?: string | null;
  onClearPresetError?(): void;
};

type TokenDetailsHandle = {
  getCurrentValues(): CharacterFormValues;
};

const TokenDetails = forwardRef<TokenDetailsHandle, TokenDetailsProps>(
  ({ token, onUpdate, presetError, onClearPresetError }, ref) => {
    const [values, setValues] = useState<CharacterFormValues>(() => createDetailState(token));

    useImperativeHandle(
      ref,
      () => ({
        getCurrentValues: () => ({
          ...values,
          spellSlots: { ...values.spellSlots },
        }),
      }),
      [values],
    );

    useEffect(() => {
      onClearPresetError?.();
      setValues(createDetailState(token));
    }, [token.id, onClearPresetError]);

    const updateValues = (updater: (prev: CharacterFormValues) => CharacterFormValues) => {
      onClearPresetError?.();
      setValues((prev) => updater(prev));
    };

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
            onChange={(event) => updateValues((prev) => ({ ...prev, name: event.target.value }))}
          />
        </label>
        <label>
          Type
          <select
            value={values.kind}
            onChange={(event) =>
              updateValues((prev) => ({ ...prev, kind: event.target.value as TokenKind }))
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
            value={values.color}
            onChange={(event) => updateValues((prev) => ({ ...prev, color: event.target.value }))}
          />
        </label>
        <div className="form-grid">
          <label>
            HP
            <input
              type="number"
              value={values.hp}
              onChange={(event) => updateValues((prev) => ({ ...prev, hp: event.target.value }))}
            />
          </label>
          <label>
            Max HP
            <input
              type="number"
              value={values.maxHp}
              onChange={(event) => updateValues((prev) => ({ ...prev, maxHp: event.target.value }))}
            />
          </label>
          <label>
            Initiative
            <input
              type="number"
              value={values.initiative}
              onChange={(event) =>
                updateValues((prev) => ({ ...prev, initiative: event.target.value }))
              }
            />
          </label>
        </div>
        <label>
          Notes
          <textarea
            rows={3}
            value={values.notes}
            onChange={(event) => updateValues((prev) => ({ ...prev, notes: event.target.value }))}
          />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={values.visible}
            onChange={(event) =>
              updateValues((prev) => ({ ...prev, visible: event.target.checked }))
            }
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
                    updateValues((prev) => ({
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
          <button type="button" className="ghost" onClick={() => updateValues(() => createDetailState(token))}>
            Reset
          </button>
          <button type="submit">Save</button>
        </div>
        {presetError && <p className="error token-details__error">{presetError}</p>}
      </form>
    );
  },
);

const createDetailState = (token: Token): CharacterFormValues => ({
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
