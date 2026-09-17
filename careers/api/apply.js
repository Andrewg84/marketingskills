// This file runs on the server, NEVER in the visitor's browser.
// The Odoo API key stays hidden here — it's read from Vercel's
// "Environment Variables" (a safe), never written into this code.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const ODOO_URL = process.env.ODOO_URL;       // e.g. https://careers.garciateam.com
  const ODOO_DB = process.env.ODOO_DB;          // e.g. garcia_ats
  const ODOO_LOGIN = process.env.ODOO_LOGIN;    // e.g. andy@collectivesolar.io
  const ODOO_API_KEY = process.env.ODOO_API_KEY; // the secret key
  const ODOO_JOB_ID = parseInt(process.env.ODOO_JOB_ID || '3', 10); // "Solar Appointment Setter"

  if (!ODOO_URL || !ODOO_DB || !ODOO_LOGIN || !ODOO_API_KEY) {
    console.error('Missing Odoo environment variables');
    res.status(500).json({ error: 'Server not configured yet' });
    return;
  }

  const {
    first_name, last_name, email, whatsapp, country,
    english_confirmed, source_page_country,
    utm_source, utm_medium, utm_campaign, submitted_at,
    resume_filename, resume_base64
  } = req.body || {};

  if (!first_name || !last_name || !email || !whatsapp) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }
  if (!resume_filename || !resume_base64) {
    res.status(400).json({ error: 'Resume is required' });
    return;
  }

  try {
    // Step 1: log in to Odoo and get a user ID (uid)
    const authRes = await fetch(`${ODOO_URL}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'call',
        params: {
          service: 'common',
          method: 'authenticate',
          args: [ODOO_DB, ODOO_LOGIN, ODOO_API_KEY, {}]
        }
      })
    });
    const authData = await authRes.json();
    const uid = authData.result;

    if (!uid) {
      console.error('Odoo auth failed', authData);
      res.status(502).json({ error: 'Could not authenticate with Odoo' });
      return;
    }

    // Small helper to call Odoo's execute_kw for anything below
    async function odooCall(model, method, args, kwargs) {
      const r = await fetch(`${ODOO_URL}/jsonrpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'call',
          params: {
            service: 'object',
            method: 'execute_kw',
            args: [ODOO_DB, uid, ODOO_API_KEY, model, method, args, kwargs || {}]
          }
        })
      });
      const d = await r.json();
      if (d.error) throw new Error(JSON.stringify(d.error));
      return d.result;
    }

    // Find an existing utm.source / utm.medium / utm.campaign record by
    // name, or create one if it doesn't exist yet. This is what makes the
    // channel (Facebook, Indeed, etc.) show up in Odoo's real filters and
    // pivot reports — not just as a note someone has to read manually.
    // Matching is case-insensitive so "facebook" and "Facebook" are
    // treated as the same tag instead of splitting into two.
    async function getOrCreateUtm(model, name) {
      if (!name) return false;
      const found = await odooCall(model, 'search', [[['name', '=ilike', name]]], { limit: 1 });
      if (found && found.length) return found[0];
      return await odooCall(model, 'create', [{ name }]);
    }

    const [sourceId, mediumId, campaignId] = await Promise.all([
      getOrCreateUtm('utm.source', utm_source || 'careers_page'),
      getOrCreateUtm('utm.medium', utm_medium || 'website'),
      getOrCreateUtm('utm.campaign', utm_campaign || source_page_country || 'general')
    ]);

    // Step 2: create the applicant record in the Recruitment app, with
    // source/medium/campaign set as real linked fields (not just text)
    const applicantVals = {
      partner_name: `${first_name} ${last_name}`,
      email_from: email,
      partner_phone: whatsapp,
      job_id: ODOO_JOB_ID
    };
    if (sourceId) applicantVals.source_id = sourceId;
    if (mediumId) applicantVals.medium_id = mediumId;
    if (campaignId) applicantVals.campaign_id = campaignId;

    const applicantId = await odooCall('hr.applicant', 'create', [applicantVals]);

    // If a resume was uploaded, attach it directly to the applicant record
    // so it shows up in the file/attachment area on their profile in Odoo.
    if (resume_filename && resume_base64) {
      try {
        await odooCall('ir.attachment', 'create', [{
          name: resume_filename,
          datas: resume_base64,
          res_model: 'hr.applicant',
          res_id: applicantId
        }]);
      } catch (attachErr) {
        // Non-fatal — the applicant is already saved even if the resume
        // attachment fails for some reason.
        console.error('Could not attach resume (non-fatal)', attachErr);
      }
    }

    // Add the human-readable extras (country, English confirmation, which
    // landing page variant was shown) as a note — these don't have native
    // Odoo fields, so a chatter note is the right place for them.
    const description = [
      `Country: ${country || 'n/a'}`,
      `English confirmed by applicant: ${english_confirmed ? 'yes' : 'no'}`,
      `Landing page version shown: ${source_page_country || 'default'}`,
      `Submitted at: ${submitted_at || 'n/a'}`
    ].join('\n');

    try {
      await odooCall('hr.applicant', 'message_post', [[applicantId]], { body: description });
    } catch (noteErr) {
      // Non-fatal — the applicant record (with its source/medium/campaign
      // tracking already set) was still created successfully.
      console.error('Could not post note (non-fatal)', noteErr);
    }

    res.status(200).json({ ok: true, applicant_id: applicantId });
  } catch (err) {
    console.error('Odoo integration error', err);
    res.status(500).json({ error: 'Unexpected server error' });
  }
}
