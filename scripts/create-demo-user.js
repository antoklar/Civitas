#!/usr/bin/env node
// One-off provisioning script for the shared demo account used by invited
// testers. Creates the Supabase Auth user (if it doesn't already exist) and
// seeds public.profiles with a primary address so the dashboard shows real
// representatives on first login, with no setup required from the tester.
//
// Safe to re-run: it looks up the user by email instead of failing on a
// duplicate, and upserts the primary address instead of inserting a second
// row.
//
// Requires SUPABASE_SERVICE_ROLE_KEY (Project Settings > API in the
// Supabase dashboard) in the environment — never commit this key.
//
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/create-demo-user.js

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mhcupdxtgvhmxnddshhd.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const DEMO_EMAIL = 'demo@civitasus.com';
const DEMO_PASSWORD = 'CivitasDemo2026!';
const DEMO_FIRST_NAME = 'Demo';
const DEMO_ADDRESS = '1600 Pennsylvania Ave NW, Washington, DC 20500';

if (!SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is required (not the anon key).');
  process.exit(1);
}

const adminHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

async function findUserByEmail(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, { headers: adminHeaders });
  if (!res.ok) throw new Error(`List users failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return (data.users || []).find(u => u.email?.toLowerCase() === email.toLowerCase()) || null;
}

async function createOrGetDemoUser() {
  const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { first_name: DEMO_FIRST_NAME },
    }),
  });

  if (createRes.ok) {
    const user = await createRes.json();
    console.log(`Created demo user ${user.id}`);
    return user;
  }

  const body = await createRes.text();
  if (createRes.status === 422 || /already.*registered/i.test(body)) {
    const existing = await findUserByEmail(DEMO_EMAIL);
    if (!existing) throw new Error(`User creation said "already registered" but couldn't find ${DEMO_EMAIL}`);
    console.log(`Demo user already exists: ${existing.id}`);
    return existing;
  }

  throw new Error(`Create user failed: ${createRes.status} ${body}`);
}

async function upsertPrimaryAddress(userId) {
  const listRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${userId}&is_primary=eq.true&select=id`,
    { headers: adminHeaders }
  );
  if (!listRes.ok) throw new Error(`Lookup profiles failed: ${listRes.status} ${await listRes.text()}`);
  const existingPrimary = await listRes.json();

  if (existingPrimary.length > 0) {
    const id = existingPrimary[0].id;
    const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${id}`, {
      method: 'PATCH',
      headers: { ...adminHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({ label: 'Home', address: DEMO_ADDRESS }),
    });
    if (!patchRes.ok) throw new Error(`Update profile failed: ${patchRes.status} ${await patchRes.text()}`);
    console.log('Updated existing primary address row.');
    return;
  }

  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
    method: 'POST',
    headers: { ...adminHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify({ user_id: userId, label: 'Home', address: DEMO_ADDRESS, is_primary: true }),
  });
  if (!insertRes.ok) throw new Error(`Insert profile failed: ${insertRes.status} ${await insertRes.text()}`);
  console.log('Inserted primary address row.');
}

async function main() {
  const user = await createOrGetDemoUser();
  await upsertPrimaryAddress(user.id);
  console.log(`\nDemo account ready: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
