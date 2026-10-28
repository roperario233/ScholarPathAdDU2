import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Award, GraduationCap, LayoutDashboard, MapPin, PiggyBank, ShieldCheck, UserRound, Users } from 'lucide-react';
import { AcademicSection, AddressSection, BackgroundSection, FamilySection, FinancesSection, FormSectionStatusIcon, PersonalSection, ProfileOverview, SectionContinueContext, SecuritySection, getFormSectionStatusText } from '../components/ProfileSections';
import { Button } from '../components/ui';
import { getDocumentChecklist } from '../lib/applicationRequirements';
import { getApplicationFormProgress, getNextApplicationFormSection, getProfileCompleteness } from '../lib/profile';

const sections = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard, studentOnly: false },
  { key: 'personal', label: 'Personal information', icon: UserRound, studentOnly: false },
  { key: 'address', label: 'Address', icon: MapPin, studentOnly: true },
  { key: 'family', label: 'Family details', icon: Users, studentOnly: true },
  { key: 'academic', label: 'Academic profile', icon: GraduationCap, studentOnly: true },
  { key: 'finances', label: 'Household finances', icon: PiggyBank, studentOnly: true },
  { key: 'background', label: 'Eligibility background', icon: Award, studentOnly: true },
  { key: 'security', label: 'Account security', icon: ShieldCheck, studentOnly: false },
];

const STRIP_TONES = {
  complete: 'bg-emerald-500',
  incomplete: 'bg-amber-400/70',
  alert: 'bg-rose-500',
};

const menuButtonClass = (isActive) => `flex min-h-11 min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20 ${isActive ? 'bg-gradient-to-br from-ateneo-strong via-ateneo to-ateneo-bright text-white shadow-sm' : 'border border-app-border bg-app-surface text-app-text'}`;

export default function ProfileView({
  profile,
  role,
  roleLabel,
  academicPrograms = [],
  academicProgramGroups = [],
  attributeVerifications = {},
  scholarships = [],
  documents = [],
  initialSection = '',
  avatar = {},
  onSaveProfile,
  onSaveFinancialProfile,
  financialMissing = false,
  onChangeAvatar,
  onRemoveAvatar,
  onChangePassword,
  onRequestPasswordReset,
  onAttachProof,
  onUploadDocument,
  onFindScholarship,
  previewProofImpact,
}) {
  const isStudent = role === 'student';
  const visibleSections = sections.filter((section) => isStudent || !section.studentOnly);
  // A Smart Eligibility Checker link opens the section that edits the failed
  // answer; any other entry, or a section this role cannot see, opens Overview.
  const [activeSection, setActiveSection] = useState(() => (
    visibleSections.some((section) => section.key === initialSection) ? initialSection : 'overview'
  ));
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  // The section a "Save and continue" left from. The next section is chosen on
  // the render after the save, so it reads the answers just saved.
  const [continueFrom, setContinueFrom] = useState('');
  const sectionContentRef = useRef(null);
  const navRef = useRef(null);
  // Bumped when a continue action opens a section, so the effect below brings
  // that section's top into view after it renders.
  const [revealToken, setRevealToken] = useState(0);

  // Below `xl` the section menu sits above the form, so bring the linked
  // section's fields into view instead of leaving the student on the menu.
  useEffect(() => {
    if (activeSection !== 'overview' && activeSection === initialSection) {
      sectionContentRef.current?.scrollIntoView({ block: 'start' });
    }
    // Runs once on mount: the view remounts on every navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const completeness = getProfileCompleteness(profile, role);
  // My Profile is the student's application form: the six editable sections are
  // its numbered parts, each with a status (src/lib/profile.js).
  const formProgress = isStudent ? getApplicationFormProgress(profile, attributeVerifications) : null;
  const formSections = formProgress ? Object.fromEntries(formProgress.sections.map((section) => [section.key, section])) : {};
  // What the open AdDU internal scholarships ask this student to keep in the
  // Document Vault; staff have no applications, so they get no checklist.
  const documentChecklist = isStudent ? getDocumentChecklist({ scholarships, profile, documents }) : null;
  const sectionProps = { profile, onSave: onSaveProfile, onDirtyChange: setHasUnsavedChanges, attributeVerifications, onAttachProof, previewProofImpact };

  const showSectionContent = () => {
    const target = sectionContentRef.current;
    if (target && target.getBoundingClientRect().top < 0) target.scrollIntoView({ block: 'start' });
  };

  const openSection = (key) => {
    if (key === activeSection) return false;
    if (hasUnsavedChanges && !window.confirm('Discard your unsaved changes in this section?')) return false;
    setHasUnsavedChanges(false);
    setActiveSection(key);
    return true;
  };

  // "Save and continue" lands here on the render after the save, so the next
  // section is chosen from the answers just saved (state adjusted during render,
  // like useSectionForm's re-sync, instead of in an effect).
  if (continueFrom && formProgress) {
    const next = getNextApplicationFormSection(formProgress, continueFrom);
    setContinueFrom('');
    setHasUnsavedChanges(false);
    setActiveSection(next?.key || 'overview');
    setRevealToken((value) => value + 1);
  }

  useEffect(() => {
    if (revealToken) showSectionContent();
  }, [revealToken]);

  // Below `xl` the menu is one swipeable row, so keep the open section's chip in
  // view. Only the row scrolls; the page itself never moves.
  useEffect(() => {
    const nav = navRef.current;
    const chip = nav?.querySelector('[aria-current="page"]');
    if (!nav || !chip || nav.scrollWidth <= nav.clientWidth || typeof nav.scrollTo !== 'function') return;
    nav.scrollTo({ left: chip.offsetLeft - (nav.clientWidth - chip.clientWidth) / 2, behavior: 'smooth' });
  }, [activeSection]);

  const continueContext = formProgress && formSections[activeSection]
    ? { next: getNextApplicationFormSection(formProgress, activeSection), onContinue: () => setContinueFrom(activeSection) }
    : null;

  const renderMenuButton = ({ key, label, icon: Icon }) => {
    const isActive = key === activeSection;
    const formSection = formSections[key];
    return (
      <button
        key={key}
        type="button"
        className={`${menuButtonClass(isActive)} ${isStudent ? 'shrink-0 snap-start whitespace-nowrap xl:shrink xl:whitespace-normal' : ''}`}
        onClick={() => openSection(key)}
        aria-current={isActive ? 'page' : undefined}
      >
        {formSection ? (
          <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${isActive ? 'bg-white/20' : 'bg-app-card text-app-muted'}`} aria-hidden="true">{formSection.number}</span>
        ) : (
          <Icon size={17} className="shrink-0" aria-hidden="true" />
        )}
        <span className="min-w-0 flex-1">{label}</span>
        {formSection && (
          <span className="flex shrink-0 items-center gap-1 text-xs font-semibold">
            <FormSectionStatusIcon state={formSection.state} />
            {formSection.state !== 'complete' && <span aria-hidden="true">{formSection.statusLabel}</span>}
            <span className="sr-only">{`: ${getFormSectionStatusText(formSection.state)}${formSection.state === 'complete' ? '' : `, ${formSection.description}`}`}</span>
          </span>
        )}
      </button>
    );
  };

  const formMenuSections = visibleSections.filter((section) => formSections[section.key]);
  // The title bar's Continue target: the first unfinished part, or the one after
  // it while the student is already working on that part.
  const nextSection = formProgress?.next?.key === activeSection
    ? getNextApplicationFormSection(formProgress, activeSection)
    : formProgress?.next;

  return (
    <div className="grid content-start gap-4">
      <section className="page-title-bar grid gap-5 rounded-app border bg-app-card p-5 shadow-app backdrop-blur">
        <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
          <div className="page-title-copy">
            <span className="page-section-label">{isStudent ? 'Application Form' : 'My Profile'}</span>
            <h2>{isStudent ? 'Your scholarship application form' : 'Profile and account details'}</h2>
            {isStudent && (
              <p className="mb-0 mt-2 max-w-2xl text-sm text-app-muted">
                Every AdDU scholarship application you submit copies these answers. Complete each part once.
              </p>
            )}
            {/* The page's one primary action sits with the explanation it follows from. */}
            {formProgress && (nextSection || (formProgress.ready && onFindScholarship)) ? (
              <div className="mt-4">
                {nextSection ? (
                  <Button
                    variant="primary"
                    className="w-full gap-2 sm:w-auto"
                    onClick={() => { if (openSection(nextSection.key)) setRevealToken((value) => value + 1); }}
                  >
                    Continue: {nextSection.label}
                    <ArrowRight size={16} aria-hidden="true" />
                  </Button>
                ) : (
                  <Button variant="primary" className="w-full gap-2 sm:w-auto" onClick={onFindScholarship}>
                    Find a scholarship
                    <ArrowRight size={16} aria-hidden="true" />
                  </Button>
                )}
              </div>
            ) : null}
          </div>
          {formProgress ? (
            <div className="page-metric w-full rounded-2xl border border-app-border bg-app-surface p-4 text-center sm:w-auto sm:min-w-36">
              <strong>{formProgress.ready ? 'Ready' : `${formProgress.answered} of ${formProgress.total}`}</strong>
              <span>{formProgress.ready ? 'to apply' : 'answered'}</span>
            </div>
          ) : (
            <div className="page-metric rounded-2xl border border-app-border bg-app-surface p-4 text-center sm:min-w-36">
              <strong>{completeness.percent}%</strong>
              <span>Profile complete</span>
            </div>
          )}
        </div>
        {formProgress && (
          // A labelled glance at the six parts; the menu below is the interactive
          // version, so screen readers skip this copy. Below `sm` only the part
          // numbers fit under the bars.
          <ol className="m-0 grid list-none grid-cols-6 gap-1.5 p-0 sm:gap-3" aria-hidden="true">
            {formProgress.sections.map((section) => {
              const isActive = section.key === activeSection;
              return (
                <li key={section.key} className="grid min-w-0 gap-2" title={`${section.number}. ${section.label}: ${section.description}`}>
                  <span className={`h-2 rounded-full ${STRIP_TONES[section.state]} ${isActive ? 'ring-2 ring-blue-400/70 ring-offset-2 ring-offset-app-card' : ''}`} />
                  <span className={`flex min-w-0 items-center justify-center gap-1 text-xs sm:justify-start ${isActive ? 'font-bold text-app-text' : 'font-semibold text-app-muted'}`}>
                    <FormSectionStatusIcon state={section.state} size={14} className="hidden sm:block" />
                    <span className="shrink-0">{section.number}</span>
                    <span className="hidden min-w-0 truncate sm:inline">{section.label}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section className="grid items-start gap-4 xl:grid-cols-[17rem_minmax(0,1fr)]">
        {isStudent ? (
          <nav
            ref={navRef}
            className="relative flex snap-x gap-2 overflow-x-auto rounded-app border border-app-border bg-app-card p-3 shadow-app backdrop-blur xl:sticky xl:top-5 xl:grid xl:grid-cols-1 xl:overflow-visible"
            aria-label="Profile sections"
          >
            {renderMenuButton(visibleSections[0])}
            <p className="m-0 hidden px-1 pt-2 text-xs font-bold uppercase tracking-[0.08em] text-app-muted xl:block">Application form</p>
            {formMenuSections.map(renderMenuButton)}
            <span className="w-px shrink-0 self-stretch bg-app-border xl:my-1 xl:h-px xl:w-auto" aria-hidden="true" />
            {renderMenuButton(visibleSections[visibleSections.length - 1])}
          </nav>
        ) : (
          <nav className="grid grid-cols-2 gap-2 rounded-app border border-app-border bg-app-card p-3 shadow-app backdrop-blur sm:grid-cols-3 xl:sticky xl:top-5 xl:grid-cols-1" aria-label="Profile sections">
            {visibleSections.map(renderMenuButton)}
          </nav>
        )}

        <div ref={sectionContentRef} className="min-w-0 scroll-mt-4">
          <SectionContinueContext.Provider value={continueContext}>
            {activeSection === 'overview' && (
              <ProfileOverview
                profile={profile}
                completeness={completeness}
                formProgress={formProgress}
                documentChecklist={documentChecklist}
                onEditSection={openSection}
                attributeVerifications={attributeVerifications}
                onAttachProof={onAttachProof}
                onUploadDocument={onUploadDocument}
              />
            )}
            {activeSection === 'personal' && <PersonalSection {...sectionProps} role={role} roleLabel={roleLabel} avatar={avatar} onChangeAvatar={onChangeAvatar} onRemoveAvatar={onRemoveAvatar} />}
            {activeSection === 'address' && isStudent && <AddressSection {...sectionProps} />}
            {activeSection === 'family' && isStudent && <FamilySection {...sectionProps} />}
            {activeSection === 'academic' && isStudent && (
              <AcademicSection {...sectionProps} documents={documents} academicPrograms={academicPrograms} academicProgramGroups={academicProgramGroups} />
            )}
            {activeSection === 'finances' && isStudent && <FinancesSection {...sectionProps} onSave={onSaveFinancialProfile} migrationMissing={financialMissing} />}
            {activeSection === 'background' && isStudent && <BackgroundSection {...sectionProps} />}
            {activeSection === 'security' && (
              <SecuritySection
                email={profile.email}
                onChangePassword={onChangePassword}
                onRequestPasswordReset={onRequestPasswordReset}
                onDirtyChange={setHasUnsavedChanges}
              />
            )}
          </SectionContinueContext.Provider>
        </div>
      </section>
    </div>
  );
}
