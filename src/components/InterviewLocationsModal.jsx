import { useState } from 'react';
import { Button, ModalShell, StatusBadge } from './ui';

const emptyLocation = { name: '', building: '', room: '', notes: '' };

function LocationFields({ value, onChange, idPrefix }) {
  const set = (key) => (event) => onChange({ ...value, [key]: event.target.value });
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="grid content-start gap-1 text-sm text-app-text sm:col-span-2" htmlFor={`${idPrefix}-name`}>
        <span className="font-semibold">Name</span>
        <input id={`${idPrefix}-name`} value={value.name} maxLength={120} onChange={set('name')} placeholder="Admissions Office Interview Room" />
      </label>
      <label className="grid content-start gap-1 text-sm text-app-text" htmlFor={`${idPrefix}-building`}>
        <span className="font-semibold">Building</span>
        <input id={`${idPrefix}-building`} value={value.building} maxLength={120} onChange={set('building')} placeholder="Jacinto campus, Finster Hall" />
      </label>
      <label className="grid content-start gap-1 text-sm text-app-text" htmlFor={`${idPrefix}-room`}>
        <span className="font-semibold">Room</span>
        <input id={`${idPrefix}-room`} value={value.room} maxLength={60} onChange={set('room')} placeholder="F213" />
      </label>
    </div>
  );
}

/**
 * Admissions Office Head: manage the venues offered for on-site interviews.
 * A venue is archived rather than deleted, and every interview keeps a copy of
 * its location label, so earlier schedules stay readable.
 */
export default function InterviewLocationsModal({ locations = [], onSave, onClose }) {
  const [draft, setDraft] = useState(emptyLocation);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(emptyLocation);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async (location, onDone) => {
    if (!String(location.name || '').trim()) {
      setError('Enter the location name.');
      return;
    }
    setBusy(true);
    setError('');
    const result = await onSave(location);
    setBusy(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    onDone?.();
  };

  const sorted = [...locations].sort((a, b) => (Number(b.isActive) - Number(a.isActive)) || a.name.localeCompare(b.name));

  return (
    <ModalShell title="Interview locations" onClose={busy ? undefined : onClose} className="w-[min(640px,100%)] max-h-[90vh] overflow-y-auto">
      <div className="grid gap-4">
        <p className="m-0 text-sm text-app-muted">These venues appear in the location dropdown for on-site interviews. Archive a venue to retire it; interviews already scheduled keep their location label.</p>

        <form
          className="grid gap-3 rounded-[14px] border border-app-border bg-app-surface p-3"
          onSubmit={(event) => {
            event.preventDefault();
            save(draft, () => setDraft(emptyLocation));
          }}
        >
          <h3 className="m-0 text-sm font-semibold text-app-text">Add a location</h3>
          <LocationFields value={draft} onChange={setDraft} idPrefix="new-location" />
          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={busy || !draft.name.trim()}>{busy && !editingId ? 'Saving…' : 'Add location'}</Button>
          </div>
        </form>

        {error ? <p className="m-0 text-sm text-rose-700 dark:text-rose-200" role="alert">{error}</p> : null}

        {sorted.length ? (
          <ul className="m-0 grid gap-2 p-0">
            {sorted.map((location) => (
              <li key={location.id} className="grid gap-2 rounded-[14px] border border-app-border bg-app-card p-3">
                {editingId === location.id ? (
                  <>
                    <LocationFields value={editDraft} onChange={setEditDraft} idPrefix={`edit-${location.id}`} />
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button type="button" disabled={busy} onClick={() => setEditingId(null)}>Cancel</Button>
                      <Button type="button" variant="primary" disabled={busy || !editDraft.name.trim()} onClick={() => save({ ...location, ...editDraft }, () => setEditingId(null))}>Save</Button>
                    </div>
                  </>
                ) : (
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-app-text">{location.name}</span>
                      <span className="block truncate text-xs text-app-muted">{[location.building, location.room].filter(Boolean).join(', ') || 'No building or room recorded'}</span>
                    </span>
                    {!location.isActive ? <StatusBadge tone="neutral">Archived</StatusBadge> : null}
                    <div className="flex flex-wrap gap-2">
                      {location.isActive ? (
                        <Button type="button" variant="ghost" disabled={busy} onClick={() => { setEditingId(location.id); setEditDraft({ name: location.name, building: location.building, room: location.room, notes: location.notes }); }}>Edit</Button>
                      ) : null}
                      <Button type="button" disabled={busy} onClick={() => save({ ...location, isActive: !location.isActive })}>{location.isActive ? 'Archive' : 'Restore'}</Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : <p className="m-0 text-sm text-app-muted">No interview locations yet.</p>}
      </div>
    </ModalShell>
  );
}
