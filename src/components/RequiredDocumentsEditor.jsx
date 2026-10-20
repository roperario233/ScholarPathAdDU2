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
      <p className="m-0 text-xs text-app-muted">Students must attach one Document Vault file for each item that applies to their year standing before they can submit. Any listed document type satisfies the item.</p>
      <input type="hidden" name="requiredDocuments" value={JSON.stringify(items)} />
      <ul className="m-0 grid gap-3 p-0">
        {items.map((item, index) => {
          const addable = documentTypeOptions.filter((option) => !item.documentTypes.includes(option.value));
          return (
            <li key={item.id} className="grid gap-2 rounded-xl border border-app-border bg-app-surface p-3">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem]">
                <input
                  value={item.label}
                  onChange={(event) => update(item.id, { label: event.target.value })}
                  placeholder="Requirement label, e.g. Certificate of Good Moral Character"
                  aria-label={`Requirement ${index + 1} label`}
                />
                <select value={item.standing} onChange={(event) => update(item.id, { standing: event.target.value })} aria-label={`Requirement ${index + 1} applies to`}>
                  {REQUIREMENT_STANDINGS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {item.documentTypes.map((type) => (
                  <span key={type} className="inline-flex items-center gap-1 rounded-full border border-app-border bg-app-card px-2.5 py-1 text-xs text-app-text">
                    {getDocumentTypeLabel(type)}
                    <button type="button" className="ml-1 text-app-muted hover:text-app-text" aria-label={`Remove ${getDocumentTypeLabel(type)}`} onClick={() => update(item.id, { documentTypes: item.documentTypes.filter((value) => value !== type) })}>×</button>
                  </span>
                ))}
                <select
                  value=""
                  className="min-w-0 flex-1 sm:max-w-[16rem]"
                  onChange={(event) => { if (event.target.value) update(item.id, { documentTypes: [...item.documentTypes, event.target.value] }); }}
                  aria-label={`Add an accepted document type to requirement ${index + 1}`}
                >
                  <option value="">{item.documentTypes.length ? 'Add another accepted type…' : 'Choose an accepted document type…'}</option>
                  {addable.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <Button type="button" variant="ghost" className="!min-h-9 !px-3 !py-1 !text-xs" onClick={() => remove(item.id)}>Remove</Button>
              </div>
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
