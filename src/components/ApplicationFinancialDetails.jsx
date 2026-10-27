import { useEffect, useState } from 'react';
import { loadSupabaseApplicationFinancialDetails } from '../lib/supabaseData';
import { getFinancialDetailSections } from '../lib/financialDetails';

// Loads one application's office-only financial details for the Admissions
// Office: the answers the student wrote and the financial profile the database
// froze when they submitted. Row-level security returns nothing to a Department
// Chair, so the Chair never calls this (`enabled` is false) and sees a notice
// instead. `status` is 'hidden' | 'loading' | 'ready' | 'empty' | 'missing' | 'error'.
export function useApplicationFinancialSections(application, enabled) {
  const [state, setState] = useState({ sections: [], status: enabled ? 'loading' : 'hidden' });
  const applicationId = application?.id;
  const family = application?.profileSnapshot?.family;

  useEffect(() => {
    if (!enabled || !applicationId) {
      setState({ sections: [], status: 'hidden' });
      return undefined;
    }
    let active = true;
    setState({ sections: [], status: 'loading' });
    loadSupabaseApplicationFinancialDetails(applicationId).then((result) => {
      if (!active) return;
      if (!result.success) {
        setState({ sections: [], status: result.missing ? 'missing' : 'error' });
        return;
      }
      const sections = getFinancialDetailSections({
        financialProfile: result.financialSnapshot,
        answers: result.answers,
        family: family || {},
      });
      setState({ sections, status: sections.length ? 'ready' : 'empty' });
    });
    return () => { active = false; };
  }, [applicationId, enabled, family]);

  return state;
}

const NOTICE_TEXT = {
  hidden: 'Household finances and the financial situation are shared with the Admissions Office only.',
  loading: 'Loading the financial details…',
  missing: 'The financial details need the latest database migration (20261036000000).',
  error: 'The financial details could not be loaded. Try reopening the case.',
  empty: 'This applicant recorded no financial details (submitted before they were collected).',
};

// A one-line explanation under the profile snapshot wherever the financial
// groups are not (or not yet) shown.
export function FinancialDetailsNotice({ status }) {
  if (status === 'ready' || !NOTICE_TEXT[status]) return null;
  return <p className="m-0 pt-2 text-xs text-app-muted" role="status">{NOTICE_TEXT[status]}</p>;
}
