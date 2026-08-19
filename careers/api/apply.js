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
    utm_source, utm_medium, utm_campaign, submitted_at
  } = req.body || {};

  if (!first_name || !last_name || !email || !whatsapp) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  // One JSON-RPC round-trip to Odoo. Returns the `result`, or throws on an
  // Odoo error so callers can try/catch. Keeps the envelope in one place.
  async function odooCall(service, method, args) {
    const resp = await fetch(`${ODOO_URL}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'call',
        params: { service, method, args }
      })
    });
    const data = await resp.json();
    if (data.error) {
      const e = new Error(data.error.message || 'Odoo RPC error');
      e.odoo = data.error;
      throw e;
    }
    return data.result;
  }

  try {
    // Step 1: log in to Odoo and get a user ID (uid)
    const uid = await odooCall('common', 'authenticate', [ODOO_DB, ODOO_LOGIN, ODOO_API_KEY, {}]);
    if (!uid) {
      console.error('Odoo auth failed (no uid returned)');
      res.status(502).json({ error: 'Could not authenticate with Odoo' });
      return;
    }

    // Find a utm.source/medium/campaign record by name, creating it if it
    // doesn't exist yet, and return its id.
    async function getOrCreateUtm(model, name) {
      const existing = await odooCall('object', 'execute_kw', [
        ODOO_DB, uid, ODOO_API_KEY,
        model, 'search',
        [[['name', '=', name]]],
        { limit: 1 }
      ]);
      if (Array.isArray(existing) && existing.length) return existing[0];
      return await odooCall('object', 'execute_kw', [
        ODOO_DB, uid, ODOO_API_KEY,
        model, 'create',
        [{ name }]
      ]);
    }

    // Step 2: resolve the UTM values to real utm.* record ids so they land in
    // the applicant's proper Source / Medium / Campaign fields. Best-effort:
    // if this fails we log it and still create the applicant, just without
    // the links — a UTM hiccup should never lose an application.
    const utmFields = {};
    try {
      const sourceName = utm_source || 'careers_page';
      const mediumName = utm_medium || 'website';
      const campaignName = utm_campaign || source_page_country || 'default';
      utmFields.source_id = await getOrCreateUtm('utm.source', sourceName);
      utmFields.medium_id = await getOrCreateUtm('utm.medium', mediumName);
      utmFields.campaign_id = await getOrCreateUtm('utm.campaign', campaignName);
    } catch (utmErr) {
      console.error('UTM lookup/create failed (creating applicant without UTM links)', utmErr);
    }

    // Step 3: create the applicant record in the Recruitment app
    let applicantId;
    try {
      applicantId = await odooCall('object', 'execute_kw', [
        ODOO_DB, uid, ODOO_API_KEY,
        'hr.applicant', 'create',
        [{
          partner_name: `${first_name} ${last_name}`,
          email_from: email,
          partner_phone: whatsapp,
          job_id: ODOO_JOB_ID,
          ...utmFields
        }]
      ]);
    } catch (createErr) {
      console.error('Odoo create failed', createErr);
      res.status(502).json({ error: 'Could not save application to Odoo' });
      return;
    }

    // Step 4: post the remaining applicant details as a note in the record's
    // chatter via message_post. UTM values are now proper linked fields, so
    // they're no longer repeated in this note. Best-effort — a failed note
    // never fails the application submission itself.
    const description = [
      `Country: ${country || 'n/a'}`,
      `English confirmed by applicant: ${english_confirmed ? 'yes' : 'no'}`,
      `Landing page version shown: ${source_page_country || 'default'}`,
      `Submitted at: ${submitted_at || 'n/a'}`
    ].join('\n');

    try {
      await odooCall('object', 'execute_kw', [
        ODOO_DB, uid, ODOO_API_KEY,
        'hr.applicant', 'message_post',
        [[applicantId]],
        { body: description.replace(/\n/g, '<br>') }
      ]);
    } catch (noteErr) {
      console.error('Odoo message_post error (application still saved)', noteErr);
    }

    res.status(200).json({ ok: true, applicant_id: applicantId });
  } catch (err) {
    console.error('Odoo integration error', err);
    res.status(500).json({ error: 'Unexpected server error' });
  }
}
