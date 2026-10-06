import test from 'node:test';
import assert from 'node:assert/strict';
import { getFarmTimeZone } from '../src/components/farmTwinGeometry.js';

test('prefers a saved farm timezone, then the timezone returned for its coordinates', () => {
  assert.equal(
    getFarmTimeZone(
      { timezone: 'America/Los_Angeles', location: { country: 'India' } },
      { timezone: 'Asia/Kolkata' }
    ),
    'America/Los_Angeles'
  );
  assert.equal(getFarmTimeZone({}, { timezone: 'Australia/Sydney' }), 'Australia/Sydney');
});

test('uses the legacy India timezone only for known India farms and UTC otherwise', () => {
  assert.equal(getFarmTimeZone({ farmLocation: { country: 'India' } }), 'Asia/Kolkata');
  assert.equal(getFarmTimeZone({ farmLocation: { country: 'United States' } }), 'UTC');
});
