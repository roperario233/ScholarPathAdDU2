// Supabase Edge Function: send-test-email
//
// Self-service delivery check for the notification center settings. Sends one
// email to the authenticated caller only, so a student or Admissions Office administrator can
// confirm real Resend delivery without waiting for a scheduled deadline
// reminder.
//
// Deployed with verify_jwt enabled: the caller's own JWT is the authorization,
// and the recipient is always that same user.
//
// Required Edge Function secrets: RESEND_API_KEY, RESEND_FROM_EMAIL,
// RESEND_FROM_NAME (optional), APP_SITE_URL (optional).

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { isEmailEnabledForUser, renderTestEmail, resolveSiteUrl } from '../_shared/email.js';
import { getResendConfig, sendEmail } from '../_shared/resend.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const authorizationHeader = req.headers.get('Authorization') ?? '';
  const token = authorizationHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return json({ error: 'Missing Authorization header' }, 401);
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  const { data: jwtUser, error: jwtError } = await supabaseAdmin.auth.getUser(token);
  if (jwtError || !jwtUser?.user) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const user = jwtUser.user;

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('full_name, email, notification_preferences')
    .eq('user_id', user.id)
    .maybeSingle();
  if (profileError) {
    return json({ error: 'Unable to load your profile' }, 500);
  }

  const preferences = profile?.notification_preferences ?? {};
  const emailEnabled = isEmailEnabledForUser(preferences);
  const recipient = profile?.email || user.email || null;
  const env = Deno.env.toObject();
  const resend = getResendConfig(env);

  const message = renderTestEmail({
    fullName: profile?.full_name || user.email,
    emailEnabled,
    siteUrl: resolveSiteUrl(env),
  });

  const result = await sendEmail({
    apiKey: resend.apiKey,
    from: resend.from,
    to: recipient,
    subject: message.subject,
    html: message.html,
    text: message.text,
    idempotencyKey: `test-email-${user.id}-${Date.now()}`,
  });

  if (result.ok) {
    return json({ ok: true, sent: true, to: recipient, emailId: result.id, emailEnabled });
  }

  return json({
    ok: false,
    sent: false,
    skipped: Boolean(result.skipped),
    reason: result.error || result.reason || 'Unable to send the test email',
    to: recipient,
  });
});
