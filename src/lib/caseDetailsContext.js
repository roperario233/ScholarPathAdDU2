import { createContext, useContext, useEffect } from 'react';

// Lets any case surface ask the workspace for one application's history (status
// log, internal comments, interview notes) without every page threading a prop.
// The default is a no-op, so a surface rendered outside the app (a test, a
// student session whose rows load eagerly) simply gets nothing to do.
export const CaseDetailsContext = createContext(() => {});

// Call from a component that shows a case. Re-asks only when the case changes.
export const useEnsureCaseDetails = (applicationId) => {
  const ensure = useContext(CaseDetailsContext);
  useEffect(() => {
    if (applicationId) ensure(applicationId);
  }, [applicationId, ensure]);
};
