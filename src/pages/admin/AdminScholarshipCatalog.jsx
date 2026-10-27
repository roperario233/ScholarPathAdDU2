import { useMemo, useState } from 'react';
import AdminPageHeader from '../../components/AdminPageHeader';
import RequiredDocumentsEditor from '../../components/RequiredDocumentsEditor';
import { Button, Card, FormField, StatusBadge } from '../../components/ui';
import { getInternalCatalogEntries } from '../../lib/admissionsOffice';
import { ADDU_INTERNAL_PROGRAM_TITLES, isAdduInternalProgram } from '../../lib/eligibility';
import { normalizeRequirements } from '../../lib/applicationRequirements';

// Catalog management is its own route: publishing an AdDU internal scholarship
// never shares a screen with the review queue or the announcement composer.
export default function AdminScholarshipCatalog({ scholarships = [], onSaveScholarship, onDirtyChange }) {
  const [catalogError, setCatalogError] = useState('');
  const [editingScholarship, setEditingScholarship] = useState(null);
  const internalScholarships = useMemo(() => getInternalCatalogEntries(scholarships), [scholarships]);

  const markDirty = () => onDirtyChange?.(true);

  const saveScholarshipFromForm = async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const ruleFamily = String(data.get('ruleFamily') || 'general-pool');
    let requiredDocuments = [];
    try {
      requiredDocuments = normalizeRequirements(JSON.parse(String(data.get('requiredDocuments') || '[]')));
    } catch {
      requiredDocuments = [];
    }
    if (!requiredDocuments.length) {
      setCatalogError('Add at least one required document with a label and an accepted document type.');
      return;
    }
    // Only the three Appendix A tracks are tracked, so the form must not publish
    // a fourth internal title that students could never apply to.
    const title = String(data.get('scholarshipTitle') || '').trim();
    if (!isAdduInternalProgram({ title })) {
      setCatalogError('Choose one of the three tracked AdDU tracks.');
      return;
    }
    setCatalogError('');
    const scholarship = {
      ...(editingScholarship || {}),
      title,
      // Keep the stored category when editing, so saving the Student Assistant
      // program does not silently relabel it as an Internal Endowment.
      category: editingScholarship?.category || 'Internal Endowment',
      origin: 'AdDU',
      coverageType: String(data.get('coverageType') || 'Full Tuition'),
      coverage: String(data.get('scholarshipCoverage') || '').trim(),
      minimumQpi: data.get('minimumQpi') || null,
      minimumShsAverage: data.get('minimumShsAverage') || null,
      maximumIncome: data.get('maximumIncome') || null,
      eligibleDegrees: ruleFamily === 'work-study' ? ['ALL'] : [],
      allowsMultipleGrants: false,
      departmentScope: null,
      deadline: data.get('deadline') || null,
      isActive: data.get('isActive') === 'true',
      tags: ['AdDU Internal'],
      ruleFamily,
      govProgram: null,
      isMatchable: true,
      applicationRoute: null,
      isExternal: false,
      requiredDocuments,
    };
    const saved = await onSaveScholarship(scholarship);
    if (saved) {
      setEditingScholarship(null);
      onDirtyChange?.(false);
    }
  };

  const startEditingScholarship = (scholarship) => {
    onDirtyChange?.(false);
    setEditingScholarship(null);
    window.requestAnimationFrame(() => setEditingScholarship(scholarship));
  };

  return (
    <div className="grid gap-5">
      <AdminPageHeader
        title="AdDU internal scholarship catalog"
        description="Publish AdDU internal tracks and the documents each one requires."
        badge={`${internalScholarships.length} AdDU internal tracks`}
      />

      <section className="grid gap-4">
        <Card title="Publish or update a program" action={<StatusBadge tone="info">Catalog management</StatusBadge>}>
          <form key={editingScholarship?.id || 'new-scholarship'} className="grid gap-4" onChange={markDirty} onSubmit={saveScholarshipFromForm}>
            <FormField label="Scholarship title" hint="Pick one of the three tracked titles.">
              <input name="scholarshipTitle" required list="addu-track-titles" defaultValue={editingScholarship?.title || ''} placeholder="Grant-in-Aid (GIA)" />
              <datalist id="addu-track-titles">
                {ADDU_INTERNAL_PROGRAM_TITLES.map((title) => <option key={title} value={title} />)}
              </datalist>
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Internal eligibility rule">
                <select name="ruleFamily" required defaultValue={editingScholarship?.ruleFamily || 'general-pool'}>
                  <option value="general-pool">Grant-in-Aid / general pool</option>
                  <option value="honors">Jubilee / honors</option>
                  <option value="work-study">Student Assistant / Working Scholar</option>
                </select>
              </FormField>
              <FormField label="Coverage type">
                <select name="coverageType" required defaultValue={editingScholarship?.coverageType || 'Full Tuition'}>
                  <option>Full Tuition</option>
                  <option>Partial Tuition</option>
                  <option>Allowance</option>
                </select>
              </FormField>
            </div>
            <FormField label="Coverage description">
              <textarea name="scholarshipCoverage" rows="2" required defaultValue={editingScholarship?.coverage || ''} placeholder="Describe the covered fees or support." />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Minimum QPI (enrolled students)" hint="Defaults to 2.50.">
                <input type="number" name="minimumQpi" min="0" max="4" step="0.01" defaultValue={editingScholarship?.minimumQpi ?? ''} />
              </FormField>
              <FormField label="Minimum SHS general average (incoming first-years)" hint="Defaults to 85.">
                <input type="number" name="minimumShsAverage" min="60" max="100" step="1" defaultValue={editingScholarship?.minimumShsAverage ?? ''} />
              </FormField>
            </div>
            <FormField label="Maximum household income" hint="Leave blank to use the internal rule default.">
              <input type="number" name="maximumIncome" min="0" step="1000" defaultValue={editingScholarship?.maximumIncome ?? ''} />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2 sm:items-end">
              <FormField label="Application deadline">
                <input type="date" name="deadline" defaultValue={editingScholarship?.deadline?.slice(0, 10) || ''} />
              </FormField>
              <FormField label="Catalog status">
                <select name="isActive" defaultValue={editingScholarship ? String(editingScholarship.isActive !== false) : 'true'}>
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
              </FormField>
            </div>
            <RequiredDocumentsEditor scholarship={editingScholarship} onDirty={markDirty} />
            {catalogError ? <p className="form-error m-0" role="alert">{catalogError}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" type="submit">{editingScholarship ? 'Save scholarship changes' : 'Publish scholarship'}</Button>
              {editingScholarship && (
                <Button
                  type="button"
                  onClick={() => {
                    setEditingScholarship(null);
                    onDirtyChange?.(false);
                  }}
                >
                  Cancel edit
                </Button>
              )}
            </div>
          </form>
          <div className="mt-5 grid max-h-[360px] gap-2 overflow-y-auto border-t border-app-border pt-4">
            <h4 className="m-0 text-sm font-bold text-app-text">Tracked AdDU internal programs</h4>
            {internalScholarships.map((entry) => (
              <article key={entry.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-app-border bg-app-surface p-3">
                <div className="min-w-0">
                  <strong className="block truncate text-sm text-app-text">{entry.title}</strong>
                  <span className="text-xs text-app-muted">{entry.ruleFamily} · {entry.isActive === false ? 'Inactive' : 'Active'}</span>
                </div>
                <Button type="button" onClick={() => startEditingScholarship(entry)}>Edit</Button>
              </article>
            ))}
            {!internalScholarships.length && <p className="m-0 text-sm text-app-muted">No tracked AdDU internal programs are loaded from Supabase.</p>}
          </div>
        </Card>
      </section>
    </div>
  );
}
