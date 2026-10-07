import { useState } from 'react';
import { Award, GraduationCap, LayoutDashboard, MapPin, ShieldCheck, UserRound, Users, Wallet } from 'lucide-react';
import { AcademicSection, AddressSection, BackgroundSection, FamilySection, FinancialSection, PersonalSection, ProfileOverview, SecuritySection } from '../components/ProfileSections';
import { getProfileCompleteness } from '../lib/profile';

const sections = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard, studentOnly: false },
  { key: 'personal', label: 'Personal information', icon: UserRound, studentOnly: false },
  { key: 'address', label: 'Address', icon: MapPin, studentOnly: true },
  { key: 'family', label: 'Family details', icon: Users, studentOnly: true },
  { key: 'academic', label: 'Academic profile', icon: GraduationCap, studentOnly: true },
  { key: 'financial', label: 'Household and financial aid', icon: Wallet, studentOnly: true },
  { key: 'background', label: 'Eligibility background', icon: Award, studentOnly: true },
  { key: 'security', label: 'Account security', icon: ShieldCheck, studentOnly: false },
];

export default function ProfileView({
  profile,
  role,
  roleLabel,
  academicPrograms = [],
  academicProgramCategories = [],
  isAccountManaged = false,
  attributeVerifications = {},
  onSaveProfile,
  onChangePassword,
  onRequestPasswordReset,
  onOpenEligibility,
  onAttachProof,
}) {
  const [activeSection, setActiveSection] = useState('overview');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const isStudent = role === 'student';
  const visibleSections = sections.filter((section) => isStudent || !section.studentOnly);
  const completeness = getProfileCompleteness(profile, role);
  const sectionProps = { profile, onSave: onSaveProfile, onDirtyChange: setHasUnsavedChanges, attributeVerifications, onAttachProof };

  const openSection = (key) => {
    if (key === activeSection) return;
    if (hasUnsavedChanges && !window.confirm('Discard your unsaved changes in this section?')) return;
    setHasUnsavedChanges(false);
    setActiveSection(key);
  };

  return (
    <div className="grid content-start gap-4">
      <section className="page-title-bar flex flex-col items-start justify-between gap-4 rounded-app border bg-app-card p-5 shadow-app backdrop-blur md:flex-row md:items-center">
        <div className="page-title-copy">
          <span className="page-section-label">My Profile</span>
          <h2>Profile and account details</h2>
        </div>
        <div className="page-metric rounded-2xl border border-app-border bg-app-surface p-4 text-center sm:min-w-36">
          <strong>{completeness.percent}%</strong>
          <span>Profile complete</span>
        </div>
      </section>

      <section className="grid items-start gap-4 xl:grid-cols-[15rem_minmax(0,1fr)]">
        <nav className="grid grid-cols-2 gap-2 rounded-app border border-app-border bg-app-card p-3 shadow-app backdrop-blur sm:grid-cols-3 xl:sticky xl:top-5 xl:grid-cols-1" aria-label="Profile sections">
          {visibleSections.map(({ key, label, icon: Icon }) => {
            const isActive = key === activeSection;
            return (
              <button
                key={key}
                type="button"
                className={`flex min-h-11 min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold transition hover:-translate-y-px focus:outline-none focus:ring-4 focus:ring-blue-500/20 ${isActive ? 'bg-gradient-to-br from-ateneo-strong via-ateneo to-ateneo-bright text-white shadow-sm' : 'border border-app-border bg-app-surface text-app-text'}`}
                onClick={() => openSection(key)}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon size={17} className="shrink-0" aria-hidden="true" />
                <span className="min-w-0">{label}</span>
              </button>
            );
          })}
        </nav>

        <div className="min-w-0">
          {activeSection === 'overview' && (
            <ProfileOverview
              profile={profile}
              role={role}
              roleLabel={roleLabel}
              completeness={completeness}
              onEditSection={openSection}
              onOpenEligibility={onOpenEligibility}
              attributeVerifications={attributeVerifications}
              onAttachProof={onAttachProof}
            />
          )}
          {activeSection === 'personal' && <PersonalSection {...sectionProps} role={role} roleLabel={roleLabel} />}
          {activeSection === 'address' && isStudent && <AddressSection {...sectionProps} />}
          {activeSection === 'family' && isStudent && <FamilySection {...sectionProps} />}
          {activeSection === 'academic' && isStudent && (
            <AcademicSection {...sectionProps} academicPrograms={academicPrograms} academicProgramCategories={academicProgramCategories} />
          )}
          {activeSection === 'financial' && isStudent && <FinancialSection {...sectionProps} />}
          {activeSection === 'background' && isStudent && <BackgroundSection {...sectionProps} />}
          {activeSection === 'security' && (
            <SecuritySection
              email={profile.email}
              isAccountManaged={isAccountManaged}
              onChangePassword={onChangePassword}
              onRequestPasswordReset={onRequestPasswordReset}
              onDirtyChange={setHasUnsavedChanges}
            />
          )}
        </div>
      </section>
    </div>
  );
}
