// A scholarship's results round, as the Admissions Office Admin works it on
// Final check and release (20261061000000_add_waitlist_and_offer_confirmation.sql):
//
//   1. Final check the Approved cases and order the waitlist.
//   2. Release the accepted and waitlisted applicants together (an `offers`
//      release). Each accepted applicant gets an offer with a confirm-by date.
//   3. Collect the answers. A decline opens a slot, which the Admin offers to
//      the next waitlisted applicant ("Offer to next", one for one).
//   4. Close the results once every offer is answered (a `closing` release):
//      the applicants still waitlisted become Not accepted, and every Not
//      accepted applicant receives the general letter together.
//
// Pure derivations only; the writes live in App.jsx and the database repeats
// every rule.
import { INTERVIEW_RECOMMENDATION_LEVELS } from './interview';
import { getCurrentAcademicYear } from './profile';

const asList = (value) => (Array.isArray(value) ? value : []);

export const OFFER_STATE_LABELS = {
  pending: 'Awaiting confirmation',
  lapsed: 'Confirm-by date passed',
  confirmed: 'Confirmed',
  declined: 'Declined',
};

export const OFFER_STATE_TONES = {
  pending: 'info',
  lapsed: 'warning',
  confirmed: 'success',
  declined: 'neutral',
};

// Why an accepted applicant may turn the award down; the student picks one in
// the decline dialog (ReasonModal options).
export const OFFER_DECLINE_REASONS = [
  { value: 'other-scholarship', label: 'I accepted another scholarship or grant' },
  { value: 'other-school', label: 'I am enrolling at another school' },
  { value: 'not-needed', label: 'I no longer need financial aid' },
  { value: 'cannot-meet', label: 'I cannot meet the scholarship’s obligations' },
  { value: 'other', label: 'Other', requiresNotes: true },
];

// The academic year (June start, the same rule the Statistics page filters by) a
// round's applications were submitted in: the most common one, the latest on a
// tie. "2026-2027" is shown as "2026–2027".
export const getRoundAcademicYear = (entries = []) => {
  const counts = new Map();
  asList(entries).forEach((entry) => {
    const when = Date.parse(entry?.submittedAt || entry?.updatedAt || '');
    if (!Number.isFinite(when)) return;
    const year = getCurrentAcademicYear(new Date(when));
    counts.set(year, (counts.get(year) || 0) + 1);
  });
  const ranked = [...counts.entries()].sort((left, right) => right[1] - left[1] || right[0].localeCompare(left[0]));
  return ranked.length ? ranked[0][0] : getCurrentAcademicYear();
};

export const formatAcademicYear = (value) => String(value || '').replace('-', '–');

// Manila's calendar date (YYYY-MM-DD), the day the confirm-by date is read against.
export const getManilaToday = (now = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(now);

// The default confirm-by date: a week from today, Manila time.
export const getDefaultConfirmBy = (now = new Date(), days = 7) => {
  const [year, month, day] = getManilaToday(now).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
};

export const isValidConfirmBy = (value, now = new Date()) => (
  /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && String(value) >= getManilaToday(now)
);

export const getOfferForApplication = (offers = [], applicationId) => (
  asList(offers).find((entry) => entry?.applicationId === applicationId) || null
);

// pending, lapsed (still pending after the confirm-by date), confirmed, declined.
export const getOfferState = (offer, now = new Date()) => {
  if (!offer) return null;
  if (offer.response === 'confirmed' || offer.response === 'declined') return offer.response;
  if (offer.confirmBy && String(offer.confirmBy) < getManilaToday(now)) return 'lapsed';
  return 'pending';
};

const releaseKindOf = (release) => release?.kind || 'legacy';
const time = (value) => {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
};

// When the scholarship's current round began: the last closing (or legacy)
// release, or the beginning of time.
export const getRoundStart = (scholarshipId, resultsReleases = []) => asList(resultsReleases)
  .filter((release) => release.scholarshipId === scholarshipId && releaseKindOf(release) !== 'offers')
  .reduce((latest, release) => Math.max(latest, time(release.releasedAt)), 0);

// True once a closing release was recorded after the offer: the student can no
// longer change their answer in the app.
export const isOfferRoundClosed = (offer, resultsReleases = []) => Boolean(offer) && asList(resultsReleases).some((release) => (
  release.scholarshipId === offer.scholarshipId
  && releaseKindOf(release) !== 'offers'
  && time(release.releasedAt) >= time(offer.offeredAt)
));

const recommendationRank = (level) => {
  const index = INTERVIEW_RECOMMENDATION_LEVELS.findIndex((entry) => entry.value === level);
  return index === -1 ? INTERVIEW_RECOMMENDATION_LEVELS.length : index;
};

// The waitlist in promotion order: the Admin's saved order first, then any case
// not yet ranked, pre-sorted by the panel's recommendation level (Highly
// recommended first) and then the earliest submission.
export const sortWaitlist = (entries = [], { ranks = [], recommendationOf = () => null } = {}) => {
  const rankById = new Map(asList(ranks).map((row) => [row.applicationId, Number(row.rank) || 0]));
  return [...asList(entries)].sort((left, right) => {
    const leftRank = rankById.get(left.id);
    const rightRank = rankById.get(right.id);
    if (leftRank && rightRank) return leftRank - rightRank;
    if (leftRank) return -1;
    if (rightRank) return 1;
    const byLevel = recommendationRank(recommendationOf(left)?.level) - recommendationRank(recommendationOf(right)?.level);
    if (byLevel) return byLevel;
    return time(left.submittedAt) - time(right.submittedAt) || String(left.id).localeCompare(String(right.id));
  });
};

// Moves one entry up (-1) or down (+1) in an ordered id list.
export const moveInOrder = (ids = [], applicationId, direction) => {
  const list = [...asList(ids)];
  const index = list.indexOf(applicationId);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= list.length) return list;
  [list[index], list[target]] = [list[target], list[index]];
  return list;
};

/**
 * Every scholarship with results work open, in title order.
 *
 * @returns {Array<{
 *   scholarshipId: string, title: string,
 *   approved: object[], waitlist: object[], heldWaitlist: object[],
 *   offers: Array<{ application: object, offer: object, state: string }>,
 *   declined: object[], notAcceptedHeld: object[],
 *   offersReleased: boolean, openSlots: number, nextWaitlisted: object | null,
 *   pendingOffers: number, lapsedOffers: number, confirmedOffers: number,
 *   closeBlocker: string, canClose: boolean,
 *   academicYear: string, applicantCount: number, stillOpenCount: number,
 *   lastReleasedAt: string | null,
 * }>}
 */
export const getResultsRounds = ({
  applications = [],
  scholarships = [],
  resultsReleases = [],
  offers = [],
  ranks = [],
  recommendationOf = () => null,
  now = new Date(),
} = {}) => {
  const titleById = Object.fromEntries(asList(scholarships).map((entry) => [entry.id, entry.title]));
  const releases = asList(resultsReleases);
  const coveredBy = (kinds) => new Set(releases
    .filter((release) => kinds.includes(releaseKindOf(release)))
    .flatMap((release) => asList(release.applicationIds)));
  const offersCovered = coveredBy(['offers']);
  const lettersSent = coveredBy(['closing', 'legacy']);
  const byScholarship = new Map();
  asList(applications).forEach((entry) => {
    if (!byScholarship.has(entry.scholarshipId)) byScholarship.set(entry.scholarshipId, []);
    byScholarship.get(entry.scholarshipId).push(entry);
  });

  const rounds = [];
  byScholarship.forEach((list, scholarshipId) => {
    const since = getRoundStart(scholarshipId, releases);
    const offersReleased = releases.some((release) => (
      release.scholarshipId === scholarshipId && releaseKindOf(release) === 'offers' && time(release.releasedAt) > since
    ));
    const approved = list.filter((entry) => entry.status === 'Approved');
    const waitlist = sortWaitlist(list.filter((entry) => entry.status === 'Waitlisted'), { ranks, recommendationOf });
    const heldWaitlist = waitlist.filter((entry) => !offersCovered.has(entry.id));
    const roundOffers = list
      .map((entry) => ({ application: entry, offer: getOfferForApplication(offers, entry.id) }))
      .filter(({ application, offer }) => offer && time(offer.offeredAt) > since
        && ['Released', 'Declined'].includes(application.status))
      .map((row) => ({ ...row, state: getOfferState(row.offer, now) }));
    const declined = list.filter((entry) => entry.status === 'Declined'
      && (roundOffers.some((row) => row.application.id === entry.id) || offersCovered.has(entry.id)));
    const notAcceptedHeld = list.filter((entry) => entry.status === 'Rejected' && !lettersSent.has(entry.id));
    const declinedOffers = roundOffers.filter((row) => row.state === 'declined').length;
    const promotions = roundOffers.filter((row) => row.offer.origin === 'promotion').length;
    const openSlots = Math.max(0, declinedOffers - promotions);
    const pendingOffers = roundOffers.filter((row) => row.state === 'pending').length;
    const lapsedOffers = roundOffers.filter((row) => row.state === 'lapsed').length;
    const confirmedOffers = roundOffers.filter((row) => row.state === 'confirmed').length;
    const nextWaitlisted = waitlist.find((entry) => offersCovered.has(entry.id)) || null;
    // Everything submitted for this scholarship that no closing letter covered yet:
    // the applicants of the round, and how many are still with the office or school.
    const inRound = list.filter((entry) => entry.status !== 'Draft' && !lettersSent.has(entry.id));
    const stillOpen = inRound.filter((entry) => !['Approved', 'Waitlisted', 'Released', 'Declined', 'Rejected'].includes(entry.status)).length;
    const lastReleasedAt = releases
      .filter((release) => release.scholarshipId === scholarshipId && releaseKindOf(release) === 'offers' && time(release.releasedAt) > since)
      .reduce((latest, release) => (time(release.releasedAt) > time(latest) ? release.releasedAt : latest), '') || null;

    if (!approved.length && !waitlist.length && !notAcceptedHeld.length
      && !roundOffers.some((row) => row.state !== 'declined') && !offersReleased) return;

    const closeBlocker = approved.length
      ? `Release the ${approved.length} approved case${approved.length === 1 ? '' : 's'} first.`
      : heldWaitlist.length
        ? 'Release the waitlist with the accepted applicants first.'
        : pendingOffers + lapsedOffers
          ? `${pendingOffers + lapsedOffers} accepted applicant${pendingOffers + lapsedOffers === 1 ? ' has' : 's have'} not answered yet. Record a response for each unanswered offer first.`
          : !offersReleased && !notAcceptedHeld.length
            ? 'Nothing to close yet.'
            : '';

    rounds.push({
      scholarshipId,
      title: titleById[scholarshipId] || list[0]?.scholarshipTitle || 'Scholarship',
      approved,
      waitlist,
      heldWaitlist,
      offers: roundOffers,
      declined,
      notAcceptedHeld,
      offersReleased,
      openSlots,
      nextWaitlisted,
      pendingOffers,
      lapsedOffers,
      confirmedOffers,
      closeBlocker,
      canClose: !closeBlocker,
      academicYear: getRoundAcademicYear(inRound.length ? inRound : list),
      applicantCount: inRound.length,
      stillOpenCount: stillOpen,
      lastReleasedAt,
    });
  });
  return rounds.sort((left, right) => left.title.localeCompare(right.title));
};
