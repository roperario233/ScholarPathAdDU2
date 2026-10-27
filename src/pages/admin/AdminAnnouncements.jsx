import AdminPageHeader from '../../components/AdminPageHeader';
import { AnnouncementItem } from '../../components/pageParts';
import { Button, Card, EmptyState, FormField, StatusBadge } from '../../components/ui';

// Office communications are their own route: the composer and the published
// history stay separate from the review queue and the catalog form.
export default function AdminAnnouncements({ announcements = [], onCreateAnnouncement }) {
  return (
    <div className="grid gap-5">
      <AdminPageHeader
        title="Office announcements"
        description="Publish application windows, answers to inquiries, and program updates."
        badge={`${announcements.length} published`}
      />

      <section className="grid gap-4 xl:grid-cols-2">
        <Card title="Publish an update" action={<StatusBadge tone="info">SOP step 1</StatusBadge>}>
          <form className="grid gap-4" onSubmit={onCreateAnnouncement}>
            <FormField label="Audience">
              <select name="announcementAudience">
                <option>Students</option>
                <option>Admissions Office</option>
                <option>Department Chairs</option>
                <option>All users</option>
              </select>
            </FormField>
            <FormField label="Title">
              <input name="announcementTitle" placeholder="Application window update" />
            </FormField>
            <FormField label="Body">
              <textarea name="announcementBody" rows="4" placeholder="Announce an application window or share program information." />
            </FormField>
            <Button variant="primary" type="submit">Publish announcement</Button>
          </form>
        </Card>

        <Card title="Recent announcements" action={<StatusBadge>{announcements.length} published</StatusBadge>}>
          <div className="grid max-h-[420px] gap-3 overflow-y-auto pr-2">
            {announcements.length ? announcements.map((entry) => (
              <AnnouncementItem key={entry.id} entry={entry} />
            )) : <EmptyState title="No announcements yet" />}
          </div>
        </Card>
      </section>
    </div>
  );
}
