import assert from 'node:assert/strict';
import {isOwner} from '../server/identity.mjs';
const request = new Request('https://game.example', {
  headers: {
    'oai-authenticated-user-id': 'spoof',
    'oai-authenticated-user-email': 'owner@example.com',
    'Cf-Access-Authenticated-User-Email': 'owner@example.com',
    'Cf-Access-Jwt-Assertion': 'forged',
  },
});
const env = {AUCTION_OWNER_EMAIL: 'owner@example.com', CF_ACCESS_AUD: 'admin-app'};
const identity = (aud, email) => ({access: {aud, getIdentity: async () => ({email})}});
assert.equal(await isOwner(request, env), false);
assert.equal(await isOwner(request, {AUCTION_OWNER_EMAIL: env.AUCTION_OWNER_EMAIL}), false);
assert.equal(await isOwner(request, {...env, AUTH_PROVIDER: 'sites'}), false);
assert.equal(await isOwner(request, env, identity('wrong', env.AUCTION_OWNER_EMAIL)), false);
assert.equal(await isOwner(request, env, identity('admin-app', 'other@example.com')), false);
assert.equal(
  await isOwner(request, env, {
    access: {
      aud: 'admin-app',
      getIdentity: async () => {
        throw new Error('identity service down');
      },
    },
  }),
  false,
);
assert.equal(await isOwner(request, env, identity('admin-app', 'Owner@Example.com')), true);
console.log(
  'PASS: forged identity headers denied, legacy provider setting ignored, Access audience and owner identity required.',
);
