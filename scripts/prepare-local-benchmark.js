'use strict';

const http = require('http');

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
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
  console.log('[local-bench] Creating local benchmark event...');

  // 1. Org
  const orgRes = await request('POST', '/api/auth/register', {
    email: `local_org_${Date.now()}@example.com`,
    password: 'Password123!',
    name: 'Local Organizer',
    role: 'ORGANIZER',
    organizer_code: 'PULSETIX2025'
  });
  const orgToken = orgRes.body.token;

  // 2. Event (100 tickets)
  const eventRes = await request('POST', '/api/events', {
    title: 'Local Flash Sale Benchmark 2026',
    venue: 'Localhost',
    event_date: new Date(Date.now() + 86400000 * 30).toISOString(),
    total_tickets: 100,
    price_cents: 1000
  }, { 'Authorization': `Bearer ${orgToken}` });
  const eventId = eventRes.body.id;

  // 3. Cust
  const custRes = await request('POST', '/api/auth/register', {
    email: `local_cust_${Date.now()}@example.com`,
    password: 'Password123!',
    name: 'Local Customer',
    role: 'CUSTOMER'
  });
  const custToken = custRes.body.token;

  console.log(`LOCAL_EVENT_ID=${eventId}`);
  console.log(`LOCAL_CUSTOMER_TOKEN=${custToken}`);
}

main().catch(console.error);
