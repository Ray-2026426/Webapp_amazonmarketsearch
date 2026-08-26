import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_KEY;
const email = process.env.SUPABASE_TEST_EMAIL;
const password = process.env.SUPABASE_TEST_PASSWORD;

if (!url || !key || !email || !password) {
  console.error('Missing SUPABASE_URL, SUPABASE_KEY, SUPABASE_TEST_EMAIL, or SUPABASE_TEST_PASSWORD');
  process.exit(1);
}

const s = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const out = {};

const signin = await s.auth.signInWithPassword({ email, password });
out.signIn = {
  ok: !signin.error,
  error: signin.error?.message ?? null,
  userId: Boolean(signin.data.user?.id),
  session: Boolean(signin.data.session),
};
if (signin.error) {
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

const user = (await s.auth.getUser()).data.user;
if (!user) {
  out.user = { ok: false, error: 'no user after auth' };
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}
out.user = { ok: true, email: user.email };

const id = `smoke_${Date.now().toString(36)}`;
const now = new Date().toISOString();
const project = {
  id,
  workspaceId: 'default',
  name: 'Supabase team RLS smoke',
  marketplace: 'US',
  objective: 'smoke',
  ownerId: 'local-user',
  memberIds: [],
  status: 'draft',
  activeLook: 'market',
  fiveLookProgress: Object.fromEntries(
    ['market', 'user', 'competitor', 'self', 'opportunity'].map((look) => [
      look,
      {
        look,
        status: 'not_started',
        completionPercent: 0,
        completedEvidenceIds: [],
        missingRequirements: [],
        staleReasons: [],
        updatedAt: now,
      },
    ])
  ),
  createdAt: now,
  updatedAt: now,
  version: 1,
};

const upsert = await s
  .from('projects')
  .upsert({ id, user_id: user.id, owner_id: user.id, data: project, updated_at: now }, { onConflict: 'id' });
out.projectUpsert = { ok: !upsert.error, error: upsert.error?.message ?? null };

const beforeMemberRead = await s.from('projects').select('id').eq('id', id);
out.readBeforeMember = {
  ok: !beforeMemberRead.error,
  error: beforeMemberRead.error?.message ?? null,
  count: beforeMemberRead.data?.length ?? null,
};

const member = await s
  .from('project_members')
  .upsert({ project_id: id, user_id: user.id, role: 'owner' }, { onConflict: 'project_id,user_id' });
out.memberUpsert = { ok: !member.error, error: member.error?.message ?? null };

const read = await s.from('projects').select('id,owner_id,data').eq('id', id).single();
out.projectReadBack = {
  ok: !read.error,
  error: read.error?.message ?? null,
  name: read.data?.data?.name ?? null,
  ownerMatches: read.data?.owner_id === user.id,
};

const updatedProject = { ...project, name: 'Supabase team RLS smoke updated', version: 2 };
const update = await s
  .from('projects')
  .update({ data: updatedProject, updated_at: new Date().toISOString() })
  .eq('id', id);
out.ownerUpdate = { ok: !update.error, error: update.error?.message ?? null };

const cleanup = await s.from('projects').delete().eq('id', id);
out.ownerDeleteCleanup = { ok: !cleanup.error, error: cleanup.error?.message ?? null };

const anon = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const anonRead = await anon.from('projects').select('id').eq('id', id);
out.anonReadAfterCleanup = {
  ok: !anonRead.error,
  error: anonRead.error?.message ?? null,
  count: anonRead.data?.length ?? null,
};

console.log(JSON.stringify(out, null, 2));
