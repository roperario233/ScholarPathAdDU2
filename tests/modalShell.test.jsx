import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ModalShell, shouldDismissOverlay } from '../src/components/ui';

// Selecting the meeting link in the Interview tab used to close the whole review
// modal: the drag ended on the backdrop, so the browser dispatched the click
// there and the backdrop dismissed the dialog mid-selection.
describe('ModalShell backdrop dismissal', () => {
  it('dismisses when the press started on the backdrop itself', () => {
    const overlay = { id: 'overlay' };
    expect(shouldDismissOverlay({ pressStartedOnOverlay: true, target: overlay, currentTarget: overlay })).toBe(true);
  });

  it('keeps the modal open when the press started inside the dialog', () => {
    const overlay = { id: 'overlay' };
    expect(shouldDismissOverlay({ pressStartedOnOverlay: false, target: overlay, currentTarget: overlay })).toBe(false);
  });

  it('keeps the modal open for a click that bubbled from inside the dialog', () => {
    const overlay = { id: 'overlay' };
    expect(shouldDismissOverlay({
      pressStartedOnOverlay: true,
      target: { id: 'dialog-child' },
      currentTarget: overlay,
    })).toBe(false);
  });

  it('renders a dialog inside the backdrop', () => {
    const markup = renderToStaticMarkup(
      <ModalShell title="Interview" onClose={() => {}}>
        <p>Meeting link</p>
      </ModalShell>,
    );
    expect(markup).toContain('modal-overlay');
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('Meeting link');
  });
});
