import assert from 'node:assert/strict';
import {withDeadline} from '../site/src/platform/deadline.js';
assert.equal(await withDeadline(Promise.resolve('ready'),10),'ready');
const error=await withDeadline(new Promise(()=>{}),1,'slow service').then(()=>null,error=>error);
assert.equal(error.code,'TIMEOUT');assert.equal(error.message,'slow service');
await assert.rejects(withDeadline(Promise.reject(Error('unavailable')),100),/unavailable/);
console.log('Bounded session/permission operations preserve success and failure identity: PASS');
