'use strict';

/**
 * Templates for event update notification emails.
 * Shows a before → after diff of changed fields.
 */

const FIELD_LABELS = {
  title: 'Title',
  description: 'Description',
  venue: 'Venue',
  event_date: 'Date & Time',
  price_cents: 'Ticket Price',
};

function formatField(key, value) {
  if (key === 'price_cents') return `$${(value / 100).toFixed(2)}`;
  if (key === 'event_date') return new Date(value).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
  return String(value ?? '(none)');
}

function eventUpdateText({ event, changedFields, before, customer }) {
  const lines = [
    `Hi ${customer.name},`,
    ``,
    `An event you've booked has been updated.`,
    ``,
    `Event: ${event.title}`,
    ``,
    `── Changes ──────────────────────────────`,
  ];

  for (const field of changedFields) {
    const label = FIELD_LABELS[field] || field;
    lines.push(`${label}:`);
    if (before && before[field] !== undefined) {
      lines.push(`  Before: ${formatField(field, before[field])}`);
    }
    lines.push(`  After : ${formatField(field, event[field])}`);
  }

  lines.push('');
  lines.push('── Current Event Details ────────────────');
  lines.push(`Title  : ${event.title}`);
  lines.push(`Venue  : ${event.venue}`);
  lines.push(`Date   : ${formatField('event_date', event.event_date)}`);
  lines.push(`Price  : ${formatField('price_cents', event.price_cents)}`);
  lines.push('');
  lines.push('— The PulseTix Team');

  return lines.join('\n');
}

function eventUpdateHtml({ event, changedFields, before, customer }) {
  const changesHtml = changedFields.map((field) => {
    const label = FIELD_LABELS[field] || field;
    const afterVal = formatField(field, event[field]);
    const beforeVal = before && before[field] !== undefined ? formatField(field, before[field]) : null;
    return `
      <tr style="background:#fef3c7;">
        <td style="padding:8px 12px;font-weight:bold;">${label}</td>
        <td style="padding:8px 12px;">
          ${beforeVal ? `<s style="color:#dc2626;">${beforeVal}</s><br>` : ''}
          <span style="color:#059669;font-weight:bold;">${afterVal}</span>
        </td>
      </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Event Updated</title></head>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1a1a;">
  <h1 style="color:#d97706;">📢 Event Update</h1>
  <p>Hi <strong>${customer.name}</strong>, an event you've booked has been updated.</p>
  <h2 style="font-size:1.1rem;">${event.title}</h2>
  <h3 style="color:#6b7280;font-weight:normal;font-size:0.9rem;">Changes</h3>
  <table style="width:100%;border-collapse:collapse;">
    ${changesHtml}
  </table>
  <h3 style="color:#6b7280;font-weight:normal;font-size:0.9rem;margin-top:16px;">Current Details</h3>
  <table style="width:100%;border-collapse:collapse;">
    <tr><td style="padding:6px 12px;font-weight:bold;">Venue</td><td style="padding:6px 12px;">${event.venue}</td></tr>
    <tr style="background:#f5f5f5;"><td style="padding:6px 12px;font-weight:bold;">Date</td><td style="padding:6px 12px;">${formatField('event_date', event.event_date)}</td></tr>
    <tr><td style="padding:6px 12px;font-weight:bold;">Price</td><td style="padding:6px 12px;">${formatField('price_cents', event.price_cents)}</td></tr>
  </table>
  <p style="margin-top:24px;color:#6b7280;">— The PulseTix Team</p>
</body>
</html>`;
}

module.exports = { eventUpdateText, eventUpdateHtml };
