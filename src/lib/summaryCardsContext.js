import { createContext, useContext } from 'react';

// Whether the summary cards at the top of a page are shown, and the setter Settings
// uses to change it. One choice per account covers every page (App.jsx provides it
// from `summaryCardsByOwner`, hidden by default), so a page only renders
// `SummaryCards` instead of threading props. The default is "shown, no setter": a
// surface rendered outside the app (a test) keeps its cards.
export const SummaryCardsContext = createContext({
  visible: true,
  onChange: null,
});

export const useSummaryCards = () => useContext(SummaryCardsContext);
