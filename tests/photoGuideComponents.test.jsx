import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import PhotoGuide from '../src/components/PhotoGuide';
import ProfileAvatar from '../src/components/ProfileAvatar';
import { PHOTO_GUIDES } from '../src/lib/photoGuide';

describe('PhotoGuide', () => {
  // React escapes apostrophes in text nodes; compare the readable copy.
  const readable = (html) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');

  it('renders every bullet for the applicant photo', () => {
    const html = readable(renderToStaticMarkup(<PhotoGuide documentType="Applicant Photo" defaultOpen />));
    PHOTO_GUIDES['Applicant Photo'].points.forEach((point) => expect(html).toContain(point));
  });

  it('renders every bullet for the residence photos', () => {
    const html = readable(renderToStaticMarkup(<PhotoGuide documentType="Photos of Residence" defaultOpen />));
    PHOTO_GUIDES['Photos of Residence'].points.forEach((point) => expect(html).toContain(point));
  });

  it('renders nothing for a profile photo, which has no guide', () => {
    expect(renderToStaticMarkup(<PhotoGuide />)).toBe('');
  });
});

describe('ProfileAvatar', () => {
  it('falls back to the initials placeholder without a photo', () => {
    const html = renderToStaticMarkup(<ProfileAvatar name="Maria Santos" />);
    expect(html).toContain('MS');
  });

  it('renders the signed photo URL when one is available', () => {
    const html = renderToStaticMarkup(<ProfileAvatar name="Maria Santos" src="https://example.test/avatar.jpg" />);
    expect(html).toContain('src="https://example.test/avatar.jpg"');
  });
});
