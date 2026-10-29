import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildSupportChatScriptUrl,
  getSupportChatConfig,
  getSupportChatVisitor,
  SUPPORT_CHAT_OWNER_KEY,
  SUPPORT_CHAT_SCRIPT_ID,
  SUPPORT_CHAT_Z_INDEX,
  syncSupportChat,
  teardownSupportChat,
} from '../src/lib/supportChat';

const createDom = () => {
  const elements = [];
  const makeParent = () => ({
    appendChild(element) {
      element.parentNode = this;
      elements.push(element);
      return element;
    },
    insertBefore(element) {
      element.parentNode = this;
      elements.push(element);
      return element;
    },
  });
  const head = makeParent();
  const body = makeParent();
  const doc = {
    head,
    body,
    createElement: (tagName) => ({ tagName, remove: vi.fn(function remove() {
      const index = elements.indexOf(this);
      if (index >= 0) elements.splice(index, 1);
    }) }),
    getElementById: (id) => elements.find((element) => element.id === id) || null,
    getElementsByTagName: () => [],
    querySelectorAll: (selector) => (selector === '[id^="tawk"]'
      ? elements.filter((element) => String(element.id || '').startsWith('tawk'))
      : []),
  };
  return { doc, elements };
};

describe('student tawk.to support chat', () => {
  let win;
  let doc;
  let elements;

  beforeEach(() => {
    ({ doc, elements } = createDom());
    win = {};
  });

  it('requires a property id and defaults the widget id', () => {
    expect(getSupportChatConfig({ VITE_TAWK_PROPERTY_ID: '  ', VITE_TAWK_WIDGET_ID: '' })).toEqual({
      configured: false,
      propertyId: '',
      widgetId: 'default',
    });
    expect(getSupportChatConfig({ VITE_TAWK_PROPERTY_ID: 'property-1' })).toEqual({
      configured: true,
      propertyId: 'property-1',
      widgetId: 'default',
    });
  });

  it('builds the embed URL and includes only non-empty visitor fields', () => {
    expect(buildSupportChatScriptUrl({ propertyId: 'property-1', widgetId: 'default' }))
      .toBe('https://embed.tawk.to/property-1/default');
    expect(getSupportChatVisitor({ fullName: '  Student One ', email: ' student@example.edu ' }))
      .toEqual({ name: 'Student One', email: 'student@example.edu' });
    expect(getSupportChatVisitor({ fullName: ' ', email: '' })).toBeNull();
  });

  it('does not inject a widget for staff or when configuration is missing', () => {
    const config = { VITE_TAWK_PROPERTY_ID: 'property-1' };
    expect(syncSupportChat({ role: 'admissions_head', ownerId: 'staff-1', env: config, win, doc }).reason)
      .toBe('role-not-eligible');
    expect(syncSupportChat({ role: 'student', ownerId: 'student-1', env: {}, win, doc }).reason)
      .toBe('not-configured');
    expect(elements).toHaveLength(0);
    expect(win.Tawk_API).toBeUndefined();
  });

  it('injects one script for the student and updates visitor identity idempotently', () => {
    const env = { VITE_TAWK_PROPERTY_ID: 'property-1', VITE_TAWK_WIDGET_ID: 'widget-1' };
    const visitor = { name: 'Student One', email: 'student@example.edu' };
    expect(syncSupportChat({ role: 'student', ownerId: 'student-1', visitor, env, win, doc })).toMatchObject({ ok: true });
    const script = doc.getElementById(SUPPORT_CHAT_SCRIPT_ID);
    expect(script).toMatchObject({
      async: true,
      src: 'https://embed.tawk.to/property-1/widget-1',
    });
    expect(win.Tawk_API).toMatchObject({ visitor, customStyle: { zIndex: SUPPORT_CHAT_Z_INDEX } });
    expect(win[SUPPORT_CHAT_OWNER_KEY]).toBe('student-1');

    const result = syncSupportChat({
      role: 'student',
      ownerId: 'student-1',
      visitor: { name: 'Updated Name' },
      env,
      win,
      doc,
    });
    expect(result.alreadyLoaded).toBe(true);
    expect(elements.filter((element) => element.id === SUPPORT_CHAT_SCRIPT_ID)).toHaveLength(1);
    expect(win.Tawk_API.visitor).toEqual({ name: 'Updated Name' });
  });

  it('shuts down and clears the injected script and Tawk globals on teardown', () => {
    const shutdown = vi.fn();
    const hideWidget = vi.fn();
    win.Tawk_API = { shutdown, hideWidget };
    win.Tawk_LoadStart = new Date();
    win[SUPPORT_CHAT_OWNER_KEY] = 'student-1';
    const script = doc.createElement('script');
    script.id = SUPPORT_CHAT_SCRIPT_ID;
    doc.head.appendChild(script);
    const widget = doc.createElement('div');
    widget.id = 'tawk-bubble';
    doc.body.appendChild(widget);

    teardownSupportChat({ win, doc });

    expect(shutdown).toHaveBeenCalledOnce();
    expect(hideWidget).toHaveBeenCalledOnce();
    expect(elements).toHaveLength(0);
    expect(win.Tawk_API).toBeUndefined();
    expect(win.Tawk_LoadStart).toBeUndefined();
    expect(win[SUPPORT_CHAT_OWNER_KEY]).toBeUndefined();
  });
});