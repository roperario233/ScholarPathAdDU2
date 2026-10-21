-- Supporting index for the document decision actor recorded by
-- 20261027000000_add_document_decision_actor.sql. This migration was applied
-- directly to the ScholarPath AdDU project under the version 20261021045410 and
-- is captured here so the repository reproduces the deployed schema.
create index if not exists documents_reviewed_by_idx
on public.documents using btree (reviewed_by);
