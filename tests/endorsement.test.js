import { describe, expect, it } from 'vitest';
import {
  getApplicationComments,
  getEndorsedApplications,
  getEndorsementAgeDays,
  getEndorsementDecisionEvent,
  getEndorsementHandoff,
  getEndorsementQueue,
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
    reason: 'Sent for endorsement. The Admissions Office Head now decides it.',
    at: '2026-10-01T00:00:00.000Z',
  },
  ...(applicationStatus === 'Endorsed'
    ? [{
      id: 'log-endorsed',
      toStatus: 'Endorsed',
      actorRole: 'admissions_head',
      actorName: 'Mia Santos',
      reason: 'Endorsed after central review.',
      at: '2026-10-04T00:00:00.000Z',
    }]
    : []),
];

describe('endorsement record and timing', () => {
  it('reads the hand-off actor, date, and note from the status log', () => {
    const handoff = getEndorsementHandoff(application({ statusLog: statusLogFor() }));

    expect(handoff).toMatchObject({
      actor: 'Ben Reyes',
      note: 'Sent for endorsement. The Admissions Office Head now decides it.',
    });
  });

  // The hand-off is written to the timeline before the append-only status log
  // reaches the next workspace load, so the record must stay readable in the
  // same session the reviewer sent it.
  it('falls back to the browser timeline while the status log catches up', () => {
    const handoff = getEndorsementHandoff(application({
      statusLog: [statusLogFor()[0]],
      timeline: [{
        id: 'ev-handoff',
        stage: 'For Endorsement',
        actor: 'Admissions Office Staff',
        note: 'Documents are verified and consistent with the submission.',
        at: '2026-10-01',
      }],
    }));

    expect(handoff).toMatchObject({
      actor: 'Admissions Office Staff',
      note: 'Documents are verified and consistent with the submission.',
    });
  });

  it('reads the endorsement decision event', () => {
    const decision = getEndorsementDecisionEvent(application({ status: 'Endorsed', statusLog: statusLogFor('Endorsed') }));

    expect(decision).toMatchObject({ stage: 'Endorsed', actor: 'Mia Santos' });
  });

  it('counts the days an application has waited at endorsement', () => {
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

describe('endorsement queues', () => {
  const handoffLog = (at) => [
    {
      id: `log-verification-${at}`,
      toStatus: 'For Verification',
      actorRole: 'admissions_office',
      actorName: 'Ben Reyes',
      reason: 'Continued to document verification.',
      at: '2026-09-30T00:00:00.000Z',
    },
    {
      id: `log-handoff-${at}`,
      toStatus: 'For Endorsement',
      actorRole: 'admissions_office',
      actorName: 'Ben Reyes',
      reason: 'Sent for endorsement.',
      at,
    },
  ];

  it('lists only the cases awaiting the Head decision, oldest hand-off first', () => {
    const queue = getEndorsementQueue([
      application({ id: 'later', statusLog: handoffLog('2026-10-05T00:00:00.000Z') }),
      application({ id: 'earlier', statusLog: handoffLog('2026-10-01T00:00:00.000Z') }),
      application({ id: 'verification', status: 'For Verification', statusLog: [] }),
      application({ id: 'endorsed', status: 'Endorsed', statusLog: statusLogFor('Endorsed') }),
      application({ id: 'rejected', status: 'Rejected', statusLog: [] }),
    ]);

    expect(queue.map((entry) => entry.id)).toEqual(['earlier', 'later']);
  });

  // A case recorded before the append-only status log existed still has to appear,
  // ordered by the only date it carries.
  it('falls back to the update time when no hand-off is recorded', () => {
    const queue = getEndorsementQueue([
      application({ id: 'logged', statusLog: handoffLog('2026-10-04T00:00:00.000Z') }),
      application({ id: 'legacy', statusLog: [], updatedAt: '2026-10-01T00:00:00.000Z' }),
    ]);

    expect(queue.map((entry) => entry.id)).toEqual(['legacy', 'logged']);
  });

  it('lists decided endorsements newest decision first', () => {
    const decided = (id, at) => application({
      id,
      status: 'Endorsed',
      statusLog: [
        ...handoffLog('2026-10-01T00:00:00.000Z'),
        {
          id: `log-endorsed-${id}`,
          toStatus: 'Endorsed',
          actorRole: 'admissions_head',
          actorName: 'Mia Santos',
          reason: 'Endorsed after central review.',
          at,
        },
      ],
    });

    const list = getEndorsedApplications([
      decided('older', '2026-10-03T00:00:00.000Z'),
      decided('newer', '2026-10-06T00:00:00.000Z'),
      application({ id: 'awaiting' }),
    ]);

    expect(list.map((entry) => entry.id)).toEqual(['newer', 'older']);
  });

  it('tolerates a missing collection', () => {
    expect(getEndorsementQueue(undefined)).toEqual([]);
    expect(getEndorsementQueue(null)).toEqual([]);
    expect(getEndorsedApplications(undefined)).toEqual([]);
    expect(getEndorsedApplications(null)).toEqual([]);
  });
});
