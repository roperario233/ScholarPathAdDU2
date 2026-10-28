import { BookOpenCheck, BriefcaseBusiness, HandCoins } from 'lucide-react';

const TRACK_ICONS = {
  'general-pool': HandCoins,
  'work-study': BriefcaseBusiness,
  honors: BookOpenCheck,
};

// The icon tile for one of the three AdDU grants, shared by the Dashboard and
// Scholarship Explorer so a track reads the same on both pages.
export default function ScholarshipTrackIcon({ ruleFamily }) {
  const Icon = TRACK_ICONS[ruleFamily] || HandCoins;
  return (
    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-blue-500/15 text-blue-600 dark:text-blue-200">
      <Icon size={21} aria-hidden="true" />
    </span>
  );
}
