// Supabase Edge Function: send-test-sms
//
// Self-service delivery check for the notification center settings. Sends one
// text to the authenticated caller's own mobile number only, so a student or
// Admissions Office administrator can confirm real iprogSMS delivery without
// waiting for a scheduled deadline reminder.
//
// Deployed with verify_jwt enabled: the caller's own JWT is the authorization,
// and the recipient is always that same user's profiles.phone. The response
// reports the number masked so a full mobile number is never echoed back.
//
// Required Edge Function secrets: IPROGSMS_API_TOKEN, IPROGSMS_PROVIDER
// (optional).

import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  formatPhilippineMobile,
  getSmsConfig,
  isSmsEnabledForUser,
  maskPhilippineMobile,
  normalizePhilippineMobile,
  renderTestSms,
  sendSms,
} from '../_shared/sms.js';

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
    .select('full_name, phone, notification_preferences')
    .eq('user_id', user.id)
    .maybeSingle();
  if (profileError) {
    return json({ error: 'Unable to load your profile' }, 500);
  }

  const preferences = profile?.notification_preferences ?? {};
  const smsEnabled = isSmsEnabledForUser(preferences);
  const smsTo = normalizePhilippineMobile(profile?.phone);
  if (!smsTo) {
    return json({
      ok: false,
      sent: false,
      skipped: true,
      reason: 'You have no Philippine mobile number on file. Add one in your academic profile first.',
    });
  }

  const env = Deno.env.toObject();
  const sms = getSmsConfig(env);
  const message = renderTestSms({
    fullName: profile?.full_name || user.email,
    smsEnabled,
  });

  const result = await sendSms({
    apiToken: sms.apiToken,
    phoneNumber: smsTo,
    message: message.message,
    provider: sms.provider,
  });

  if (result.ok) {
    return json({
      ok: true,
      sent: true,
      to: maskPhilippineMobile(smsTo),
      formatted: formatPhilippineMobile(smsTo),
      messageId: result.messageId ?? null,
      smsEnabled,
    });
  }

  return json({
    ok: false,
    sent: false,
    skipped: Boolean(result.skipped),
    reason: result.error || result.reason || 'Unable to send the test SMS',
    to: maskPhilippineMobile(smsTo),
  });
});