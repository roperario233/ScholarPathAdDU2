export const SUPPORT_CHAT_SCRIPT_ID = 'scholarpath-support-chat';
export const SUPPORT_CHAT_OWNER_KEY = '__scholarpathSupportChatOwner';
// Keep the widget below the mobile navigation (z-50) and every application
// modal (z-index 1000), while above ordinary page controls.
export const SUPPORT_CHAT_Z_INDEX = 40;

export const getSupportChatConfig = (env = import.meta.env) => {
  const propertyId = String(env?.VITE_TAWK_PROPERTY_ID || '').trim();
  const widgetId = String(env?.VITE_TAWK_WIDGET_ID || '').trim() || 'default';
  return { configured: Boolean(propertyId), propertyId, widgetId };
};

export const buildSupportChatScriptUrl = ({ propertyId, widgetId = 'default' } = {}) => (
  `https://embed.tawk.to/${encodeURIComponent(propertyId || '')}/${encodeURIComponent(widgetId || 'default')}`
);

export const getSupportChatVisitor = ({ fullName, email } = {}) => {
  const visitor = {};
  const name = String(fullName || '').trim();
  const normalizedEmail = String(email || '').trim();
  if (name) visitor.name = name;
  if (normalizedEmail) visitor.email = normalizedEmail;
  return Object.keys(visitor).length ? visitor : null;
};

const applyVisitor = (api, visitor) => {
  if (!api || !visitor || typeof api.setAttributes !== 'function') return;
  api.setAttributes(visitor, () => {});
};

export const loadSupportChat = ({ ownerId, visitor, config, win = globalThis.window, doc = globalThis.document } = {}) => {
  if (!win || !doc || !config?.configured || !config.propertyId || !ownerId) {
    return { ok: false, reason: 'not-configured' };
  }

  if (win[SUPPORT_CHAT_OWNER_KEY] === ownerId) {
    // This path also updates the visitor if the student's profile identity was
    // hydrated after the widget started; it never injects a second script.
    if (visitor) {
      win.Tawk_API = win.Tawk_API || {};
      win.Tawk_API.visitor = visitor;
      applyVisitor(win.Tawk_API, visitor);
    }
    return { ok: true, alreadyLoaded: true };
  }

  if (win[SUPPORT_CHAT_OWNER_KEY]) teardownSupportChat({ win, doc });

  const api = win.Tawk_API || {};
  api.customStyle = { ...(api.customStyle || {}), zIndex: SUPPORT_CHAT_Z_INDEX };
  if (visitor) api.visitor = visitor;
  api.onLoad = () => {
    const loadedApi = win.Tawk_API || api;
    applyVisitor(loadedApi, loadedApi.visitor);
  };
  win.Tawk_API = api;
  win.Tawk_LoadStart = new Date();
  win[SUPPORT_CHAT_OWNER_KEY] = ownerId;

  // The script id and owner marker make repeated React effects idempotent.
  if (!doc.getElementById(SUPPORT_CHAT_SCRIPT_ID)) {
    const script = doc.createElement('script');
    script.id = SUPPORT_CHAT_SCRIPT_ID;
    script.async = true;
    script.src = buildSupportChatScriptUrl(config);
    const firstScript = doc.getElementsByTagName('script')[0];
    if (firstScript?.parentNode) firstScript.parentNode.insertBefore(script, firstScript);
    else (doc.head || doc.body).appendChild(script);
  }

  return { ok: true, alreadyLoaded: false };
};

export const teardownSupportChat = ({ win = globalThis.window, doc = globalThis.document } = {}) => {
  if (!win || !doc) return;

  try {
    win.Tawk_API?.shutdown?.();
    win.Tawk_API?.hideWidget?.();
  } catch {
    // Teardown must still clear the local script and visitor when the third-party
    // widget is unavailable or its connection has already closed.
  }

  doc.getElementById(SUPPORT_CHAT_SCRIPT_ID)?.remove();
  doc.querySelectorAll('[id^="tawk"]').forEach((element) => element.remove());
  delete win.Tawk_API;
  delete win.Tawk_LoadStart;
  delete win[SUPPORT_CHAT_OWNER_KEY];
};

export const syncSupportChat = ({ role, ownerId, visitor, env = import.meta.env, win = globalThis.window, doc = globalThis.document } = {}) => {
  if (role !== 'student') {
    teardownSupportChat({ win, doc });
    return { ok: false, reason: 'role-not-eligible' };
  }
  const config = getSupportChatConfig(env);
  if (!config.configured || !ownerId) {
    teardownSupportChat({ win, doc });
    return { ok: false, reason: config.configured ? 'missing-owner' : 'not-configured' };
  }
  return loadSupportChat({ ownerId, visitor, config, win, doc });
};