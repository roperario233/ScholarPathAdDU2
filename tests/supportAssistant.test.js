import { describe, expect, it } from 'vitest';
import { buildAssistantKnowledge, classifySupportIntent, replyFor, shouldAssistantReply, SUPPORT_QUICK_REPLIES } from '../src/lib/supportAssistant';

describe('deterministic Support assistant', () => {
  it('classifies common questions and human requests', () => {
    expect(classifySupportIntent('What is the deadline?')).toBe('deadlines');
    expect(classifySupportIntent('How do I replace my reverted document?')).toBe('reverted-document');
    expect(classifySupportIntent('Where is my application status?')).toBe('application-status');
    expect(classifySupportIntent('I want to talk to a live agent')).toBe('live-agent');
  });

  it('classifies the shipped quick replies and common plural phrasings', () => {
    expect(SUPPORT_QUICK_REPLIES.map(classifySupportIntent)).toEqual(['deadlines', 'documents', 'application-status']);
    expect(classifySupportIntent('What documents are required?')).toBe('documents');
    expect(classifySupportIntent('What scholarships are available?')).toBe('scholarships');
    expect(classifySupportIntent('Are there any grants?')).toBe('scholarships');
    expect(classifySupportIntent('I need to replace a reverted document')).toBe('reverted-document');
  });

  it('does not mistake office-hours questions for live-agent requests', () => {
    expect(classifySupportIntent('What are the Admissions Office hours?')).toBe('office-hours');
    expect(replyFor({ message: 'What are the Admissions Office hours?', context: { availability: { online: false, officeHoursOpen: true } } })).toMatchObject({
      kind: 'answer', intent: 'office-hours',
    });
    expect(replyFor({ message: 'What are the Admissions Office hours?', context: { availability: { online: false, officeHoursOpen: true } } }).body).toContain('usual office hours');
    expect(replyFor({ message: 'Can I talk to an Admissions Office staff member?' }).kind).toBe('escalate');
  });

  it('answers greetings and thanks without a clarification fallback', () => {
    expect(replyFor({ message: 'Hi!' })).toMatchObject({ kind: 'answer', intent: 'greeting' });
    expect(replyFor({ message: 'Thanks!' }).body).toContain('You’re welcome');
  });

  it('describes the AdDU scholarship tracks without issuing a verdict', () => {
    const reply = replyFor({ message: 'What scholarships are available?' });
    expect(reply.kind).toBe('answer');
    expect(reply.intent).toBe('scholarships');
    expect(reply.body).toContain('Grant-in-Aid (GIA)');
    expect(reply.body).toContain('Working Scholar Program (WSP)');
    expect(reply.body).toContain('Jubilee Scholarship (JSF)');
    expect(reply.body).not.toContain('cannot decide eligibility');
  });

  it('routes sensitive rejection and hardship questions to an Admissions Office agent', () => {
    expect(replyFor({ message: 'Why was my application not accepted?' }).kind).toBe('escalate');
    expect(replyFor({ message: 'I have a financial emergency' }).kind).toBe('escalate');
  });

  it('does not issue an eligibility verdict', () => {
    const reply = replyFor({ message: 'Do I qualify for a scholarship?' });
    expect(reply.kind).toBe('answer');
    expect(reply.body).toContain('cannot decide eligibility');
    expect(reply.body).toContain('Smart Eligibility Checker');
  });

  it('answers status from the student-facing application records and guidance', () => {
    const reply = replyFor({
      message: 'Where is my application now?',
      context: { applications: [{ scholarshipTitle: 'GIA', status: 'For Verification' }] },
    });
    expect(reply.body).toContain('GIA: For Verification');
    expect(reply.body).toContain('documents are with the Admissions Office');
  });

  it('lists live catalog deadlines and current standing-specific document names', () => {
    const context = {
      profile: { yearStanding: 'Incoming 1st year', applicantStatus: 'Incoming First Year', isTransferee: 'No' },
      scholarships: [{ id: 'gia', title: 'Grant-in-Aid (GIA)', ruleFamily: 'general-pool', deadline: '2026-12-01' }],
    };
    expect(replyFor({ message: 'Scholarship deadlines', context }).body).toContain('Grant-in-Aid (GIA)');
    expect(buildAssistantKnowledge(context).tracks[0].requirements.length).toBeGreaterThan(0);
  });

  it('names a reverted file but never includes its staff-only reason', () => {
    const body = replyFor({
      message: 'My document was reverted',
      context: {
        applications: [{ scholarshipTitle: 'GIA', attachedDocuments: ['document-1'] }],
        documents: [{ id: 'document-1', title: 'Income Certificate', verificationStatus: 'Rejected', rejectionReason: 'Private staff-only note' }],
      },
    }).body;
    expect(body).toContain('Income Certificate');
    expect(body).not.toContain('Private staff-only note');
  });

  it('stops replying after live-agent escalation or any human reply and avoids duplicate replies', () => {
    const studentMessage = { id: 'student-msg', senderRole: 'student' };
    expect(shouldAssistantReply({ thread: { assistantEnabled: true }, messages: [studentMessage], replyingToId: 'student-msg' })).toBe(true);
    expect(shouldAssistantReply({ thread: { escalatedAt: 'now', assistantEnabled: false }, messages: [studentMessage], replyingToId: 'student-msg' })).toBe(false);
    expect(shouldAssistantReply({ thread: { escalatedAt: 'now', assistantEnabled: true }, messages: [studentMessage], replyingToId: 'student-msg' })).toBe(false);
    expect(shouldAssistantReply({ thread: { assistantEnabled: false }, messages: [studentMessage], replyingToId: 'student-msg' })).toBe(false);
    expect(shouldAssistantReply({ thread: {}, messages: [studentMessage, { senderRole: 'assistant', replyingToId: 'student-msg' }], replyingToId: 'student-msg' })).toBe(false);
    expect(shouldAssistantReply({ thread: {}, messages: [studentMessage, { senderRole: 'admissions_admin' }], replyingToId: 'student-msg' })).toBe(false);
  });
});