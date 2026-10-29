import { hasSupabaseConfig, supabase } from './supabaseClient';
import { getCurrentAcademicYear, pickEligibilityAttributes } from './profile';

const getAuthErrorMessage = (error, fallbackMessage) => {
  if (!error) return fallbackMessage;
  if (typeof error === 'string') return error;
  if (error.message) return error.message;
  if (error.error_description) return error.error_description;
  if (error.msg) return error.msg;

  try {
    const serialized = JSON.stringify(error);
    return serialized && serialized !== '{}' ? serialized : fallbackMessage;
  } catch {
    return fallbackMessage;
  }
};

// Supabase Auth only returns the browser to a URL that its dashboard has
// allow-listed (Authentication -> URL Configuration). When the requested
// redirect is not allow-listed, the Supabase Auth server silently substitutes
// its configured Site URL, which is often still `http://localhost:3000` for a
// prototype project. Prefer an explicit canonical site URL when one is
// configured for the deployed build, and otherwise fall back to the origin the
// prototype is currently served from, including the Vite base path.
export const getAuthRedirectUrl = () => {
  if (typeof window === 'undefined') return undefined;

  const configuredSiteUrl = import.meta.env.VITE_SITE_URL?.trim();
  if (configuredSiteUrl) {
    return configuredSiteUrl.endsWith('/') ? configuredSiteUrl : `${configuredSiteUrl}/`;
  }

  const basePath = import.meta.env.BASE_URL || '/';
  return `${window.location.origin}${basePath.startsWith('/') ? basePath : `/${basePath}`}`;
};

export const signInWithEmailPassword = async ({ email, password }) => {
  if (!hasSupabaseConfig || !supabase) {
    return {
      success: false,
      fallback: true,
      message: 'Sign-in is unavailable because the Supabase workspace is not configured.',
    };
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      return { success: false, fallback: false, message: getAuthErrorMessage(error, 'Unable to sign in.') };
    }

    return { success: true, fallback: false, user: data.user, session: data.session };
  } catch (error) {
    return { success: false, fallback: false, message: getAuthErrorMessage(error, 'Unable to sign in.') };
  }
};

export const signUpWithEmailPassword = async ({ email, password, fullName, role, studentId }) => {
  if (!hasSupabaseConfig || !supabase) {
    return {
      success: false,
      fallback: true,
      message: 'Supabase is not configured. Please add your Supabase credentials to the environment first.',
    };
  }

  try {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          full_name: fullName.trim(),
          role,
          student_id: studentId?.trim() || null,
        },
        // Confirmation emails return to the canonical site URL instead of the
        // Supabase project's default Site URL.
        emailRedirectTo: getAuthRedirectUrl(),
      },
    });

    if (error) {
      return { success: false, fallback: false, message: getAuthErrorMessage(error, 'Unable to create your account.') };
    }

    return {
      success: true,
      fallback: false,
      user: data.user,
      session: data.session,
      message: data.session ? 'Account created successfully.' : 'Account created. Please confirm your email before signing in.',
    };
  } catch (error) {
    return { success: false, fallback: false, message: getAuthErrorMessage(error, 'Unable to create your account.') };
  }
};

export const resetPasswordForEmail = async ({ email }) => {
  if (!hasSupabaseConfig || !supabase) {
    return {
      success: false,
      fallback: true,
      message: 'Supabase is not configured. Please add your Supabase credentials to the environment first.',
    };
  }

  const redirectTo = getAuthRedirectUrl();
  let error;
  try {
    ({ error } = await supabase.auth.resetPasswordForEmail(email.trim(), redirectTo ? { redirectTo } : undefined));
  } catch (caughtError) {
    return { success: false, fallback: false, message: getAuthErrorMessage(caughtError, 'Unable to send a reset link.') };
  }

  if (error) {
    return {
      success: false,
      fallback: false,
      message: getAuthErrorMessage(error, 'Unable to send a reset link.'),
    };
  }

  return {
    success: true,
    fallback: false,
    message: 'Password reset link sent. Check your email for further instructions.',
  };
};

export const signOutFromSupabase = async () => {
  if (!hasSupabaseConfig || !supabase) {
    return {
      success: true,
      fallback: true,
    };
  }

  // Global scope revokes all refresh tokens for this user, so an old session
  // cannot simply be resumed in a different browser after local expiry.
  const { error } = await supabase.auth.signOut({ scope: 'global' });

  if (error) {
    return {
      success: false,
      fallback: false,
      message: error.message,
    };
  }

  return {
    success: true,
    fallback: false,
  };
};

export const getSupabaseSession = async () => {
  if (!hasSupabaseConfig || !supabase) {
    return {
      session: null,
      fallback: true,
    };
  }

  const { data: { session }, error } = await supabase.auth.getSession();

  if (error) {
    return {
      session: null,
      fallback: false,
      message: error.message,
    };
  }

  return {
    session,
    fallback: false,
  };
};

// getSession() reads the locally persisted token. Use getUser() when returning
// from a suspended tab or validating a restored session so Supabase confirms
// that the access token is still accepted by the Auth service.
export const validateSupabaseSession = async () => {
  if (!hasSupabaseConfig || !supabase) {
    return { user: null, fallback: true, message: 'Supabase is not configured.' };
  }

  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) return { user: null, fallback: false, message: getAuthErrorMessage(error, 'Your session could not be verified.') };
    return { user: data?.user || null, fallback: false };
  } catch (error) {
    return { user: null, fallback: false, message: getAuthErrorMessage(error, 'Your session could not be verified.') };
  }
};

export const subscribeToSupabaseAuth = (onChange) => {
  if (!hasSupabaseConfig || !supabase || typeof onChange !== 'function') return () => {};
  const { data } = supabase.auth.onAuthStateChange((event, session) => onChange(event, session));
  return () => data?.subscription?.unsubscribe?.();
};

export const getUserProfile = async (userId) => {
  if (!hasSupabaseConfig || !supabase || !userId) return { profile: null, fallback: true };

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('full_name, role, email, phone, department, degree_program, student_number, qpi, household_income, has_active_government_grant')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) return { profile: null, fallback: false, message: getAuthErrorMessage(error, 'Unable to load your profile.') };
    return { profile: data, fallback: false };
  } catch (error) {
    return { profile: null, fallback: false, message: getAuthErrorMessage(error, 'Unable to load your profile.') };
  }
};

export const updateUserProfile = async (userId, { degreeProgram, department, studentNumber, qpi, householdIncome, hasActiveGovernmentGrant, phone }) => {
  if (!hasSupabaseConfig || !supabase || !userId) return { success: true, fallback: true };

  try {
    // Auth users created before the profile trigger was installed may not have
    // a matching row yet. Create that parent row before writing the QPI child
    // record so annual_qpi_records_user_id_fkey can be satisfied.
    const { data: authUserResult, error: authUserError } = await supabase.auth.getUser();
    if (authUserError) {
      return { success: false, fallback: false, message: getAuthErrorMessage(authUserError, 'Unable to verify your account.') };
    }

    const authUser = authUserResult?.user;
    if (!authUser || authUser.id !== userId) {
      return { success: false, fallback: false, message: 'Your session has expired. Please sign in again.' };
    }

    const metadata = authUser.user_metadata || {};
    // Only ever a student. `user_metadata` is writable by the signed-in user, so it
    // cannot name a role; staff and reviewer roles come from an invitation the
    // Admissions Office Head records (20261051000000_account_provisioning.sql).
    const role = 'student';
    const fullName = metadata.full_name?.trim() || authUser.email?.split('@')[0] || 'ScholarPath user';

    const { error: profileEnsureError } = await supabase
      .from('profiles')
      .upsert({
        user_id: userId,
        full_name: fullName,
        role,
        email: authUser.email || null,
        student_number: metadata.student_id?.trim() || studentNumber || null,
      }, { onConflict: 'user_id', ignoreDuplicates: true });
    if (profileEnsureError) {
      return { success: false, fallback: false, message: getAuthErrorMessage(profileEnsureError, 'Unable to prepare your academic profile.') };
    }

    // An incoming first-year has no college QPI yet, so skip the annual record
    // instead of writing an empty value (mirrors updateProfileFields).
    if (qpi !== undefined && qpi !== '' && qpi !== null) {
      const { error: historyError } = await supabase
        .from('annual_qpi_records')
        .upsert({ user_id: userId, academic_year: getCurrentAcademicYear(), qpi }, { onConflict: 'user_id,academic_year' });
      if (historyError) return { success: false, fallback: false, message: getAuthErrorMessage(historyError, 'Unable to save your annual QPI record.') };
    }

    const { data, error } = await supabase
      .from('profiles')
      .update({ degree_program: degreeProgram, department, student_number: studentNumber, qpi, household_income: householdIncome, has_active_government_grant: Boolean(hasActiveGovernmentGrant), ...(phone === undefined ? {} : { phone: phone || null }), updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .select('full_name, role, email, phone, department, degree_program, student_number, qpi, household_income, has_active_government_grant')
      .single();
    if (error) return { success: false, fallback: false, message: getAuthErrorMessage(error, 'Unable to save your academic profile.') };
    return { success: true, fallback: false, profile: data };
  } catch (error) {
    return { success: false, fallback: false, message: getAuthErrorMessage(error, 'Unable to save your academic profile.') };
  }
};

// Maps camelCase profile fields to the core `profiles` columns. Only the keys
// present on the patch are written, so each My Profile section saves alone.
const coreProfileColumns = {
  fullName: 'full_name',
  phone: 'phone',
  department: 'department',
  degreeProgram: 'degree_program',
  studentNumber: 'student_number',
  qpi: 'qpi',
  householdIncome: 'household_income',
  hasActiveGovernmentGrant: 'has_active_government_grant',
};

// Columns added by 20261005140000_add_profile_details.sql. They are written in
// a separate statement so a project that has not applied the migration yet
// still saves the core profile.
const detailProfileColumns = {
  bio: 'bio',
  eligibilityAttributes: 'eligibility_attributes',
};

// Column added by 20261008000000_add_profile_details_json.sql. Written in its own
// statement so a pending migration never blocks the bio/eligibility write above.
const extraDetailProfileColumns = {
  profileDetails: 'profile_details',
};

const toProfileColumns = (fields, columnMap) => Object.fromEntries(
  Object.entries(columnMap)
    .filter(([key]) => fields[key] !== undefined)
    .map(([key, column]) => [column, fields[key] === '' ? null : fields[key]]),
);

const isMissingColumnError = (error) => error?.code === '42703' || error?.code === 'PGRST204';

export const getProfileDetails = async (userId) => {
  const empty = { bio: '', eligibilityAttributes: {}, profileDetails: {} };
  if (!hasSupabaseConfig || !supabase || !userId) return empty;

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('bio, eligibility_attributes')
      .eq('user_id', userId)
      .maybeSingle();
    const base = error || !data
      ? { bio: '', eligibilityAttributes: {} }
      : { bio: data.bio || '', eligibilityAttributes: pickEligibilityAttributes(data.eligibility_attributes) };

    // `profile_details` comes from a later migration, so it is read in its own
    // query: a project with the column pending still returns bio and eligibility.
    const { data: detailData, error: detailError } = await supabase
      .from('profiles')
      .select('profile_details')
      .eq('user_id', userId)
      .maybeSingle();
    const stored = detailData?.profile_details;
    const profileDetails = !detailError && stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};

    return { ...base, profileDetails };
  } catch {
    return empty;
  }
};

// The reviewer scope ladder (src/lib/reviewScope.js): a Dean owns a school, an
// Assistant Dean a cluster, a Chairperson a department. The three columns come from
// 20261042000001_reviewer_scope_ladder.sql, so they are read in their own tolerant
// query exactly like `profile_details`: a project with that migration pending still
// signs in, and the account simply has no scope yet (which keeps the legacy
// school-wide read for a Chairperson).
export const getProfileReviewScope = async (userId) => {
  const empty = { reviewSchool: '', reviewCluster: '', reviewDepartment: '' };
  if (!hasSupabaseConfig || !supabase || !userId) return empty;

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('review_school, review_cluster, review_department')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) return empty;
    return {
      reviewSchool: data.review_school || '',
      reviewCluster: data.review_cluster || '',
      reviewDepartment: data.review_department || '',
    };
  } catch {
    return empty;
  }
};

// A deactivated staff or reviewer account keeps its profile but holds no role
// (current_profile_role() answers null for it). `deactivated_at` comes from
// 20261051000000_account_provisioning.sql, so it is read in its own tolerant query:
// a project with the migration pending signs in as before. Never add it to
// getUserProfile's select.
export const getProfileAccountStatus = async (userId) => {
  if (!hasSupabaseConfig || !supabase || !userId) return { deactivated: false };

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('deactivated_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) return { deactivated: false };
    return { deactivated: Boolean(data.deactivated_at) };
  } catch {
    return { deactivated: false };
  }
};

// The avatar path is added by 20261026000000_add_profile_avatar.sql, so it is
// read in its own query: a project with the migration pending still loads the
// rest of the profile (the same reason profile_details is read separately).
// Never add avatar_path to getUserProfile's select, which would fail the whole
// profile load when the column is missing.
export const getProfileAvatar = async (userId) => {
  if (!hasSupabaseConfig || !supabase || !userId) return { avatarPath: '', fallback: true, synced: false };

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('avatar_path')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) return { avatarPath: '', fallback: false, synced: false };
    return { avatarPath: data?.avatar_path || '', fallback: false, synced: true };
  } catch {
    return { avatarPath: '', fallback: false, synced: false };
  }
};

// `avatarPath` is the stored object key, or null to remove the photo. The
// storage object is uploaded/deleted by src/lib/supabaseData.js; this only
// records which object is the current avatar.
export const updateProfileAvatar = async (userId, avatarPath) => {
  if (!hasSupabaseConfig || !supabase || !userId) return { success: true, fallback: true };

  try {
    const { data, error } = await supabase
      .from('profiles')
      .update({ avatar_path: avatarPath || null, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .select('user_id');
    if (error && isMissingColumnError(error)) return { success: true, fallback: false, synced: false };
    if (error) return { success: false, fallback: false, message: getAuthErrorMessage(error, 'Unable to save your profile photo.') };
    if (!data?.length) return { success: false, fallback: false, message: 'Your profile record was not found. Please sign in again.' };
    return { success: true, fallback: false, synced: true };
  } catch (error) {
    return { success: false, fallback: false, message: getAuthErrorMessage(error, 'Unable to save your profile photo.') };
  }
};

export const updateProfileFields = async (userId, fields = {}) => {
  if (!hasSupabaseConfig || !supabase || !userId) return { success: true, fallback: true };

  try {
    const updatedAt = new Date().toISOString();

    if (fields.qpi !== undefined && fields.qpi !== '' && fields.qpi !== null) {
      const { error: historyError } = await supabase
        .from('annual_qpi_records')
        .upsert({ user_id: userId, academic_year: getCurrentAcademicYear(), qpi: fields.qpi }, { onConflict: 'user_id,academic_year' });
      if (historyError) return { success: false, fallback: false, message: getAuthErrorMessage(historyError, 'Unable to save your annual QPI record.') };
    }

    const coreColumns = toProfileColumns(fields, coreProfileColumns);
    if (Object.keys(coreColumns).length) {
      const { data, error } = await supabase
        .from('profiles')
        .update({ ...coreColumns, updated_at: updatedAt })
        .eq('user_id', userId)
        .select('user_id');
      if (error) return { success: false, fallback: false, message: getAuthErrorMessage(error, 'Unable to save your profile.') };
      if (!data?.length) return { success: false, fallback: false, message: 'Your profile record was not found. Please sign in again.' };
    }

    const detailColumns = toProfileColumns(fields, detailProfileColumns);
    if (Object.keys(detailColumns).length) {
      const { error } = await supabase
        .from('profiles')
        .update({ ...detailColumns, updated_at: updatedAt })
        .eq('user_id', userId);
      if (error && isMissingColumnError(error)) return { success: true, fallback: false, detailsSynced: false };
      if (error) return { success: false, fallback: false, message: getAuthErrorMessage(error, 'Unable to save your profile details.') };
    }

    // Descriptive profile fields live in their own JSON column from a later
    // migration, so they are written separately for the same reason.
    const extraDetailColumns = toProfileColumns(fields, extraDetailProfileColumns);
    if (Object.keys(extraDetailColumns).length) {
      const { error } = await supabase
        .from('profiles')
        .update({ ...extraDetailColumns, updated_at: updatedAt })
        .eq('user_id', userId);
      if (error && isMissingColumnError(error)) return { success: true, fallback: false, detailsSynced: false };
      if (error) return { success: false, fallback: false, message: getAuthErrorMessage(error, 'Unable to save your profile details.') };
    }

    return { success: true, fallback: false, detailsSynced: true };
  } catch (error) {
    return { success: false, fallback: false, message: getAuthErrorMessage(error, 'Unable to save your profile.') };
  }
};

export const updateAccountPassword = async ({ password }) => {
  if (!hasSupabaseConfig || !supabase) {
    return { success: false, fallback: true, message: 'Password changes are available once the Supabase workspace is configured.' };
  }

  try {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return { success: false, fallback: false, message: getAuthErrorMessage(error, 'Unable to update your password.') };
    return { success: true, fallback: false, message: 'Your password has been updated.' };
  } catch (error) {
    return { success: false, fallback: false, message: getAuthErrorMessage(error, 'Unable to update your password.') };
  }
};

export const signInWithGoogle = async () => {
  if (!hasSupabaseConfig || !supabase) {
    return {
      success: false,
      fallback: true,
      message: 'Google sign-in is unavailable because the Supabase workspace is not configured.',
    };
  }

  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: getAuthRedirectUrl(),
        queryParams: {
          prompt: 'select_account',
        },
      },
    });

    if (error) {
      return { success: false, fallback: false, message: getAuthErrorMessage(error, 'Unable to sign in with Google.') };
    }

    return { success: true, fallback: false, user: data.user, session: data.session, url: data.url };
  } catch (error) {
    return { success: false, fallback: false, message: getAuthErrorMessage(error, 'Unable to sign in with Google.') };
  }
};
