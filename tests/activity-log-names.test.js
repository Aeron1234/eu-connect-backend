import {test,after} from 'node:test';import assert from 'node:assert/strict';import {db} from '../config/db.js';import cache from '../config/cache.js';import {getActivityLogUserName} from '../config/activityLogNames.js';import {deactivateAccount,reactivateAccount} from '../controllers/accountControllers.js';
const original=db.getConnection;after(async()=>{db.getConnection=original;cache.close();await db.end();});
test('activity name lookup trims full names, supports partial names and never substitutes IDs',async()=>{
 for(const [rows,expected]of [[[{first_name:' Ana ',last_name:' Cruz '}],'Ana Cruz'],[[{first_name:'Ana',last_name:null}],'Ana'],[[],'User name unavailable'],[[{first_name:' ',last_name:null}],'User name unavailable']])assert.equal(await getActivityLogUserName({async execute(sql,params){assert.deepEqual(params,['private-user-id']);return [rows];}},'private-user-id'),expected);
 const error=console.error;console.error=()=>{};try{assert.equal(await getActivityLogUserName({async execute(){throw Error('offline');}},'private-user-id'),'User name unavailable');}finally{console.error=error;}
});
test('account status logs persist target full names while preserving structured IDs',async()=>{
 for(const handler of [deactivateAccount,reactivateAccount])for(const missing of [false,true]){
 let log,committed=false;db.getConnection=async()=>({release(){},async beginTransaction(){},async rollback(){},async commit(){committed=true;},async execute(sql,params){if(sql.includes('FROM user_profiles'))return [missing?[]:[{first_name:'Ana',last_name:'Cruz'}]];if(sql.includes('INSERT INTO activity_logs'))log=params;return [{affectedRows:1}];}});
 const res={statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;}};
 await handler({verifiedUser:{id:'admin-id',role:'admin'},params:{accountId:'private-user-id'}},res);assert.equal(res.statusCode,200);assert.ok(committed);assert.equal(log[0],'admin-id');assert.equal(log[4],'private-user-id');assert.ok(log[5].includes(missing?'User name unavailable':'Ana Cruz'));assert.ok(!log[5].includes('private-user-id'));
 }
});
