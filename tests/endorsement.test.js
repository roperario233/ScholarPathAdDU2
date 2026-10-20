import { describe, expect, it } from 'vitest';
import {
  getApplicationComments,
  getEndorsementAgeDays,
  getEndorsementDecisionEvent,
  getEndorsementHandoff,
  isEndorsementOverdue,
} from '../src/lib/endorsement';

const application = (overrides = {}) => ({
  id: 'app-1',
  status: 'For Endorsement',
  studentName: 'Ada Cruz',
  scholarshipTitle: 'Grant-in-Aid (GIA)',
  updatedAt: '2026-10-01T00:00:00.000Z',
  timeline: [],
  statusLog: [],
  ...overrides,
});

const statusLogFor = (applicationStatus = 'For Endorsement') => [
  {
    id: 'log-verification',
    toStatus: 'For Verification',
    actorRole: 'admissions_office',
    actorName: 'Ben Reyes',
    reason: 'Continued to document verification.',
    at: '2026-09-30T00:00:00.000Z',
  },
  {
    id: 'log-handoff',
    toStatus: 'For Endorsement',
    actorRole: 'admissions_office',
    actorName: 'Ben Reyes',
    reason: 'Sent to endorsement. The Department Chair now reviews it.',
    at: '2026-10-01T00:00:00.000Z',
  },
  ...(applicationStatus === 'Endorsed'
    ? [{
      id: 'log-endorsed',
      toStatus: 'Endorsed',
      actorRole: 'department_chair',
      actorName: 'Mia Santos',
      reason: 'Endorsed after department review.',
      at: '2026-10-04T00:00:00.000Z',
    }]
    : []),
];

describe('endorsement record and timing', () => {
  it('reads the hand-off actor, date, and note from the status log', () => {
    const handoff = getEndorsementHandoff(application({ statusLog: statusLogFor() }));

    expect(handoff).toMatchObject({
      actor: 'Ben Reyes',
      note: 'Sent to endorsement. The Department Chair now reviews it.',
    });
  });

  it('reads the endorsement decision event', () => {
    const decision = getEndorsementDecisionEvent(application({ status: 'Endorsed', statusLog: statusLogFor('Endorsed') }));

    expect(decision).toMatchObject({ stage: 'Endorsed', actor: 'Mia Santos' });
  });

  it('counts the days an application has waited at the Chair', () => {
    const awaiting = application({ statusLog: statusLogFor() });

    expect(getEndorsementAgeDays(awaiting, new Date('2026-10-06T00:00:00.000Z'))).toBe(5);
    expect(isEndorsementOverdue(awaiting, new Date('2026-10-06T00:00:00.000Z'))).toBe(false);
    expect(isEndorsementOverdue(awaiting, new Date('2026-10-07T00:00:00.000Z'))).toBe(true);
  });

  it('measures an endorsement decision as hand-off-to-decision time', () => {
    const endorsed = application({ status: 'Endorsed', statusLog: statusLogFor('Endorsed') });
    expect(getEndorsementAgeDays(endorsed, new Date('2026-10-20T00:00:00.000Z'))).toBe(3);
  });
});

describe('getApplicationComments', () => {
  it('returns only the requested application thread, oldest first', () => {
    const comments = getApplicationComments([
      { id: 'c-2', applicationId: 'app-1', body: 'Second', createdAt: '2026-10-02T00:00:00.000Z' },
      { id: 'c-other', applicationId: 'app-2', body: 'Other case', createdAt: '2026-10-01T00:00:00.000Z' },
      { id: 'c-1', applicationId: 'app-1', body: 'First', createdAt: '2026-10-01T00:00:00.000Z' },
    ], 'app-1');

    expect(comments.map((comment) => comment.id)).toEqual(['c-1', 'c-2']);
  });

  it('tolerates a missing collection', () => {
    expect(getApplicationComments(undefined, 'app-1')).toEqual([]);
  });
});
