'use strict';

const https = require('https');

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const req = https.request({
      hostname: 'pulsetix-api.onrender.com',
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...headers
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  console.log('[benchmark] Setting up benchmark event on Render...');

  // 1. Organizer
  const orgEmail = `benchmark_org_${Date.now()}@example.com`;
  const orgRes = await request('POST', '/api/auth/register', {
    email: orgEmail,
    password: 'Password123!',
    name: 'Benchmark Organizer',
    role: 'ORGANIZER',
    organizer_code: 'PULSETIX2025PULSETIX2025'
  });
  if (orgRes.status !== 201) throw new Error('Org reg failed: ' + JSON.stringify(orgRes));
  const orgToken = orgRes.body.token;

  // 2. Create Event (100 tickets)
  const eventRes = await request('POST', '/api/events', {
    title: 'Flash Sale Benchmark 2026',
    description: '100 tickets flash sale test',
    venue: 'Render Cloud Oregon',
    event_date: new Date(Date.now() + 86400000 * 30).toISOString(),
    total_tickets: 100,
    price_cents: 2000
  }, { 'Authorization': `Bearer ${orgToken}` });
  if (eventRes.status !== 201) throw new Error('Event create failed: ' + JSON.stringify(eventRes));
  const eventId = eventRes.body.id;

  // 3. Customer
  const custEmail = `benchmark_cust_${Date.now()}@example.com`;
  const custRes = await request('POST', '/api/auth/register', {
    email: custEmail,
    password: 'Password123!',
    name: 'Benchmark Customer',
    role: 'CUSTOMER'
  });
  if (custRes.status !== 201) throw new Error('Cust reg failed: ' + JSON.stringify(custRes));
  const custToken = custRes.body.token;

  console.log(`EVENT_ID=${eventId}`);
  console.log(`CUSTOMER_TOKEN=${custToken}`);
  console.log('[benchmark] Ready for k6!');
}

main().catch((err) => {
  console.error('[benchmark] Error:', err.message);
  process.exit(1);
});
