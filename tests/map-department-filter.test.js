import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {db} from '../config/db.js';
import {getStudentMap} from '../features/map/controllers/mapControllers.js';
const original=db.getConnection;
after(async()=>{db.getConnection=original;await db.end();});
test('map includes department options and per-intern metadata without splitting shared sites',async()=>{
 let query='',released=false;
 const base={company_name:'Hotel',company_address:'Manila',lat:14,lon:121,first_name:'Student',last_name:'Name',region_id:1,region_name:'NCR',total_hours:100,accumulated_hours:20};
 const rows=[{...base,id:'a',user_id:'a',department_id:2,department_code:'CCS',department_name:'Computing'},{...base,id:'b',user_id:'b',department_id:1,department_code:'CITHM',department_name:'Hospitality'}];
 db.getConnection=async()=>({connection:{execute(sql){query=sql;return {stream(){return (async function*(){yield* rows;})();}};}},release(){released=true;}});
 const res={status(code){this.code=code;return this;},json(body){this.body=body;}};
 await getStudentMap({verifiedUser:{role:'department_head'}},res);
 assert.equal(res.code,200);assert.equal(res.body.companies.length,1);assert.equal(res.body.companies[0].intern_count,2);assert.equal(res.body.companies[0].interns[1].department_id,1);assert.deepEqual(res.body.availableDepartments.map(d=>d.code),['CCS','CITHM']);assert.match(query,/sai1.department_id/);assert.match(query,/LEFT JOIN departments/);assert.ok(released);
});
