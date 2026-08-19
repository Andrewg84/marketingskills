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

    // Step 2: create the applicant record in the Recruitment app
    const description = [
      `Country: ${country || 'n/a'}`,
      `English confirmed by applicant: ${english_confirmed ? 'yes' : 'no'}`,
      `Landing page version shown: ${source_page_country || 'default'}`,
      `UTM source: ${utm_source || 'n/a'}`,
      `UTM medium: ${utm_medium || 'n/a'}`,
      `UTM campaign: ${utm_campaign || 'n/a'}`,
      `Submitted at: ${submitted_at || 'n/a'}`
    ].join('\n');

    const createRes = await fetch(`${ODOO_URL}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'call',
        params: {
          service: 'object',
          method: 'execute_kw',
          args: [
            ODOO_DB, uid, ODOO_API_KEY,
            'hr.applicant', 'create',
            [{
              partner_name: `${first_name} ${last_name}`,
              email_from: email,
              partner_phone: whatsapp,
              job_id: ODOO_JOB_ID,
              description: description
            }]
          ]
        }
      })
    });
    const createData = await createRes.json();

    if (createData.error) {
      console.error('Odoo create failed', createData.error);
      res.status(502).json({ error: 'Could not save application to Odoo' });
      return;
    }

    res.status(200).json({ ok: true, applicant_id: createData.result });
  } catch (err) {
    console.error('Odoo integration error', err);
    res.status(500).json({ error: 'Unexpected server error' });
  }
}
