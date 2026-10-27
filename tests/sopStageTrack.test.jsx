import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SopStageTrack } from '../src/components/ApplicationParts';

// Nine labelled pills wrapped into three lines inside the review-modal header on
// a phone, so below `sm` the track becomes a segmented bar under a position
// caption. The stage names must survive in the markup for assistive tech.
describe('SopStageTrack', () => {
  const stageNames = [
    'Submitted',
    'Under Review',
    'For Verification',
    'Awaiting Endorsement',
    'Endorsement',
    'Interview',
    'Recommended',
    'Approved',
    'Released',
  ];

  it('keeps every stage name in the markup behind the compact bar', () => {
    const markup = renderToStaticMarkup(<SopStageTrack status="Recommended" />);
    stageNames.forEach((name) => expect(markup).toContain(`>${name}</span>`));
    expect(markup).toContain('sr-only sm:not-sr-only');
  });

  it('names the position in a caption that only shows below `sm`', () => {
    const markup = renderToStaticMarkup(<SopStageTrack status="Recommended" />);
    expect(markup).toContain('Standard Procedure stage 7 of 9');
    expect(markup).toMatch(/sm:hidden">Standard Procedure stage 7 of 9/);
  });

  it('marks exactly one stage as the current step', () => {
    const markup = renderToStaticMarkup(<SopStageTrack status="Recommended" />);
    expect((markup.match(/aria-current="step"/g) || []).length).toBe(1);
    expect(markup).toMatch(/aria-current="step"[^>]*><span[^>]*>Recommended</);
  });

  it('keeps the neutral badge for a status outside the Standard Procedure track', () => {
    const markup = renderToStaticMarkup(<SopStageTrack status="Draft" />);
    expect(markup).toContain('Draft — not yet in the SOP pipeline');
    expect(markup).not.toContain('SOP stage');
  });
});
