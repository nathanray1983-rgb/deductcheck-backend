// Vercel serverless function: POST /api/verify-payment
//
// The one check that actually matters: confirms a Stripe Checkout Session was really paid
// before the site unlocks the full report. Without this, "payment" was just a client-side
// flag anyone could set themselves (open devtools, no card required).
//
// A forged, expired, or cancelled session id simply resolves to paid:false here — this
// endpoint never reveals why, so it gives nothing away to someone probing it.
//
// Required environment variables:
//   STRIPE_SECRET_KEY   - same key as create-checkout-session.js
//   ALLOWED_ORIGIN        - same value used by the other endpoints

import Stripe from "stripe";

function cors(res) {
  const origin = process.env.ALLOWED_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  if (!process.env.STRIPE_SECRET_KEY) {
    console.error("Missing env var: STRIPE_SECRET_KEY");
    return res.status(500).json({ ok: false, error: "server_not_configured" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ ok: false, error: "bad_json" }); }
  }
  const sessionId = body && body.session_id;
  if (typeof sessionId !== "string" || !sessionId.startsWith("cs_") || sessionId.length > 300) {
    return res.status(200).json({ ok: true, paid: false });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    return res.status(200).json({ ok: true, paid: session.payment_status === "paid" });
  } catch (err) {
    // Invalid or unknown session id - Stripe throws. That just means "not paid" to us.
    return res.status(200).json({ ok: true, paid: false });
  }
}
