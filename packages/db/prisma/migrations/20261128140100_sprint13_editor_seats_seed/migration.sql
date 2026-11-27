-- Sprint 13, Module 14: editor seats per plan (`members.editors_max`).
--
-- Additive and idempotent: one PlanEntitlement row per tier and one "Seed"
-- line in the change log for each, as the Sprint 12 seed did. Values are
-- placeholders the operator edits on /operator. ON CONFLICT DO NOTHING keeps
-- an operator's earlier edit if the key was ever created by hand.

-- Seed
INSERT INTO "PlanEntitlement" ("id", "tier", "key", "value", "updatedBy", "updatedAt", "createdAt") VALUES
  ('seed_free_members_editors_max', 'FREE', 'members.editors_max', '0'::jsonb, NULL, now(), now()),
  ('seed_standard_members_editors_max', 'STANDARD', 'members.editors_max', '1'::jsonb, NULL, now(), now()),
  ('seed_pro_members_editors_max', 'PRO', 'members.editors_max', '3'::jsonb, NULL, now(), now()),
  ('seed_team_members_editors_max', 'TEAM', 'members.editors_max', '10'::jsonb, NULL, now(), now()),
  ('seed_ultimate_members_editors_max', 'ULTIMATE', 'members.editors_max', '25'::jsonb, NULL, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO "EntitlementChange" ("id", "scope", "tier", "organizationId", "key", "action", "oldValue", "newValue", "reason", "actorId", "actorEmail", "createdAt") VALUES
  ('seedlog_free_members_editors_max', 'PLAN', 'FREE', NULL, 'members.editors_max', 'SET', NULL, '0'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_standard_members_editors_max', 'PLAN', 'STANDARD', NULL, 'members.editors_max', 'SET', NULL, '1'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_pro_members_editors_max', 'PLAN', 'PRO', NULL, 'members.editors_max', 'SET', NULL, '3'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_team_members_editors_max', 'PLAN', 'TEAM', NULL, 'members.editors_max', 'SET', NULL, '10'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_ultimate_members_editors_max', 'PLAN', 'ULTIMATE', NULL, 'members.editors_max', 'SET', NULL, '25'::jsonb, 'Seed', NULL, NULL, now())
ON CONFLICT DO NOTHING;
