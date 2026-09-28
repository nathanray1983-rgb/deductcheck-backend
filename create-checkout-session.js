// Vercel serverless function: POST /api/create-checkout-session
//
// Starts a real, verifiable Stripe payment before the full DeductCheck report unlocks.
// The price is set here, server-side, from STRIPE_FEE_CENTS — never trust an amount sent
// by the browser, since anyone can edit that before it reaches us.
//
// Required environment variables (Vercel project settings, never in this file):
//   STRIPE_SECRET_KEY   - from the Stripe Dashboard (Developers -> API keys). Starts with sk_.
//   STRIPE_FEE_CENTS     - the report fee in cents, e.g. 1900 for $19.00 AUD.
//                          MUST be kept in sync with RULES.fee in the site's own code —
//                          if you change one without the other, the price shown on the
//                          gate screen and the price Stripe actually charges will disagree.
//   SITE_URL             - the site's real origin, e.g. https://clearlinetax.com.au/deduction-check.html
//                          (used to build the return links after payment)
//   ALLOWED_ORIGIN        - locks down who can call this endpoint; same value used by submit-report.js

import Stripe from "stripe";

function cors(res) {
  const origin = process.env.ALLOWED_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function isValidEmail(e) {
  return typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length < 200;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  const required = ["STRIPE_SECRET_KEY", "STRIPE_FEE_CENTS", "SITE_URL"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error("Missing env vars:", missing.join(", "));
    return res.status(500).json({ ok: false, error: "server_not_configured" });
  }

  const feeCents = Number(process.env.STRIPE_FEE_CENTS);
  if (!Number.isInteger(feeCents) || feeCents < 100 || feeCents > 100000) {
    console.error("STRIPE_FEE_CENTS is not a sane integer:", process.env.STRIPE_FEE_CENTS);
    return res.status(500).json({ ok: false, error: "server_not_configured" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ ok: false, error: "bad_json" }); }
  }
  const email = body && isValidEmail(body.email) ? body.email : undefined;

  const site = process.env.SITE_URL.replace(/\/$/, "");
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: email, // pre-fills checkout so Stripe's own receipt lands in the same inbox as the report
      line_items: [{
        price_data: {
          currency: "aud",
          product_data: { name: "DeductCheck full deductions report" },
          unit_amount: feeCents,
        },
        quantity: 1,
      }],
      // {CHECKOUT_SESSION_ID} is filled in by Stripe itself, not by this code.
      success_url: `${site}?paid_session={CHECKOUT_SESSION_ID}#start`,
      cancel_url: `${site}?paid_session=cancelled#start`,
    });
    return res.status(200).json({ ok: true, url: session.url });
  } catch (err) {
    console.error("create-checkout-session failed:", err);
    return res.status(500).json({ ok: false, error: "stripe_error" });
  }
}
