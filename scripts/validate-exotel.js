#!/usr/bin/env node
/**
 * Exotel Credential Validator
 * Run: node scripts/validate-exotel.js
 * Tests your Exotel API key/token by fetching account info
 */
require('dotenv').config();
const axios = require('axios');

async function validateExotel() {
  const sid   = process.env.EXOTEL_ACCOUNT_SID;
  const key   = process.env.EXOTEL_API_KEY;
  const token = process.env.EXOTEL_API_TOKEN;
  const phone = process.env.EXOTEL_PHONE_NUMBER;
  const sub   = process.env.EXOTEL_SUBDOMAIN || 'api.exotel.com';

  console.log('\n🔍 Exotel Credential Validator');
  console.log('═══════════════════════════════════════');

  const missing = [];
  if (!sid   || sid.includes('your_'))   missing.push('EXOTEL_ACCOUNT_SID');
  if (!key   || key.includes('your_'))   missing.push('EXOTEL_API_KEY');
  if (!token || token.includes('your_')) missing.push('EXOTEL_API_TOKEN');
  if (!phone || phone.includes('your_')) missing.push('EXOTEL_PHONE_NUMBER');

  if (missing.length > 0) {
    console.log('\n❌ Missing credentials in .env:');
    missing.forEach(m => console.log(`   • ${m}`));
    console.log('\n📋 How to find them in Exotel Dashboard:');
    console.log('   1. Log in → https://my.exotel.com');
    console.log('   2. Click your name (top-right) → "Settings"');
    console.log('   3. Go to → "API Settings" / "Developer API"');
    console.log('   ┌─────────────────────────────────────────────────────────┐');
    console.log('   │  EXOTEL_ACCOUNT_SID  = "Account SID" (e.g. exotelapp)  │');
    console.log('   │  EXOTEL_API_KEY      = "API Key"                        │');
    console.log('   │  EXOTEL_API_TOKEN    = "API Token"                      │');
    console.log('   │  EXOTEL_PHONE_NUMBER = Your ExoPhone (e.g. 0XXXXXXXXXX) │');
    console.log('   │  EXOTEL_SUBDOMAIN    = api.exotel.com (default)         │');
    console.log('   └─────────────────────────────────────────────────────────┘');
    process.exit(1);
  }

  console.log(`\n✅ All 4 credentials found in .env`);
  console.log(`   Account SID : ${sid}`);
  console.log(`   API Key     : ${key.substring(0, 6)}${'*'.repeat(key.length - 6)}`);
  console.log(`   API Token   : ${token.substring(0, 6)}${'*'.repeat(token.length - 6)}`);
  console.log(`   ExoPhone    : ${phone}`);
  console.log(`   Subdomain   : ${sub}`);

  // Test API connectivity
  console.log('\n⏳ Testing Exotel API connection...');
  try {
    const authHeader = Buffer.from(`${key}:${token}`).toString('base64');
    const response = await axios.get(
      `https://${sub}/v1/Accounts/${sid}.json`,
      {
        headers: { Authorization: `Basic ${authHeader}` },
        timeout: 8000,
      }
    );
    const account = response.data?.Account;
    console.log('\n🎉 Exotel Connected Successfully!');
    console.log(`   Account Name  : ${account?.FriendlyName || sid}`);
    console.log(`   Account Status: ${account?.Status || 'Active'}`);
    console.log(`   Account Type  : ${account?.Type || 'Trial'}`);
    console.log('\n✅ Exotel is ready for outbound AI recruitment calls!');
    console.log('   → Restart your server: node src/server.js');
    console.log('   → System will auto-switch to Exotel provider\n');
  } catch (err) {
    const status = err.response?.status;
    const body   = JSON.stringify(err.response?.data || {});
    console.log('\n❌ Exotel API connection failed!');
    console.log(`   HTTP Status : ${status || 'Network Error'}`);
    console.log(`   Error       : ${err.message}`);
    if (body !== '{}') console.log(`   Response    : ${body}`);
    if (status === 401) {
      console.log('\n💡 Fix: API Key or Token is wrong. Go to Exotel Dashboard → API Settings and copy them again.');
    } else if (status === 404) {
      console.log('\n💡 Fix: Account SID is wrong. It should match your Exotel login (e.g. "exotelapp123").');
    } else if (!status) {
      console.log('\n💡 Fix: Could not reach Exotel API. Check your internet connection.');
      console.log('   Also try setting EXOTEL_SUBDOMAIN=api.in.exotel.com in .env');
    }
    process.exit(1);
  }
}

validateExotel().catch(console.error);
