// Vercel serverless function: POST /api/submit-report
// Sends the client their report + evidence pack by email, bcc's the practice inbox
// (that bcc IS the secure copy — it lands wherever the practice's normal email retention
// already applies), and confirms receipt in the same email.
//
// Required environment variables (set in the Vercel project, never in this file):
//   RESEND_API_KEY   - from resend.com, after verifying a sending domain
//   FROM_EMAIL        - e.g. "DeductCheck <reports@mail.clearlinetax.com.au>" (must match the verified domain)
//   PRACTICE_EMAIL    - the practice inbox to bcc, e.g. "records@clearlinetax.com.au"
//   ALLOWED_ORIGIN    - the site's real origin once deployed, e.g. "https://clearlinetax.com.au" (or wherever DeductCheck ends up hosted)
//                        (locks down who can call this endpoint; set to "*" only for testing)

const MAX_BODY_BYTES = 8 * 1024 * 1024; // 8MB raw request cap - keeps a burst of large photo evidence packs from costing real money per call

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

  const required = ["RESEND_API_KEY", "FROM_EMAIL", "PRACTICE_EMAIL"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error("Missing env vars:", missing.join(", "));
    return res.status(500).json({ ok: false, error: "server_not_configured" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ ok: false, error: "bad_json" }); }
  }
  if (!body || typeof body !== "object") return res.status(400).json({ ok: false, error: "bad_json" });

  const { clientEmail, clientName, clientPhone, year, occupation, summary, reportText, packBase64, packFilename, consent, handoff, rulesVersion } = body;

  if (!consent) return res.status(400).json({ ok: false, error: "consent_required" });
  if (!isValidEmail(clientEmail)) return res.status(400).json({ ok: false, error: "invalid_client_email" });
  if (handoff && (typeof clientPhone !== "string" || clientPhone.trim().length < 6 || clientPhone.length > 30)) {
    return res.status(400).json({ ok: false, error: "invalid_client_phone" });
  }
  if (typeof reportText !== "string" || reportText.length < 1 || reportText.length > 200000) {
    return res.status(400).json({ ok: false, error: "invalid_report_text" });
  }
  if (packBase64) {
    const approxBytes = packBase64.length * 0.75;
    if (approxBytes > MAX_BODY_BYTES) return res.status(413).json({ ok: false, error: "pack_too_large" });
    if (typeof packFilename !== "string" || !/^[\w.\-() ]{1,120}\.zip$/i.test(packFilename)) {
      return res.status(400).json({ ok: false, error: "invalid_pack_filename" });
    }
  }

  const safeName = (clientName || "").toString().slice(0, 100).replace(/[<>]/g, "");
  const safeYear = (year || "").toString().slice(0, 20).replace(/[<>]/g, "");
  const safeOcc = (occupation || "").toString().slice(0, 100).replace(/[<>]/g, "");
  const safePhone = (clientPhone || "").toString().slice(0, 30).replace(/[<>]/g, "");
  const sup = summary && typeof summary.supported === "number" ? summary.supported : null;
  const claimed = summary && typeof summary.claimed === "number" ? summary.claimed : null;
  const money = (n) => (typeof n === "number" ? "$" + Math.round(n).toLocaleString("en-AU") : "—");

  const html = handoff ? `
    <div style="font-family:Arial,sans-serif;color:#1F3D36;line-height:1.5;max-width:600px">
      <h2 style="margin:0 0 8px">New DeductCheck lead \u2014 wants Clearline to take over</h2>
      <p>This person currently lodges through another agent and asked, via DeductCheck, for Clearline to prepare and lodge their ${safeYear || "current"} return instead.</p>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:4px 16px 4px 0;color:#56675F">Name</td><td style="padding:4px 0;font-weight:bold">${safeName || "\u2014"}</td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#56675F">Phone</td><td style="padding:4px 0;font-weight:bold">${safePhone}</td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#56675F">Email</td><td style="padding:4px 0;font-weight:bold">${clientEmail}</td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#56675F">Occupation</td><td style="padding:4px 0">${safeOcc || "\u2014"}</td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#56675F">Entered / Supported</td><td style="padding:4px 0">${money(claimed)} / ${money(sup)}</td></tr>
      </table>
      <p>Full report and evidence pack attached.</p>
      <p style="color:#56675F;font-size:13px;margin-top:24px">DeductCheck \u00b7 Rules version ${rulesVersion || "unknown"}</p>
    </div>` : `
    <div style="font-family:Arial,sans-serif;color:#1F3D36;line-height:1.5;max-width:600px">
      <h2 style="margin:0 0 8px">Your DeductCheck report${safeYear ? " — " + safeYear : ""}</h2>
      <p>Hi${safeName ? " " + safeName : ""},</p>
      <p>Attached is your deduction report and evidence pack${safeOcc ? " for your work as " + safeOcc : ""}.</p>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:4px 16px 4px 0;color:#56675F">You entered</td><td style="padding:4px 0;font-weight:bold">${money(claimed)}</td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#56675F">Supported</td><td style="padding:4px 0;font-weight:bold">${money(sup)}</td></tr>
      </table>
      <p>This confirms DeductCheck has kept a copy of this report for our records, as required of a registered tax agent. Keep your copy — and the evidence pack — for at least five years.</p>
      <p style="color:#56675F;font-size:13px;margin-top:24px">DeductCheck, a service of Clearline Tax & Accounting \u00b7 Registered tax agent 25624306<br>Rules version ${rulesVersion || "unknown"}</p>
    </div>`;

  const attachments = [{ filename: "report.txt", content: Buffer.from(reportText, "utf8").toString("base64") }];
  if (packBase64) attachments.push({ filename: packFilename || "evidence-pack.zip", content: packBase64 });

  let resendResp;
  try {
    resendResp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(handoff ? {
        from: process.env.FROM_EMAIL,
        to: [process.env.PRACTICE_EMAIL],
        cc: [clientEmail],
        subject: `New DeductCheck lead — ${safeName || "client"} wants Clearline to take over`,
        html,
        attachments,
      } : {
        from: process.env.FROM_EMAIL,
        to: [clientEmail],
        bcc: [process.env.PRACTICE_EMAIL],
        subject: `Your DeductCheck report${safeYear ? " — " + safeYear : ""}`,
        html,
        attachments,
      }),
    });
  } catch (e) {
    console.error("Resend request failed:", e);
    return res.status(502).json({ ok: false, error: "email_send_failed" });
  }

  if (!resendResp.ok) {
    const errText = await resendResp.text().catch(() => "");
    console.error("Resend API error:", resendResp.status, errText);
    return res.status(502).json({ ok: false, error: "email_send_failed" });
  }

  return res.status(200).json({ ok: true });
}

export const config = { api: { bodyParser: { sizeLimit: "10mb" } } };
