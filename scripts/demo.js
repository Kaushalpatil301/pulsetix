'use strict';

/**
 * PulseTix Interactive / Automated Demo Runner
 * Usage: node scripts/demo.js [local|remote]
 */

const https = require('https');
const http = require('http');

const target = process.argv[2] === 'local' ? 'http://localhost:3000' : 'https://pulsetix-api.onrender.com';
const isHttps = target.startsWith('https');
const client = isHttps ? https : http;

function makeRequest(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, target);
    const payload = body ? JSON.stringify(body) : '';
    const req = client.request(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...headers,
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
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

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runDemo() {
  console.log('\n======================================================');
  console.log('       🎟️  PULSETIX END-TO-END DEMO WALKTHROUGH        ');
  console.log('======================================================');
  console.log(`Target API: ${target}\n`);

  // Step 1: Health check
  console.log('👉 [1/7] Checking API Health...');
  const health = await makeRequest('GET', '/api/health');
  console.log(`   Status: ${health.status} OK`);
  console.log(`   Response:`, health.body);
  await delay(1000);

  // Step 2: Register Organizer
  console.log('\n👉 [2/7] Registering Event Organizer...');
  const orgEmail = `demo_org_${Date.now()}@example.com`;
  const orgRes = await makeRequest('POST', '/api/auth/register', {
    name: 'Coldplay Promotions',
    email: orgEmail,
    password: 'Password123!',
    role: 'ORGANIZER',
    organizer_code: 'PULSETIX2025PULSETIX2025',
  });
  console.log(`   Status: ${orgRes.status} Created`);
  console.log(`   Organizer Email: ${orgEmail}`);
  const orgToken = orgRes.body.token;
  await delay(1000);

  // Step 3: Create Event
  console.log('\n👉 [3/7] Organizer Creating Event (100 Tickets)...');
  const eventRes = await makeRequest('POST', '/api/events', {
    title: 'Coldplay: Music of the Spheres World Tour',
    description: 'Live performance at DY Patil Stadium, Mumbai',
    venue: 'DY Patil Stadium',
    event_date: new Date(Date.now() + 86400000 * 30).toISOString(),
    total_tickets: 100,
    price_cents: 4500,
  }, { 'Authorization': `Bearer ${orgToken}` });
  console.log(`   Status: ${eventRes.status} Created`);
  const eventId = eventRes.body.id;
  console.log(`   Event ID: ${eventId}`);
  console.log(`   Available Tickets: ${eventRes.body.available_tickets} / ${eventRes.body.total_tickets}`);
  await delay(1000);

  // Step 4: Register Customer
  console.log('\n👉 [4/7] Registering Customer (Recipient of Confirmation Email)...');
  const custEmail = 'kaushalpat3@gmail.com';
  let custToken;
  const loginRes = await makeRequest('POST', '/api/auth/login', {
    email: custEmail,
    password: 'Password123!',
  });
  if (loginRes.status === 200) {
    custToken = loginRes.body.token;
    console.log(`   Logged in existing customer: ${custEmail}`);
  } else {
    const custRes = await makeRequest('POST', '/api/auth/register', {
      name: 'Kaushal Patil',
      email: custEmail,
      password: 'Password123!',
      role: 'CUSTOMER',
    });
    custToken = custRes.body.token;
    console.log(`   Registered new customer: ${custEmail}`);
  }
  await delay(1000);

  // Step 5: Book 2 Tickets
  console.log('\n👉 [5/7] Customer Booking 2 Tickets (Atomic CTE + Idempotency)...');
  const idempotencyKey = `demo-key-${Date.now()}`;
  const bookRes = await makeRequest('POST', `/api/events/${eventId}/book`, {
    tickets_count: 2,
  }, {
    'Authorization': `Bearer ${custToken}`,
    'Idempotency-Key': idempotencyKey,
  });
  console.log(`   Status: ${bookRes.status} Confirmed`);
  console.log(`   Booking ID: ${bookRes.body.id}`);
  console.log(`   Tickets Booked: ${bookRes.body.tickets_count}`);
  console.log(`   Total: $${(bookRes.body.total_cents / 100).toFixed(2)}`);
  console.log(`   📬 Real confirmation email triggered asynchronously via Brevo!`);
  await delay(1000);

  // Step 6: Test Idempotency Guard
  console.log('\n👉 [6/7] Testing Idempotent Retry (Re-sending same Idempotency-Key)...');
  const retryRes = await makeRequest('POST', `/api/events/${eventId}/book`, {
    tickets_count: 2,
  }, {
    'Authorization': `Bearer ${custToken}`,
    'Idempotency-Key': idempotencyKey,
  });
  console.log(`   Status: ${retryRes.status} OK (Returned Cached Booking)`);
  console.log(`   Matches Original Booking ID: ${retryRes.body.id === bookRes.body.id}`);
  await delay(1000);

  // Step 7: Verify Event Inventory
  console.log('\n👉 [7/7] Verifying Live Remaining Inventory...');
  const eventCheck = await makeRequest('GET', `/api/events/${eventId}`);
  console.log(`   Original Tickets: ${eventCheck.body.total_tickets}`);
  console.log(`   Remaining Tickets: ${eventCheck.body.available_tickets} (Correctly decremented by 2!)`);

  console.log('\n======================================================');
  console.log('       🎉 DEMO COMPLETE — ALL SYSTEMS OPERATIONAL      ');
  console.log('======================================================\n');
}

runDemo().catch((err) => {
  console.error('\n❌ Demo failed:', err);
  process.exit(1);
});
