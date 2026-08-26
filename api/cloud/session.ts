import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

function env(name: string): string {
  return (process.env[name] || '').trim();
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const url = env('SUPABASE_URL') || env('VITE_SUPABASE_URL');
  const key = env('SUPABASE_PUBLISHABLE_KEY') || env('SUPABASE_ANON_KEY') || env('VITE_SUPABASE_ANON_KEY');
  const email = env('SUPABASE_CLOUD_EMAIL');
  const password = env('SUPABASE_CLOUD_PASSWORD');

  if (!url || !key || !email || !password) {
    res.status(503).json({ ok: false, error: 'Cloud storage is not configured' });
    return;
  }

  if (key.startsWith('sb_secret_') || key.toLowerCase().includes('service_role')) {
    res.status(500).json({ ok: false, error: 'Use a publishable/anon key for browser sessions' });
    return;
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    res.status(401).json({ ok: false, error: error?.message || 'Cloud sign-in failed' });
    return;
  }

  res.status(200).json({
    ok: true,
    supabaseUrl: url,
    publishableKey: key,
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
      token_type: data.session.token_type,
    },
    user: { id: data.user?.id, email: data.user?.email },
  });
}
