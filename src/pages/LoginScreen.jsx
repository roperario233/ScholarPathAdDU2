import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, ChevronDown, Eye, EyeOff, LoaderCircle, Moon, Search, Sun } from 'lucide-react';
import bgImage from '../../pictures/picture1.png';
import logoImage from '../../pictures/logo.png';
import { signInWithGoogle } from '../lib/auth';
import { ModalShell } from '../components/ui';


// Supabase Auth reports Google sign-in failures through the return URL instead
// of throwing, so the login screen inspects the query string and hash for the
// redirect error payload (GoTrue adds `sb` plus `error`/`error_code`/
// `error_description`) and surfaces a readable message instead of failing
// silently.
const readAuthRedirectError = () => {
  if (typeof window === 'undefined') return null;

  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const queryParams = new URLSearchParams(window.location.search);
  const readParam = (key) => hashParams.get(key) || queryParams.get(key) || '';

  const error = readParam('error');
  const errorCode = readParam('error_code');
  if (!error && !errorCode && !hashParams.has('sb')) return null;

  const description = readParam('error_description').slice(0, 160);
  const message = error === 'access_denied' || errorCode === 'access_denied'
    ? 'Google sign-in was cancelled or this account is not permitted to sign in.'
    : 'Google sign-in could not be completed. Please try again or use email sign-in.';

  return { message: description ? `${message} (${description})` : message };
};

// Reusable so a handled redirect error does not stay in the address bar and
// resurface on the next reload. Successful hash tokens are left untouched.
const clearAuthRedirectParams = () => {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;

  const params = new URLSearchParams(window.location.search);
  ['error', 'error_code', 'error_description'].forEach((key) => params.delete(key));
  const query = params.toString();
  window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
};

function SelectPicker({ label, value, onChange, options, idPrefix }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selectableOptions = options.filter((option) => !option.isGroup);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredOptions = options.filter((option) => option.isGroup || !normalizedQuery || option.label.toLowerCase().includes(normalizedQuery));

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const selectedOption = selectableOptions.find((option) => option.value === value) ?? selectableOptions[0];

  const chooseOption = (nextValue) => {
    onChange(nextValue);
    setOpen(false);
    setQuery('');
  };

  const handleKeyDown = (event) => {
    if (!open && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      setOpen(true);
    }
  };

  return (
    <div className="relative grid gap-2" onKeyDown={handleKeyDown}>
      <span className="text-sm font-semibold text-app-text">{label}</span>
      <button
        type="button"
        className="flex min-h-12 w-full items-center justify-between gap-3 rounded-control border border-app-border bg-app-surface px-4 py-3 text-left text-app-text shadow-sm transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20"
        onClick={() => setOpen((previous) => !previous)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${idPrefix}-list`}
      >
        <strong className="truncate text-sm">{selectedOption.label}</strong>
        <ChevronDown className="h-5 w-5 shrink-0 text-app-muted" size={18} aria-hidden="true" />
      </button>

      {open && createPortal(<ModalShell title={`Choose ${label}`} onClose={() => { setOpen(false); setQuery(''); }} className="select-picker-modal" overlayClassName="select-picker-modal-overlay">
        <div className="select-picker-search relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-app-muted" size={17} aria-hidden="true" />
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${label.toLowerCase()}`} aria-label={`Search ${label}`} className="pl-10" />
        </div>
        <div className="select-picker-modal-list" id={`${idPrefix}-list`} role="listbox" aria-label={label}>
          {filteredOptions.length ? filteredOptions.map((option) => option.isGroup ? (
            <div key={option.value} className="select-picker-group" role="presentation">{option.label}</div>
          ) : (
            <button key={option.value} type="button" role="option" aria-selected={value === option.value} className={`select-picker-option ${value === option.value ? 'is-selected' : ''}`} onClick={() => chooseOption(option.value)}>
              <span className="min-w-0 flex-1"><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
              {value === option.value && <Check size={17} aria-hidden="true" />}
            </button>
          )) : <p className="select-picker-empty">No {label.toLowerCase()} options match your search.</p>}
        </div>
      </ModalShell>, document.body)}
    </div>
  );
}

export default function LoginScreen({ onLogin, onSignUp, onForgotPassword, rememberedEmail, isRemembered, theme, onToggleTheme }) {
  const [email, setEmail] = useState(rememberedEmail || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(isRemembered || false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackTone, setFeedbackTone] = useState('info');
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [showCreateAccount, setShowCreateAccount] = useState(false);
  const [showCreatePassword, setShowCreatePassword] = useState(false);
  const [createAccountData, setCreateAccountData] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    role: 'student',
    studentId: '',
  });
  const [createAccountSuccess, setCreateAccountSuccess] = useState(false);

  useEffect(() => {
    const redirectError = readAuthRedirectError();
    if (!redirectError) return;

    setFeedbackMessage(redirectError.message);
    setFeedbackTone('error');
    clearAuthRedirectParams();
  }, []);

  const submitLogin = async (event) => {
    event.preventDefault();
    setIsSubmitting(true);
    setFeedbackMessage('');
    setFeedbackTone('info');

    const result = await onLogin({ email, password, rememberMe });

    if (result?.success) {
      setFeedbackMessage(result.fallback ? 'Signed in using the demo mode fallback.' : 'Signed in successfully.');
      setFeedbackTone(result.fallback ? 'info' : 'success');
    } else {
      setFeedbackMessage(result?.message || 'Unable to sign in. Please check your credentials.');
      setFeedbackTone('error');
    }

    setIsSubmitting(false);
  };

  const handleForgotPassword = async (event) => {
    event.preventDefault();
    setFeedbackMessage('');
    setFeedbackTone('info');

    const result = await onForgotPassword({ email: forgotEmail });

    if (result?.success) {
      setResetSent(true);
      setFeedbackMessage(result.message);
      setFeedbackTone('success');
      return;
    }

    setFeedbackMessage(result?.message || 'Unable to send a reset link right now.');
    setFeedbackTone('error');
  };

  const handleCreateAccount = async (event) => {
    event.preventDefault();
    setFeedbackMessage('');
    setFeedbackTone('info');

    const result = await onSignUp({
      fullName: createAccountData.fullName,
      email: createAccountData.email,
      password: createAccountData.password,
      role: createAccountData.role,
      studentId: createAccountData.studentId,
    });

    if (result?.success) {
      setCreateAccountSuccess(true);
      setFeedbackMessage(result.message);
      setFeedbackTone('success');
      setTimeout(() => {
        setShowCreateAccount(false);
        setCreateAccountSuccess(false);
        setCreateAccountData({
          fullName: '',
          email: '',
          password: '',
          confirmPassword: '',
          role: 'student',
          studentId: '',
        });
        setFeedbackMessage('');
        setFeedbackTone('info');
      }, 2000);
      return;
    }

    const errorMsg = result?.message || 'Unable to create your account right now.';
    setFeedbackMessage(errorMsg);
    setFeedbackTone('error');
  };

   const updateCreateAccountData = (field, value) => {
     setCreateAccountData(prev => ({ ...prev, [field]: value }));
   };

   const handleGoogleSignIn = async () => {
     setIsGoogleLoading(true);
     setFeedbackMessage('');
     setFeedbackTone('info');

     const result = await signInWithGoogle();

     if (result?.success && result?.fallback) {
       setFeedbackMessage(
         result?.message?.includes('not configured')
           ? 'Google Sign-In requires Supabase configuration. Please add your Supabase credentials to enable OAuth. Contact your administrator to set up Google OAuth provider in the Supabase dashboard.'
           : 'Google Sign-In is currently unavailable. Please try email sign-in instead.'
       );
       setFeedbackTone('info');
     } else if (result?.success) {
       setFeedbackMessage('Redirecting to Google sign-in...');
       setFeedbackTone('success');
     } else {
       const errorMsg = result?.message || 'Unable to sign in with Google.';
       if (errorMsg.includes('provider') || errorMsg.includes('enabled')) {
         setFeedbackMessage(
           'Google Sign-In is not yet configured. Your administrator needs to enable the Google provider in the Supabase Authentication settings. You can still sign in with your email and password.'
         );
       } else {
         setFeedbackMessage(errorMsg);
       }
       setFeedbackTone('error');
     }

     setIsGoogleLoading(false);
   };

    const togglePasswordVisibility = () => {
     setShowPassword((prev) => !prev);
   };

   return (
     <div className="login-screen" style={{ '--login-bg': `url(${bgImage})` }}>
      <div className="login-overlay" />
      <button
        type="button"
         className="fixed bottom-4 left-4 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full border border-app-border bg-app-surface text-app-text shadow-card transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20 sm:bottom-5 sm:left-5"
        onClick={onToggleTheme}
        aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
        title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
      >
         <span aria-hidden="true">
          {theme === 'light' ? <Moon className="icon-moon" size={20} /> : <Sun className="icon-sun" size={20} />}
        </span>
      </button>
      {!showCreateAccount ? (
         <section className="grid w-full max-w-5xl gap-5 rounded-app border border-app-border bg-app-card p-5 shadow-app backdrop-blur sm:p-6 lg:grid-cols-[1.05fr_0.95fr]">
           <div className="grid content-start gap-4 rounded-app bg-gradient-to-br from-blue-500/10 to-slate-950/20 p-5 sm:p-6">
             <div className="inline-flex items-center gap-3">
               <img src={logoImage} alt="Ateneo de Davao University logo" className="h-12 w-12 rounded-full border border-white/20 bg-white/10 object-contain p-1" />
               <span className="text-xl font-extrabold text-app-text">ScholarPath AdDU</span>
            </div>
             <h1 className="hidden text-3xl font-extrabold leading-tight text-app-text sm:block lg:text-5xl">Sign in to your scholarship workspace</h1>
          </div>

           <form className="grid content-center gap-4 p-1 sm:p-3" onSubmit={submitLogin}>
             <label className="grid gap-2">
               <span className="text-sm font-semibold text-app-text">Email</span>
              <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="Email" />
            </label>
             <label className="grid gap-2">
               <span className="text-sm font-semibold text-app-text">Password</span>
               <div className="relative">
                 <input
                   value={password}
                   onChange={(event) => setPassword(event.target.value)}
                   type={showPassword ? 'text' : 'password'}
                   placeholder="Password"
                   id="login-password-input"
                 />
                 <button
                   type="button"
                  className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center justify-center rounded-lg p-2 text-app-muted hover:bg-app-surface hover:text-app-text focus:outline-none focus:ring-4 focus:ring-blue-500/20"
                   onClick={togglePasswordVisibility}
                   aria-label={showPassword ? 'Hide password' : 'Show password'}
                   title={showPassword ? 'Hide password' : 'Show password'}
                   tabIndex={-1}
                 >
                   {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                 </button>
               </div>
             </label>
             <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="login-remember-label inline-flex min-w-0 cursor-pointer items-center gap-2 text-sm text-app-text">
                <input className="login-remember-checkbox h-4 w-4 shrink-0 accent-[var(--primary)]" type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} />
                 <span>Remember me</span>
              </label>
               <button type="button" className="text-sm font-semibold text-app-primary hover:opacity-80" onClick={() => {
                setFeedbackMessage('');
                setFeedbackTone('info');
                setResetSent(false);
                setShowForgotPassword(true);
              }}>Forgot password?</button>
            </div>
            {feedbackMessage && (
               <div className={`feedback-banner w-full rounded-xl border px-3 py-3 text-sm ${feedbackTone === 'error' ? 'feedback-banner--error border-rose-400/30 bg-rose-500/10 text-rose-200' : feedbackTone === 'success' ? 'feedback-banner--success border-emerald-400/30 bg-emerald-500/10 text-emerald-200' : 'feedback-banner--info border-sky-400/30 bg-sky-500/10 text-sky-200'}`} role="status">
                {feedbackMessage}
              </div>
            )}
            <button className="inline-flex min-h-10 items-center justify-center rounded-xl bg-gradient-to-br from-ateneo-strong via-ateneo to-ateneo-bright px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60 full-width" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Signing inâ¦' : 'Sign in'}
            </button>
             <div className="flex items-center gap-3 text-sm text-app-muted before:h-px before:flex-1 before:bg-app-border after:h-px after:flex-1 after:bg-app-border">
               <span>or</span>
             </div>
             <div className="segmented-auth-actions flex items-stretch overflow-hidden rounded-xl border border-app-border bg-app-surface">
             <button
               type="button"
               className="segmented-auth-action segmented-auth-action--google inline-flex min-h-10 min-w-0 flex-1 items-center justify-center gap-2 border-r border-app-border bg-transparent px-3 py-2 text-sm font-semibold text-app-text transition hover:bg-blue-500/10 focus:outline-none focus:ring-4 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60"
               onClick={handleGoogleSignIn}
               disabled={isGoogleLoading}
             >
               {isGoogleLoading ? (
                  <span className="inline-flex items-center gap-2">
                   <LoaderCircle className="spinner-icon" size={20} />
                    Signing in...
                 </span>
               ) : (
                 <>
                     <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#1f2937"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34a853"/>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#fbbc05"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#ea4335"/>
                     </svg>
                    <span>Google sign in</span>
                 </>
               )}
             </button>
            <button type="button" className="segmented-auth-action segmented-auth-action--create inline-flex min-h-10 min-w-0 flex-1 items-center justify-center bg-transparent px-3 py-2 text-sm font-semibold text-app-text transition hover:bg-blue-500/10 focus:outline-none focus:ring-4 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60" onClick={() => {
              setFeedbackMessage('');
              setFeedbackTone('info');
              setShowCreateAccount(true);
            }}>Create account</button>
            </div>
          </form>
        </section>
      ) : (
         <section className="create-account-section my-4 grid w-full max-w-2xl gap-5 rounded-app border border-app-border bg-app-card p-5 shadow-app backdrop-blur sm:my-6 sm:p-6">
           <div className="create-account-header grid gap-2 px-1 pt-1">
             <button type="button" className="create-account-back inline-flex w-fit items-center gap-2 bg-transparent px-0 py-1 text-sm font-semibold text-app-primary hover:bg-transparent hover:opacity-80 focus:outline-none focus:ring-4 focus:ring-blue-500/20" onClick={() => {
              setFeedbackMessage('');
              setFeedbackTone('info');
              setShowCreateAccount(false);
            }}>
              <ArrowLeft size={16} /> Back
            </button>
             <h1 className="m-0 text-center text-2xl font-bold text-app-text">Create your account</h1>
          </div>

          {feedbackMessage && !createAccountSuccess && (
             <div className={`feedback-banner w-full rounded-xl border px-3 py-3 text-sm ${feedbackTone === 'error' ? 'feedback-banner--error border-rose-400/30 bg-rose-500/10 text-rose-200' : feedbackTone === 'success' ? 'feedback-banner--success border-emerald-400/30 bg-emerald-500/10 text-emerald-200' : 'feedback-banner--info border-sky-400/30 bg-sky-500/10 text-sky-200'}`} role="status">
              {feedbackMessage}
            </div>
          )}

          {createAccountSuccess ? (
            <div className="grid place-items-center gap-4 p-4 text-center">
              <div className="grid h-14 w-14 place-items-center rounded-full bg-emerald-500/15 text-emerald-400"><Check size={24} /></div>
              <p className="m-0 text-lg font-semibold text-app-text">Account created successfully!</p>
              <p className="m-0 text-sm text-app-muted">You can now sign in with your email and password.</p>
              <button type="button" className="inline-flex min-h-10 w-full items-center justify-center rounded-xl bg-gradient-to-br from-ateneo-strong via-ateneo to-ateneo-bright px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60" onClick={() => {
                setShowCreateAccount(false);
                setCreateAccountSuccess(false);
                setCreateAccountData({
                  fullName: '',
                  email: '',
                  password: '',
                  confirmPassword: '',
                  role: 'student',
                  studentId: '',
                });
              }}>Back to sign in</button>
            </div>
          ) : (
            <form className="grid gap-4" onSubmit={handleCreateAccount}>
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-app-text">Full Name</span>
                <input
                  type="text"
                  value={createAccountData.fullName}
                  onChange={(e) => updateCreateAccountData('fullName', e.target.value)}
                  placeholder="Your full name"
                  required
                />
              </label>
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-app-text">Email</span>
                <input
                  type="email"
                  value={createAccountData.email}
                  onChange={(e) => updateCreateAccountData('email', e.target.value)}
                  placeholder="AdDU Email"
                  required
                />
              </label>
              <div className="grid gap-2">
                <span className="text-sm font-semibold text-app-text">Account type</span>
                <div className="rounded-xl border border-app-border bg-app-surface px-4 py-3 text-sm text-app-text">
                  <strong>Student</strong>
                  <p className="mt-1 text-xs text-app-muted">Admissions Office and Department Chair accounts are provisioned by an administrator.</p>
                </div>
              </div>
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-app-text">Password</span>
                <div className="relative">
                  <input
                    className="pr-12"
                    type={showCreatePassword ? 'text' : 'password'}
                    value={createAccountData.password}
                    onChange={(e) => updateCreateAccountData('password', e.target.value)}
                    placeholder="Password"
                    required
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-app-muted transition hover:bg-app-surface hover:text-app-text focus:outline-none focus:ring-4 focus:ring-blue-500/20"
                    onClick={() => setShowCreatePassword((previous) => !previous)}
                    aria-label={showCreatePassword ? 'Hide password' : 'Show password'}
                    title={showCreatePassword ? 'Hide password' : 'Show password'}
                  >
                    {showCreatePassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
              </label>
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-app-text">Confirm Password</span>
                <div className="relative">
                  <input
                    className="pr-12"
                    type={showCreatePassword ? 'text' : 'password'}
                    value={createAccountData.confirmPassword}
                    onChange={(e) => updateCreateAccountData('confirmPassword', e.target.value)}
                    placeholder="Confirm password"
                    required
                  />
                </div>
              </label>
              <button className="inline-flex min-h-10 w-full items-center justify-center rounded-xl bg-gradient-to-br from-ateneo-strong via-ateneo to-ateneo-bright px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60" type="submit">Create account</button>
            </form>
          )}
        </section>
      )}
      {showForgotPassword && (
        <div className="modal-overlay" onClick={() => setShowForgotPassword(false)}>
          <div className="w-full max-w-[420px] rounded-app border border-app-border bg-app-card p-5 shadow-app backdrop-blur" onClick={(e) => e.stopPropagation()}>
            <h2 className="m-0 text-2xl font-bold text-app-text">Reset your password</h2>
            <p className="mt-2 text-sm text-app-muted">Enter your email address and we’ll send you a password reset link.</p>
            {feedbackMessage && (
              <div className={`feedback-banner w-full rounded-xl border px-3 py-3 text-sm ${feedbackTone === 'error' ? 'feedback-banner--error border-rose-400/30 bg-rose-500/10 text-rose-200' : feedbackTone === 'success' ? 'feedback-banner--success border-emerald-400/30 bg-emerald-500/10 text-emerald-200' : 'feedback-banner--info border-sky-400/30 bg-sky-500/10 text-sky-200'}`} role="status">
                {feedbackMessage}
              </div>
            )}
            {resetSent ? (
              <div className="grid place-items-center gap-3 py-6 text-center">
                <div className="grid h-14 w-14 place-items-center rounded-full bg-emerald-500/15 text-emerald-400"><Check size={24} /></div>
                <p className="m-0 text-sm text-app-text">Reset link sent to <strong>{forgotEmail}</strong></p>
                <p className="m-0 text-sm text-app-muted">Check your email for further instructions.</p>
              </div>
            ) : (
                <form className="grid gap-4" onSubmit={handleForgotPassword}>
                <label className="grid gap-2">
                  <span className="text-sm font-semibold text-app-text">Email address</span>
                  <input
                    type="email"
                    value={forgotEmail}
                    onChange={(event) => setForgotEmail(event.target.value)}
                    placeholder="AdDU Email"
                    required
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
              <button type="button" className="text-sm font-semibold text-app-primary hover:opacity-80" onClick={() => {
                setFeedbackMessage('');
                setFeedbackTone('info');
                setResetSent(false);
                setShowForgotPassword(true);
              }}>Forgot password?</button>
                  <button type="submit" className="inline-flex min-h-10 items-center justify-center rounded-xl bg-gradient-to-br from-ateneo-strong via-ateneo to-ateneo-bright px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60" disabled={!forgotEmail}>Send reset link</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export { SelectPicker };
