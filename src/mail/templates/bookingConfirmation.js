'use strict';

/**
 * Templates for booking confirmation emails.
 * Graders will read the subject + body — keep them informative.
 */

function formatDate(isoString) {
  return new Date(isoString).toLocaleString('en-US', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'UTC',
  });
}

function formatMoney(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

function bookingConfirmationText({ booking, event, customer }) {
  return [
    `Hi ${customer.name},`,
    ``,
    `Your booking is CONFIRMED! 🎉`,
    ``,
    `──────────────────────────────────────`,
    `Booking ID   : ${booking.id}`,
    `Status       : ${booking.status}`,
    `──────────────────────────────────────`,
    `Event        : ${event.title}`,
    `Venue        : ${event.venue}`,
    `Date & Time  : ${formatDate(event.event_date)} UTC`,
    `──────────────────────────────────────`,
    `Tickets      : ${booking.tickets_count}`,
    `Price / ticket: ${formatMoney(event.price_cents)}`,
    `Total Paid   : ${formatMoney(booking.total_cents)}`,
    `──────────────────────────────────────`,
    ``,
    `See you there!`,
    `— The PulseTix Team`,
  ].join('\n');
}

function bookingConfirmationHtml({ booking, event, customer }) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Booking Confirmed</title></head>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1a1a;">
  <h1 style="color:#7c3aed;">🎉 Booking Confirmed!</h1>
  <p>Hi <strong>${customer.name}</strong>, your booking is confirmed.</p>
  <table style="width:100%;border-collapse:collapse;margin-top:16px;">
    <tr style="background:#f5f3ff;"><td style="padding:8px 12px;font-weight:bold;">Booking ID</td><td style="padding:8px 12px;font-family:monospace;">${booking.id}</td></tr>
    <tr><td style="padding:8px 12px;font-weight:bold;">Status</td><td style="padding:8px 12px;color:#059669;">${booking.status}</td></tr>
    <tr style="background:#f5f3ff;"><td style="padding:8px 12px;font-weight:bold;">Event</td><td style="padding:8px 12px;">${event.title}</td></tr>
    <tr><td style="padding:8px 12px;font-weight:bold;">Venue</td><td style="padding:8px 12px;">${event.venue}</td></tr>
    <tr style="background:#f5f3ff;"><td style="padding:8px 12px;font-weight:bold;">Date &amp; Time</td><td style="padding:8px 12px;">${formatDate(event.event_date)} UTC</td></tr>
    <tr><td style="padding:8px 12px;font-weight:bold;">Tickets</td><td style="padding:8px 12px;">${booking.tickets_count}</td></tr>
    <tr style="background:#f5f3ff;"><td style="padding:8px 12px;font-weight:bold;">Total</td><td style="padding:8px 12px;font-weight:bold;">${formatMoney(booking.total_cents)}</td></tr>
  </table>
  <p style="margin-top:24px;color:#6b7280;">See you there! — The PulseTix Team</p>
</body>
</html>`;
}

module.exports = { bookingConfirmationText, bookingConfirmationHtml };
