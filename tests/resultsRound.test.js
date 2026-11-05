import { describe, expect, it } from 'vitest';
import {
  formatAcademicYear,
  getConfirmByDaysRemaining,
  getDefaultConfirmBy,
  getRoundAcademicYear,
  getOfferState,
  getResultsRounds,
  isOfferRoundClosed,
  isValidConfirmBy,
  moveInOrder,
  sortWaitlist,
} from '../src/lib/resultsRound';

const NOW = new Date('2026-11-04T02:00:00Z'); // 10:00 in Manila

const app = (id, status, extra = {}) => ({ id, status, scholarshipId: 'gia', scholarshipTitle: 'Grant-in-Aid (GIA)', studentId: `s-${id}`, submittedAt: '2026-10-01', ...extra });

describe('confirm-by dates', () => {
  it('defaults to a week from the Manila day and refuses a past date', () => {
    expect(getDefaultConfirmBy(NOW)).toBe('2026-11-11');
    expect(isValidConfirmBy('2026-11-04', NOW)).toBe(true);
    expect(isValidConfirmBy('2026-11-03', NOW)).toBe(false);
    expect(isValidConfirmBy('next week', NOW)).toBe(false);
  });

  it('counts down whole Manila calendar days to the confirm-by date', () => {
    expect(getConfirmByDaysRemaining('2026-11-11', NOW)).toBe(7);
    expect(getConfirmByDaysRemaining('2026-11-05', NOW)).toBe(1);
    expect(getConfirmByDaysRemaining('2026-11-04', NOW)).toBe(0);
    expect(getConfirmByDaysRemaining('2026-11-03', NOW)).toBe(-1);
    expect(getConfirmByDaysRemaining('2026-02-30', NOW)).toBe(null);
  });

  it('reads an unanswered offer past its date as lapsed', () => {
    expect(getOfferState({ response: 'pending', confirmBy: '2026-11-03' }, NOW)).toBe('lapsed');
    expect(getOfferState({ response: 'pending', confirmBy: '2026-11-04' }, NOW)).toBe('pending');
    expect(getOfferState({ response: 'confirmed', confirmBy: '2026-11-01' }, NOW)).toBe('confirmed');
    expect(getOfferState(null)).toBe(null);
  });
});

describe('waitlist order', () => {
  const levels = { a: 'recommended', b: 'highly_recommended', c: 'recommended_with_reservation', d: 'recommended' };
  const recommendationOf = (entry) => ({ level: levels[entry.id] });
  const entries = [
    app('a', 'Waitlisted', { submittedAt: '2026-10-05' }),
    app('b', 'Waitlisted'),
    app('c', 'Waitlisted'),
    app('d', 'Waitlisted', { submittedAt: '2026-10-02' }),
  ];

  it('pre-sorts by the panel recommendation, then the earliest submission', () => {
    expect(sortWaitlist(entries, { recommendationOf }).map((entry) => entry.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('puts the Admin order first and keeps the rest pre-sorted', () => {
    const ranks = [{ applicationId: 'c', rank: 1 }, { applicationId: 'a', rank: 2 }];
    expect(sortWaitlist(entries, { ranks, recommendationOf }).map((entry) => entry.id)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('moves one entry and stops at the ends', () => {
    expect(moveInOrder(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveInOrder(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moveInOrder(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
  });
});

describe('results rounds', () => {
  const scholarships = [{ id: 'gia', title: 'Grant-in-Aid (GIA)' }];

  it('holds the close until the approved cases are released', () => {
    const [round] = getResultsRounds({ applications: [app('a', 'Approved'), app('w', 'Waitlisted'), app('n', 'Rejected')], scholarships, now: NOW });
    expect(round.approved).toHaveLength(1);
    expect(round.heldWaitlist).toHaveLength(1);
    expect(round.notAcceptedHeld).toHaveLength(1);
    expect(round.canClose).toBe(false);
    expect(round.closeBlocker).toMatch(/approved case/);
  });

  it('opens a slot for each declined offer, filled one for one by a promotion', () => {
    const releases = [{ id: 'r1', scholarshipId: 'gia', kind: 'offers', releasedAt: '2026-11-01T00:00:00Z', applicationIds: ['x', 'y', 'w1', 'w2'] }];
    const offers = [
      { applicationId: 'x', scholarshipId: 'gia', offeredAt: '2026-11-01T00:00:00Z', confirmBy: '2026-11-08', response: 'declined', origin: 'release' },
      { applicationId: 'y', scholarshipId: 'gia', offeredAt: '2026-11-01T00:00:00Z', confirmBy: '2026-11-08', response: 'confirmed', origin: 'release' },
    ];
    const applications = [app('x', 'Declined'), app('y', 'Released'), app('w1', 'Waitlisted'), app('w2', 'Waitlisted')];
    const [round] = getResultsRounds({ applications, scholarships, resultsReleases: releases, offers, ranks: [{ applicationId: 'w2', rank: 1 }, { applicationId: 'w1', rank: 2 }], now: NOW });
    expect(round.openSlots).toBe(1);
    expect(round.nextWaitlisted.id).toBe('w2');
    expect(round.heldWaitlist).toHaveLength(0);
    expect(round.canClose).toBe(true);

    const promoted = [...offers, { applicationId: 'w2', scholarshipId: 'gia', offeredAt: '2026-11-03T00:00:00Z', confirmBy: '2026-11-10', response: 'pending', origin: 'promotion' }];
    const [after] = getResultsRounds({
      applications: [app('x', 'Declined'), app('y', 'Released'), app('w1', 'Waitlisted'), app('w2', 'Released')],
      scholarships,
      resultsReleases: releases,
      offers: promoted,
      now: NOW,
    });
    expect(after.openSlots).toBe(0);
    expect(after.pendingOffers).toBe(1);
    // An unanswered offer keeps the round open.
    expect(after.canClose).toBe(false);
  });

  it('starts a new round after the closing release', () => {
    const releases = [
      { id: 'r1', scholarshipId: 'gia', kind: 'offers', releasedAt: '2026-06-01T00:00:00Z', applicationIds: ['old'] },
      { id: 'r2', scholarshipId: 'gia', kind: 'closing', releasedAt: '2026-06-20T00:00:00Z', applicationIds: ['gone'] },
    ];
    const offers = [{ applicationId: 'old', scholarshipId: 'gia', offeredAt: '2026-06-01T00:00:00Z', response: 'confirmed' }];
    const rounds = getResultsRounds({ applications: [app('old', 'Released'), app('gone', 'Rejected')], scholarships, resultsReleases: releases, offers, now: NOW });
    expect(rounds).toEqual([]);
    expect(isOfferRoundClosed(offers[0], releases)).toBe(true);
    expect(isOfferRoundClosed(offers[0], releases.slice(0, 1))).toBe(false);
  });
});

describe('round header facts', () => {
  const scholarships = [{ id: 'gia', title: 'Grant-in-Aid (GIA)' }];

  it('names the academic year the applications were submitted in', () => {
    expect(getRoundAcademicYear([app('a', 'Approved', { submittedAt: '2026-10-01' }), app('b', 'Approved', { submittedAt: '2026-11-01' }), app('c', 'Approved', { submittedAt: '2026-04-01' })])).toBe('2026-2027');
    expect(getRoundAcademicYear([app('a', 'Approved', { submittedAt: '2027-03-15' })])).toBe('2026-2027');
    expect(formatAcademicYear('2026-2027')).toBe('2026–2027');
  });

  it('counts the applicants of the round and those still with the office or school', () => {
    const applications = [app('a', 'Approved'), app('w', 'Waitlisted'), app('n', 'Rejected'), app('p', 'Interview'), app('d', 'Draft')];
    const [round] = getResultsRounds({ applications, scholarships, now: NOW });
    expect(round.academicYear).toBe('2026-2027');
    expect(round.applicantCount).toBe(4);
    expect(round.stillOpenCount).toBe(1);
    expect(round.lastReleasedAt).toBe(null);
  });

  it('reports the last offers release of the round', () => {
    const releases = [{ id: 'r1', scholarshipId: 'gia', kind: 'offers', releasedAt: '2026-11-01T00:00:00Z', applicationIds: ['y'] }];
    const offers = [{ applicationId: 'y', scholarshipId: 'gia', offeredAt: '2026-11-01T00:00:00Z', response: 'pending' }];
    const [round] = getResultsRounds({ applications: [app('y', 'Released')], scholarships, resultsReleases: releases, offers, now: NOW });
    expect(round.lastReleasedAt).toBe('2026-11-01T00:00:00Z');
  });
});
