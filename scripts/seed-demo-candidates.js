const { query } = require('../src/config/database');
const { encrypt } = require('../src/utils/encryption');

const candidates = [
  { full_name: 'Priya Sharma', phone: '+919876543210', email: 'priya.sharma@techmail.com', source: 'LinkedIn', ats_id: 'LI-9821' },
  { full_name: 'Rahul Verma', phone: '+919812345678', email: 'rahul.verma@codehub.io', source: 'Referral', ats_id: 'REF-048' },
  { full_name: 'Aditi Rao', phone: '+919823456789', email: 'aditi.rao@cloudnet.in', source: 'ATS', ats_id: 'GH-10023' },
  { full_name: 'Karthik Nair', phone: '+919834567890', email: 'karthik.nair@devconnect.org', source: 'Naukri', ats_id: 'NK-7712' }
];

async function seed() {
  for (const c of candidates) {
    const existing = await query('SELECT candidate_id FROM candidates WHERE full_name = $1', [c.full_name]);
    if (existing.rows.length === 0) {
      await query(`
        INSERT INTO candidates (full_name, phone_number, email, source, ats_id)
        VALUES ($1, $2, $3, $4, $5)
      `, [c.full_name, encrypt(c.phone), encrypt(c.email), c.source, c.ats_id]);
      console.log('Seeded:', c.full_name);
    }
  }
  console.log('Done seeding demo candidates!');
}

seed().catch(console.error);
