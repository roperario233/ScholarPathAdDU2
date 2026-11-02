import StatisticsWorkspace from '../../components/StatisticsWorkspace';
import { isAdmissionsAdminRole } from '../../lib/constants';

// The Admissions Office statistics route (`admin-statistics`), for both office
// lanes. The Admin sees every section; Staff are read-only and, since Consultation
// 2, "not privy to the application process", so their page carries application
// volume and timing only (getStatisticsScope() in src/lib/admissionsStatistics.js).
export default function AdminStatistics({
  applications = [],
  documents = [],
  interviewNotes = [],
  academicPrograms = [],
  profile = {},
  role = 'admissions_admin',
}) {
  const isAdmin = isAdmissionsAdminRole(role);
  return (
    <StatisticsWorkspace
      applications={applications}
      documents={documents}
      interviewNotes={interviewNotes}
      academicPrograms={academicPrograms}
      profile={profile}
      role={role}
      title="Office statistics"
      description={isAdmin
        ? 'How the scholarship cycle is going: applications, outcomes, stage turnaround, document verification, and panel recommendations.'
        : 'Application volume and timing across the office: where cases are, how long each stage takes, and document verification.'}
      origin="Admissions Office › Statistics"
    />
  );
}
