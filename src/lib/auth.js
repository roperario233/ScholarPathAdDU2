import { hasSupabaseConfig, supabase } from './supabaseClient';
import { pickEligibilityAttributes } from './profile';

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
      message: 'Supabase is not configured. Falling back to demo mode.',
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

  const { error } = await supabase.auth.signOut();

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

const getCurrentAcademicYear = (date = new Date()) => {
  const year = date.getFullYear();
  const startYear = date.getMonth() >= 5 ? year : year - 1;
  return `${startYear}-${startYear + 1}`;
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
    const role = metadata.role === 'osa_admin'
      ? 'admissions_office'
      : ['student', 'admissions_office', 'department_chair'].includes(metadata.role)
        ? metadata.role
        : 'student';
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

    const { error: historyError } = await supabase
      .from('annual_qpi_records')
      .upsert({ user_id: userId, academic_year: getCurrentAcademicYear(), qpi }, { onConflict: 'user_id,academic_year' });
    if (historyError) return { success: false, fallback: false, message: getAuthErrorMessage(historyError, 'Unable to save your annual QPI record.') };

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

const toProfileColumns = (fields, columnMap) => Object.fromEntries(
  Object.entries(columnMap)
    .filter(([key]) => fields[key] !== undefined)
    .map(([key, column]) => [column, fields[key] === '' ? null : fields[key]]),
);

const isMissingColumnError = (error) => error?.code === '42703' || error?.code === 'PGRST204';

export const getProfileDetails = async (userId) => {
  const empty = { bio: '', eligibilityAttributes: {} };
  if (!hasSupabaseConfig || !supabase || !userId) return empty;

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('bio, eligibility_attributes')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) return empty;
    return { bio: data.bio || '', eligibilityAttributes: pickEligibilityAttributes(data.eligibility_attributes) };
  } catch {
    return empty;
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
      message: 'Supabase is not configured. Falling back to demo mode.',
    };
  }

  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: getAuthRedirectUrl(),
        queryParams: {
          hd: 'addu.edu.ph',
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
