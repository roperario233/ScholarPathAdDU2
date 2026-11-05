import { describe, expect, it } from 'vitest';
import {
  fetchPagedRows,
  runDeadlineReminders,
} from '../supabase/functions/_shared/deadlineReminderRunner.js';

const TODAY = '2026-09-08';
const inDays = (days) => {
  const date = new Date(`${TODAY}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const parseNotInList = (value) => (
  (String(value ?? '').match(/"([^"]+)"/g) ?? []).map((entry) => entry.slice(1, -1))
);

const rowMatches = (row, state) => {
  for (const [column, value] of state.eq) {
    if (row[column] !== value) return false;
  }
  for (const [column, values] of state.in) {
    const allowed = new Set(values.map(String));
    if (!allowed.has(String(row[column]))) return false;
  }
  for (const [column, operator, value] of state.not) {
    if (operator === 'is' && value === null) {
      if (row[column] === null || row[column] === undefined) return false;
      continue;
    }
    if (operator === 'in') {
      const excluded = new Set(parseNotInList(value).map(String));
      if (excluded.has(String(row[column]))) return false;
      continue;
    }
    if (String(row[column]) === String(value)) return false;
  }
  return true;
};

const createSupabaseStub = ({ tables = {}, failWrite } = {}) => {
  const writes = [];
  const ranges = [];
  const inReads = [];

  const from = (table) => {
    const state = { eq: [], in: [], not: [] };

    const write = (kind, row, options) => {
      const failure = failWrite?.(table, row, kind);
      if (failure === 'throw') throw new Error('write failed');
      if (failure) return { error: typeof failure === 'string' ? { message: failure } : failure };
      writes.push({ table, kind, row, options });
      return { error: null };
    };

    const api = {
      select: () => api,
      eq: (column, value) => {
        state.eq.push([column, value]);
        return api;
      },
      in: (column, values) => {
        state.in.push([column, values]);
        inReads.push({ table, column, size: values.length });
        return api;
      },
      not: (column, operator, value) => {
        state.not.push([column, operator, value]);
        return api;
      },
      order: () => api,
      range: async (fromIndex, toIndex) => {
        ranges.push({ table, from: fromIndex, to: toIndex });
        const rows = (tables[table] ?? []).filter((row) => rowMatches(row, state));
        return { data: rows.slice(fromIndex, toIndex + 1), error: null };
      },
      insert: async (row) => write('insert', row),
      upsert: async (row, options) => write('upsert', row, options),
    };

    return api;
  };

  return { from, writes, ranges, inReads };
};

const okEmail = () => ({ ok: true, skipped: false, id: 'email-1' });
const okSms = () => ({ ok: true, skipped: false, messageId: 'sms-1' });

const run = (supabase, options = {}) => runDeadlineReminders({
  supabase,
  today: TODAY,
  env: { RESEND_API_KEY: 'test-key', IPROGSMS_API_TOKEN: 'test-token' },
  sendEmailImpl: async () => okEmail(),
  sendSmsImpl: async () => okSms(),
  ...options,
});

describe('deadline reminder paging', () => {
  it('reads every page without treating the API row cap as the table size', async () => {
    const rows = Array.from({ length: 1201 }, (_, id) => ({ id }));
    const offsets = [];
    const result = await fetchPagedRows(() => ({
      range: async (from, to) => {
        offsets.push([from, to]);
        return { data: rows.slice(from, to + 1), error: null };
      },
    }), { pageSize: 500 });

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1201);
    expect(offsets).toEqual([[0, 499], [500, 999], [1000, 1499]]);
  });

  it('pages every unbounded source in one run past 1,000 rows', async () => {
    const scholarships = Array.from({ length: 1201 }, (_, index) => ({
      id: `sch-${index}`,
      title: `Scholarship ${index}`,
      deadline: inDays(3),
      is_active: true,
    }));
    scholarships.push({ id: 'sch-no-deadline', title: 'No deadline', deadline: null, is_active: false });

    const applications = Array.from({ length: 1100 }, (_, index) => ({
      id: `app-${index}`,
      scholarship_id: 'sch-no-deadline',
      status: 'Draft',
      student_id: `student-${index}`,
      interview: null,
    }));

    const customDeadlines = Array.from({ length: 1201 }, (_, index) => ({
      id: `custom-${index}`,
      owner_id: `student-${index}`,
      title: `Custom ${index}`,
      deadline: inDays(30),
    }));

    const ledger = Array.from({ length: 1201 }, (_, index) => ({
      source_key: `old-reminder-${index}:student-${index}`,
    }));

    const supabase = createSupabaseStub({
      tables: {
        scholarships,
        applications,
        custom_deadlines: customDeadlines,
        notification_email_log: ledger,
        profiles: [],
      },
    });

    const result = await run(supabase);

    // 1,201 active scholarships x the 7-day and 3-day reminders.
    expect(result.dueReminders).toBe(2402);
    expect(result.deliveries).toBe(0);
    expect(supabase.writes).toHaveLength(0);

    const rangesFor = (table) => supabase.ranges
      .filter((entry) => entry.table === table)
      .map((entry) => [entry.from, entry.to]);
    for (const table of ['scholarships', 'applications', 'custom_deadlines']) {
      expect(rangesFor(table)).toEqual(expect.arrayContaining([[0, 499], [500, 999], [1000, 1499]]));
    }
    // The delivery ledger is never read whole: with no recipients there is
    // nothing to look up in it.
    expect(rangesFor('notification_email_log')).toEqual([]);
  });

  it('looks up only the candidate delivery keys, in bounded batches', async () => {
    const applications = Array.from({ length: 130 }, (_, index) => ({
      id: `app-${index}`,
      scholarship_id: 'sch-1',
      status: 'Draft',
      student_id: `student-${index}`,
      interview: null,
    }));
    const unrelatedLedger = Array.from({ length: 2000 }, (_, index) => ({ id: index, source_key: `old-key-${index}`, user_id: 'u' }));
    const supabase = createSupabaseStub({
      tables: {
        scholarships: [{ id: 'sch-1', title: 'Grant', deadline: inDays(3), is_active: true }],
        applications,
        custom_deadlines: [],
        notification_email_log: unrelatedLedger,
        profiles: [],
      },
    });

    await run(supabase);

    const ledgerReads = supabase.inReads.filter((read) => read.table === 'notification_email_log');
    expect(ledgerReads.length).toBeGreaterThan(1);
    expect(ledgerReads.every((read) => read.column === 'source_key' && read.size <= 50)).toBe(true);
    expect(supabase.ranges.filter((entry) => entry.table === 'notification_email_log').every((entry) => entry.to - entry.from < 500)).toBe(true);
  });

  it('leaves decided outcomes out of the application deadline reminders', async () => {
    const statuses = ['Draft', 'Released', 'Declined', 'Waitlisted', 'Approved', 'Rejected'];
    const supabase = createSupabaseStub({
      tables: {
        scholarships: [{ id: 'sch-1', title: 'Grant', deadline: inDays(3), is_active: true }],
        applications: statuses.map((status, index) => ({
          id: `app-${index}`, scholarship_id: 'sch-1', status, student_id: `student-${index}`, interview: null,
        })),
        custom_deadlines: [],
        notification_email_log: [],
        profiles: statuses.map((status, index) => ({
          user_id: `student-${index}`, full_name: `Student ${index}`, email: `s${index}@example.com`, phone: null, notification_preferences: {},
        })),
      },
    });
    await run(supabase);

    // Application reminders reach the Draft applicant only; the scholarship-level
    // reminder still reaches every applicant who holds a case, so assert on the
    // application kind through its ledger keys.
    const keys = supabase.writes.filter((write) => write.table === 'notification_email_log').map((write) => write.row.source_key);
    const applicationKeys = keys.filter((key) => key.includes('deadline-reminder-app-'));
    expect(applicationKeys.length).toBeGreaterThan(0);
    expect(applicationKeys.every((key) => key.includes('deadline-reminder-app-0-'))).toBe(true);
  });
});

describe('deadline sources', () => {
  it('keeps application reminders for an inactive scholarship through the batched linked read', async () => {
    const supabase = createSupabaseStub({
      tables: {
        scholarships: [{
          id: 'sch-inactive',
          title: 'Legacy Grant',
          deadline: inDays(3),
          is_active: false,
        }],
        applications: [{
          id: 'app-1',
          scholarship_id: 'sch-inactive',
          status: 'Draft',
          student_id: 'user-1',
          interview: null,
        }],
        custom_deadlines: [],
        notification_email_log: [],
        profiles: [{
          user_id: 'user-1',
          full_name: 'Student One',
          email: 'student.one@example.com',
          phone: '09171234567',
          notification_preferences: {},
        }],
      },
    });

    const emails = [];
    const result = await run(supabase, {
      sendEmailImpl: async (message) => {
        emails.push(message);
        return okEmail();
      },
    });

    // The inactive scholarship is not a scholarship-level source, but the
    // application still resolves its deadline through the batched linked read.
    expect(result.dueReminders).toBe(2);
    expect(emails).toHaveLength(2);
    expect(supabase.ranges.some((entry) => entry.table === 'scholarships')).toBe(true);
  });
});

describe('dedupe and ledger upserts', () => {  const dueFixture = () => ({
    scholarships: [],
    applications: [],
    custom_deadlines: [{
      id: 'custom-1',
      owner_id: 'user-1',
      title: 'Personal deadline',
      deadline: inDays(3),
    }],
    notification_email_log: [],
    profiles: [{
      user_id: 'user-1',
      full_name: 'Student One',
      email: 'student.one@example.com',
      phone: '09171234567',
      notification_preferences: {},
    }],
  });

  it('uses stable source keys and explicit conflict targets for both upserts', async () => {
    const supabase = createSupabaseStub({ tables: dueFixture() });
    const emails = [];
    const sms = [];

    const result = await run(supabase, {
      sendEmailImpl: async (message) => {
        emails.push(message);
        return okEmail();
      },
      sendSmsImpl: async (message) => {
        sms.push(message);
        return okSms();
      },
    });

    const notificationWrites = supabase.writes.filter((write) => write.table === 'notifications');
    const ledgerWrites = supabase.writes.filter((write) => write.table === 'notification_email_log');

    expect(result.deliveries).toBe(2);
    expect(notificationWrites).toHaveLength(2);
    expect(notificationWrites.map((write) => write.row.source_key).sort()).toEqual([
      'deadline-reminder-custom-1-3',
      'deadline-reminder-custom-1-7',
    ]);
    for (const write of notificationWrites) {
      expect(write.kind).toBe('upsert');
      expect(write.options).toEqual({ onConflict: 'profile_id,source_key', ignoreDuplicates: true });
    }

    expect(ledgerWrites).toHaveLength(2);
    expect(ledgerWrites.map((write) => write.row.source_key).sort()).toEqual([
      'deadline-reminder-custom-1-3:user-1',
      'deadline-reminder-custom-1-7:user-1',
    ]);
    for (const write of ledgerWrites) {
      expect(write.kind).toBe('upsert');
      expect(write.options).toEqual({ onConflict: 'source_key,user_id' });
    }

    expect(emails.map((message) => message.idempotencyKey).sort()).toEqual(
      ledgerWrites.map((write) => write.row.source_key).sort(),
    );
    expect(sms).toHaveLength(2);

    // The response preview is not a PII log.
    for (const entry of result.preview) {
      expect(entry).not.toHaveProperty('to');
      expect(entry).not.toHaveProperty('smsTo');
      expect(entry).not.toHaveProperty('emailError');
    }
  });

  it('skips reminders already recorded in the ledger', async () => {
    const tables = dueFixture();
    tables.notification_email_log = [
      { source_key: 'deadline-reminder-custom-1-7:user-1' },
      { source_key: 'deadline-reminder-custom-1-3:user-1' },
    ];
    const supabase = createSupabaseStub({ tables });
    const emails = [];
    const result = await run(supabase, {
      sendEmailImpl: async (message) => {
        emails.push(message);
        return okEmail();
      },
    });

    expect(result.dueReminders).toBe(2);
    expect(result.deliveries).toBe(0);
    expect(emails).toHaveLength(0);
    expect(supabase.writes).toHaveLength(0);
  });

  it('reports a ledger write error instead of treating the delivery as recorded', async () => {
    const supabase = createSupabaseStub({
      tables: dueFixture(),
      failWrite: (table) => (table === 'notification_email_log' ? { message: 'ledger unavailable' } : null),
    });
    const emails = [];

    const result = await run(supabase, {
      sendEmailImpl: async (message) => {
        emails.push(message);
        return okEmail();
      },
    });

    expect(emails).toHaveLength(2);
    expect(result.ledgerFailed).toBe(2);
    // Nothing landed in the ledger, so the next run still retries.
    expect(supabase.writes.filter((write) => write.table === 'notification_email_log')).toHaveLength(0);
  });
});

describe('failure isolation', () => {
  it('does not abort later recipients when one recipient fails', async () => {
    const supabase = createSupabaseStub({
      tables: {
        scholarships: [],
        applications: [],
        custom_deadlines: [
          { id: 'custom-1', owner_id: 'user-1', title: 'First deadline', deadline: inDays(7) },
          { id: 'custom-2', owner_id: 'user-2', title: 'Second deadline', deadline: inDays(7) },
        ],
        notification_email_log: [],
        profiles: [
          {
            user_id: 'user-1',
            full_name: 'Student One',
            email: 'student.one@example.com',
            phone: '09171234567',
            notification_preferences: {},
          },
          {
            user_id: 'user-2',
            full_name: 'Student Two',
            email: 'student.two@example.com',
            phone: '09171234568',
            notification_preferences: {},
          },
        ],
      },
      failWrite: (table, row) => (
        table === 'notification_email_log' && row.user_id === 'user-1' ? 'throw' : null
      ),
    });

    const emails = [];
    const result = await run(supabase, {
      sendEmailImpl: async (message) => {
        emails.push(message);
        return okEmail();
      },
    });

    expect(result.failed).toBe(1);
    expect(result.deliveries).toBe(1);
    expect(emails.map((message) => message.to)).toContain('student.two@example.com');

    const ledgerWrites = supabase.writes.filter((write) => write.table === 'notification_email_log');
    expect(ledgerWrites).toHaveLength(1);
    expect(ledgerWrites[0].row.user_id).toBe('user-2');
  });
});

describe('notification preference semantics', () => {
  const singleDeadline = (preferences) => ({
    tables: {
      scholarships: [],
      applications: [],
      custom_deadlines: [{
        id: 'custom-1',
        owner_id: 'user-1',
        title: 'Personal deadline',
        deadline: inDays(7),
      }],
      notification_email_log: [],
      profiles: [{
        user_id: 'user-1',
        full_name: 'Student One',
        email: 'student.one@example.com',
        phone: '09171234567',
        notification_preferences: preferences,
      }],
    },
  });

  it('suppresses a reminder whose timing is disabled without recording it', async () => {
    const supabase = createSupabaseStub(singleDeadline({
      deadlineReminders: { oneWeekBefore: false },
    }));
    const result = await run(supabase);

    expect(result.dueReminders).toBe(1);
    expect(result.suppressed).toBe(1);
    expect(result.deliveries).toBe(0);
    expect(supabase.writes).toHaveLength(0);
  });

  it('still emails and texts when only the in-app channel is disabled', async () => {
    const supabase = createSupabaseStub(singleDeadline({ inAppEnabled: false }));
    const result = await run(supabase);

    expect(result.inAppWritten).toBe(0);
    expect(result.emailsSent).toBe(1);
    expect(result.smsSent).toBe(1);
    expect(supabase.writes.filter((write) => write.table === 'notifications')).toHaveLength(0);
  });

  it('records skipped email and SMS when only the in-app channel is enabled', async () => {
    const supabase = createSupabaseStub(singleDeadline({ emailEnabled: false, smsEnabled: false }));
    const result = await run(supabase);

    expect(result.inAppWritten).toBe(1);
    expect(result.emailsSent).toBe(0);
    expect(result.smsSent).toBe(0);
    expect(result.emailSkipped).toBe(1);
    expect(result.smsSkipped).toBe(1);

    const ledgerWrite = supabase.writes.find((write) => write.table === 'notification_email_log');
    expect(ledgerWrite.row.email_status).toBe('skipped');
    expect(ledgerWrite.row.sms_status).toBe('skipped');
  });

  it('does not text students from a manual (non-scheduled) run', async () => {
    const supabase = createSupabaseStub(singleDeadline({}));
    const sms = [];
    const result = await run(supabase, {
      allowSms: false,
      sendSmsImpl: async (message) => {
        sms.push(message);
        return okSms();
      },
    });

    expect(sms).toHaveLength(0);
    expect(result.smsSent).toBe(0);
    expect(result.smsSkipped).toBe(1);

    const ledgerWrite = supabase.writes.find((write) => write.table === 'notification_email_log');
    expect(ledgerWrite.row.sms_status).toBe('skipped');
  });
});

describe('delivery attempt history', () => {
  const baseTables = (preferences) => ({
    scholarships: [{ id: 'sch-1', title: 'Grant', deadline: inDays(3), is_active: true }],
    applications: [{ id: 'app-1', scholarship_id: 'sch-1', status: 'Draft', student_id: 'user-1', interview: null }],
    custom_deadlines: [],
    notification_email_log: [],
    profiles: [{
      user_id: 'user-1',
      full_name: 'Student One',
      email: 'student.one@example.com',
      phone: '09171234567',
      notification_preferences: preferences,
    }],
  });

  it('records one row per channel for a reminder without any address or phone number', async () => {
    const supabase = createSupabaseStub({ tables: baseTables({ inAppEnabled: true, emailEnabled: true, smsEnabled: true }) });
    await run(supabase, {
      sendEmailImpl: async () => okEmail(),
      sendSmsImpl: async () => ({ ok: false, skipped: false, error: 'iprogSMS responded 502 for 09171234567' }),
    });

    const attempts = supabase.writes.filter((write) => write.table === 'notification_delivery_attempts').flatMap((write) => write.row);
    const forOneReminder = attempts.filter((row) => row.source_key.startsWith('deadline-reminder-app-1-3:'));
    expect(forOneReminder.map((row) => `${row.channel}:${row.status}`).sort()).toEqual(['email:sent', 'in-app:sent', 'sms:failed']);
    expect(forOneReminder.find((row) => row.channel === 'sms').error_code).toBe('provider-unavailable');
    expect(JSON.stringify(attempts)).not.toMatch(/example\.com|0917/);
  });

  it('does not let a failing history write change the delivery outcome', async () => {
    const supabase = createSupabaseStub({
      failWrite: (table) => (table === 'notification_delivery_attempts' ? 'throw' : null),
      tables: baseTables({}),
    });
    const result = await run(supabase);
    expect(result.failed).toBe(0);
    expect(supabase.writes.some((write) => write.table === 'notification_email_log')).toBe(true);
  });
});
