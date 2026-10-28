import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import DashboardView from '../src/pages/DashboardView';
import { getScholarshipGuideCards } from '../src/lib/scholarshipGuide';

const student = { role: 'student', fullName: 'Ana Cruz', yearStanding: '2nd', isTransferee: 'No' };
const incoming = { role: 'student', fullName: 'Ana Cruz', yearStanding: 'incoming-1st' };

const catalog = [
  {
    id: 'gia',
    title: 'Grant-in-Aid (GIA)',
    ruleFamily: 'general-pool',
    minimumQpi: 2.5,
    maximumIncome: 250000,
    deadline: '2099-04-30',
    requiredDocuments: [
      { id: 'grades', label: 'Latest grade report', documentTypes: ['Grade Report'], standing: 'continuing' },
      { id: 'exam', label: 'Entrance exam result', documentTypes: ['Entrance Exam Result'], standing: 'incoming' },
      { id: 'moral', label: 'Certificate of Good Moral Character', documentTypes: ['Good Moral Character'], standing: 'all' },
    ],
  },
];

describe('student Dashboard', () => {
  it('shows the three grants in leaflet order with one Explore action', () => {
    const html = renderToStaticMarkup(<DashboardView profile={student} scholarships={catalog} onOpenExplorer={() => {}} />);
    const order = ['Grant-in-Aid (GIA)', 'Working Scholar Program', 'Jubilee Scholarship (JSF)'].map((name) => html.indexOf(name));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html.match(/Explore scholarships and check your eligibility/g)).toHaveLength(1);
    expect(html).toContain('Annual QPI of at least 2.50');
    expect(html).toContain('Annual household income of up to');
  });

  it('lists the catalog documents for the student standing', () => {
    const [gia] = getScholarshipGuideCards(catalog, student);
    expect(gia.requirements.map((item) => item.id)).toEqual(['grades', 'moral']);
    const [giaIncoming] = getScholarshipGuideCards(catalog, incoming);
    expect(giaIncoming.requirements.map((item) => item.id)).toEqual(['exam', 'moral']);
  });

  it('falls back to the rule-family documents when a track is not in the catalog', () => {
    const cards = getScholarshipGuideCards([], student);
    expect(cards.every((card) => card.scholarship === null && card.requirements.length > 0)).toBe(true);
  });

  it('renders nothing for staff roles', () => {
    expect(renderToStaticMarkup(<DashboardView profile={{ role: 'admissions_office' }} scholarships={[]} onOpenExplorer={() => {}} />)).toBe('');
  });
});
