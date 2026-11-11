import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../scripts/'+name,import.meta.url),'utf8');
test('notification recovery preserves existing enum members and supports long Attendance URLs without session variables',()=>{
 const baseline=read('2026-11-07-dtr-overtime-auto-close-review.sql').split('MODIFY COLUMN type ENUM(')[1].split(') NOT NULL')[0];
 const recovery=read('2026-11-11-dtr-duty-notification-recovery.sql');
 for(const match of baseline.matchAll(/'([^']+)'/g))assert(recovery.includes(match[0]));
 assert(recovery.includes("'dtr_absence'"));assert(recovery.includes("'dtr_duty_schedule'"));
 assert.match(recovery,/MODIFY COLUMN link VARCHAR\(255\)/);
 assert(!recovery.includes('@notification'));
 assert(!recovery.includes('CREATE TABLE'));
 const main=read('2026-11-11-dtr-duty-schedules-absence.sql');assert(!main.includes('PREPARE '));
 assert(main.includes('MODIFY COLUMN link VARCHAR(255)'));
});
