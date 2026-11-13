import { createContext, useContext } from 'react';

// The additional-documents requests and the two Admin writes, for the staff review
// modal. Four office pages mount `ApplicationReviewModal`, so the workspace
// provides this once instead of every page threading three more props. The
// default is empty and inert, so a surface rendered outside the app (a test, a
// reviewer session) simply has no requests and no way to raise one.
export const DocumentRequestsContext = createContext({
  requests: [],
  ready: true,
  onRequest: null,
  onCancel: null,
});

export const useDocumentRequests = () => useContext(DocumentRequestsContext);
