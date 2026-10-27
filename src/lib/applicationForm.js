// Fixed text the application shows: the scholarship essay topic, the data
// privacy notice, and the affidavit of agreement. The notice and the seven
// clauses are plain-language wording written for the prototype in the spirit of
// FORM 230-SCH; they are not a verbatim copy of the printed form.

export const ESSAY_TOPIC = 'Discuss a personal achievement that is unrelated to academics but is highly significant to you.';
export const ESSAY_TARGET_WORDS = 500;

// The instruction box printed above the essay topic on FORM 230-SCH.
export const ESSAY_INSTRUCTION = 'The essay you submit before you are interviewed should be an example of your thinking process and writing style. This writing sample allows you to express your ideas, talents, interests, and values while demonstrating your writing ability to the Scholarship Committee. We ask you to discuss the topic below in a 500-word essay that reflects your ability to think, organize, and communicate. The committee is interested in the originality of your response as well as the clarity of your expression.';

// The reminder printed under the course choices: a released grant does not allow
// a change of program without approval.
export const COURSE_SHIFT_REMINDER = 'You will not be allowed to shift to another course or program once the grant result has been released. Doing so without approval will suspend your grant.';

export const DATA_PRIVACY_NOTICE = 'The Office of Admission and Aid collects the information and documents in this application only to evaluate scholarship applications and to keep scholarship records, in line with the Data Privacy Act of 2012. They are shared only with the offices and committee members involved in the evaluation and are kept only as long as the University\'s records policy requires.';

export const AFFIDAVIT_CLAUSES = [
  'All the information and documents I submitted are true, complete, and correct, and I understand that a false statement may lead to the cancellation of my application or grant.',
  'I understand that the grant is subject to the University\'s scholarship guidelines and to the decision of the University Scholarship Committee.',
  'I will maintain the academic standing and conduct required to keep the grant.',
  'I will inform the Office of Admission and Aid of any change in my family\'s financial circumstances.',
  'I will inform the Office of Admission and Aid if I apply for or receive another scholarship or grant, and I understand that some grants cannot be held together.',
  'The results of the evaluation and the minutes of the deliberations are confidential.',
  'I agree that the University may verify the information and documents I submitted, including through an interview.',
];

export const countWords = (text) => {
  const trimmed = String(text ?? '').trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
};
