import { useState } from 'react';
import { Button } from './ui';
import { DEFAULT_REQUIRED_DOCUMENTS, REQUIREMENT_STANDINGS, getCatalogRequirements } from '../lib/applicationRequirements';
import { documentTypeOptions, getDocumentTypeLabel } from '../lib/constants';

const newRequirementId = () => `requirement-${crypto.randomUUID().slice(0, 8)}`;

// The Admissions Office's editor for a catalog entry's required documents. It
// lives inside the uncontrolled catalog form and hands the list back through a
// hidden `requiredDocuments` JSON field, so the form's submit handler reads it
// like any other field. Each item names the vault document types that satisfy it
// and the year standing it applies to. `onDirty` lets the catalog route include
// these edits in its unsaved-changes guard, because the hidden field fires no
// form event of its own.
export default function RequiredDocumentsEditor({ scholarship, onDirty }) {
  const [items, setItems] = useState(() => (
    scholarship ? getCatalogRequirements(scholarship) : DEFAULT_REQUIRED_DOCUMENTS['general-pool']
  ).map((item) => ({ ...item, documentTypes: [...item.documentTypes] })));

  const update = (id, patch) => {
    onDirty?.();
    setItems((previous) => previous.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };
  const remove = (id) => {
    onDirty?.();
    setItems((previous) => previous.filter((item) => item.id !== id));
  };
  const add = () => {
    onDirty?.();
    setItems((previous) => [...previous, { id: newRequirementId(), label: '', documentTypes: [], standing: 'all' }]);
  };
  const resetToDefaults = (event) => {
    const ruleFamily = event.currentTarget.form?.elements?.ruleFamily?.value || 'general-pool';
    if (!window.confirm('Replace this list with the default required documents for the selected eligibility rule?')) return;
    onDirty?.();
    setItems((DEFAULT_REQUIRED_DOCUMENTS[ruleFamily] || []).map((item) => ({ ...item, documentTypes: [...item.documentTypes] })));
  };

  return (
    <fieldset className="grid gap-3 rounded-2xl border border-app-border p-4">
      <legend className="px-1 text-sm font-semibold text-app-text">Required documents</legend>
      <p className="m-0 text-xs text-app-muted">One vault file per applicable item. Any listed type satisfies it.</p>
      <input type="hidden" name="requiredDocuments" value={JSON.stringify(items)} />
      <ul className="m-0 grid gap-3 p-0">
        {items.map((item, index) => {
          const addable = documentTypeOptions.filter((option) => !item.documentTypes.includes(option.value));
          return (
            <li key={item.id} className="grid gap-3 rounded-xl border border-app-border bg-app-surface p-3">
              <div className="flex items-start justify-between gap-3">
                <span className="pt-0.5 text-xs font-semibold uppercase tracking-wide text-app-muted">Requirement {index + 1}</span>
                <Button type="button" variant="ghost" className="!min-h-9 !px-3 !py-1 !text-xs" onClick={() => remove(item.id)} aria-label={`Remove requirement ${index + 1}`}>Remove</Button>
              </div>
              <label className="grid min-w-0 content-start gap-1">
                <span className="text-xs font-semibold text-app-muted">Label shown to students</span>
                <textarea
                  rows="2"
                  value={item.label}
                  onChange={(event) => update(item.id, { label: event.target.value })}
                  placeholder="e.g. Certificate of Good Moral Character"
                  className="resize-y !py-2.5 !text-sm"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid min-w-0 content-start gap-1">
                  <span className="text-xs font-semibold text-app-muted">Applies to</span>
                  <select value={item.standing} onChange={(event) => update(item.id, { standing: event.target.value })} className="!py-2.5 !text-sm">
                    {REQUIREMENT_STANDINGS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label className="grid min-w-0 content-start gap-1">
                  <span className="text-xs font-semibold text-app-muted">Accepted document types</span>
                  <select
                    value=""
                    className="!py-2.5 !text-sm"
                    onChange={(event) => { if (event.target.value) update(item.id, { documentTypes: [...item.documentTypes, event.target.value] }); }}
                  >
                    <option value="">{item.documentTypes.length ? 'Add another accepted type…' : 'Choose an accepted document type…'}</option>
                    {addable.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
              </div>
              {item.documentTypes.length ? (
                <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                  {item.documentTypes.map((type) => (
                    <li key={type} className="inline-flex max-w-full items-center gap-1 rounded-full border border-app-border bg-app-card py-1 pl-3 pr-1.5 text-xs text-app-text">
                      <span className="min-w-0 [overflow-wrap:anywhere]">{getDocumentTypeLabel(type)}</span>
                      <button
                        type="button"
                        className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-app-muted hover:bg-app-surface hover:text-app-text"
                        aria-label={`Remove ${getDocumentTypeLabel(type)}`}
                        onClick={() => update(item.id, { documentTypes: item.documentTypes.filter((value) => value !== type) })}
                      >×</button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="m-0 text-xs font-semibold text-amber-600">Choose at least one accepted document type, or this item is left out when you save.</p>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={add}>Add requirement</Button>
        <Button type="button" variant="ghost" onClick={resetToDefaults}>Use the default list for this rule</Button>
      </div>
    </fieldset>
  );
}
