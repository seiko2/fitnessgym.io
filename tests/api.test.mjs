import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { pbkdf2Sync } from 'node:crypto';
import { handleApi,verifyPassword } from '../src/api.js';

class D1 {
 constructor(sql){this.sqlite=new DatabaseSync(':memory:');this.sqlite.exec('PRAGMA foreign_keys=ON;'+sql);}
 prepare(sql){const db=this.sqlite;let values=[];const statement={bind(...args){values=args;return statement;},async first(){return db.prepare(sql).get(...values)||null;},async all(){return {results:db.prepare(sql).all(...values)};},async run(){const r=db.prepare(sql).run(...values);return {success:true,meta:{changes:Number(r.changes)}};}};return statement;}
 async batch(statements){this.sqlite.exec('BEGIN');try{const result=[];for(const stmt of statements)result.push(await stmt.run());this.sqlite.exec('COMMIT');return result;}catch(error){this.sqlite.exec('ROLLBACK');throw error;}}
}
const salt='5f1b21a4c9d7e02a4f918b90d0657320';
const pass='testing-only-passphrase';
const hash='pbkdf2_sha256$100000$'+salt+'$'+pbkdf2Sync(pass,Buffer.from(salt,'hex'),100000,32,'sha256').toString('hex');
const sql=await readFile(new URL('../drizzle/0000_init.sql',import.meta.url),'utf8')+'\n'+await readFile(new URL('../drizzle/0001_erp.sql',import.meta.url),'utf8');
function fixture(){return {DB:new D1(sql),ADMIN_PASSWORD_HASH:hash};}
async function call(env,path,{body,method=body?'POST':'GET',cookie,bearer,headers={}}={}){
 const h={'Origin':'https://gym.example',...headers};if(body)h['Content-Type']='application/json';if(cookie)h.Cookie=cookie;if(bearer)h.Authorization='Bearer '+bearer;
 const response=await handleApi(new Request('https://gym.example'+path,{method,headers:h,...(body?{body:JSON.stringify(body)}:{})}),env);return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')};
}
const memberInput={name:'Amina Test',email:'amina@example.com',phone:'+256700000001',age:26,plan:'monthly',trainer:false,weight:70,height:1.7,consent:true};
async function login(env){const r=await call(env,'/api/admin/login',{body:{username:'seiko',password:pass}});assert.equal(r.status,200);assert.match(r.cookie,/HttpOnly; Secure; SameSite=Strict/);return r.cookie.split(';')[0];}
const mutation=(env,path,cookie,body)=>call(env,path,{body,cookie,headers:{'X-Requested-With':'EliteGym'}});

test('password hashing verifies salted PBKDF2 and rejects wrong values',async()=>{assert.equal(await verifyPassword(pass,hash),true);assert.equal(await verifyPassword('wrong',hash),false);assert.equal(await verifyPassword(pass,'bad'),false);});
test('registration persists correct base fee and optional trainer pricing, without fake revenue',async()=>{
 const env=fixture();const r=await call(env,'/api/register',{body:memberInput});assert.equal(r.status,201);assert.equal(r.data.member.total,120000);assert.equal(r.data.member.trainer_fee,0);assert.equal(r.data.member.status,'pending');assert.equal(r.data.member.balance,120000);assert.equal(r.data.member.total_paid,0);assert.equal(r.data.member.portal_token_hash,undefined);
 const portal=await call(env,'/api/member',{bearer:r.data.card_token});assert.equal(portal.data.member.name,'Amina Test');assert.deepEqual(portal.data.payments,[]);
 const withTrainer=await call(env,'/api/register',{body:{...memberInput,email:'trainer@example.com',trainer:true,weight:72,height:1.72}});assert.equal(withTrainer.data.member.total,170000);assert.equal(withTrainer.data.member.trainer_fee,50000);assert.equal(withTrainer.data.member.bmi,24.3);
 const verify=await call(env,'/api/verify?code='+r.data.member.card_code);assert.equal(verify.data.valid,true);assert.equal(verify.data.email,undefined);assert.equal(verify.data.phone,undefined);assert.equal(verify.data.card_token,undefined);
 assert.equal((await call(env,'/api/member')).status,401);
});
test('validation and duplicate registrations leave counts and charges unchanged',async()=>{
 const env=fixture();assert.equal((await call(env,'/api/register',{body:{...memberInput,consent:false}})).status,400);assert.equal((await call(env,'/api/register',{body:{...memberInput,height:0,weight:70}})).status,400);assert.equal((await call(env,'/api/register',{body:{...memberInput,age:12}})).status,400);
 await call(env,'/api/register',{body:memberInput});assert.equal((await call(env,'/api/register',{body:memberInput})).status,409);assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) count FROM members').get().count,1);assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) count FROM charges').get().count,1);
});
test('admin authorization, payment accounting, attendance, renewals and audit trail',async()=>{
 const env=fixture();assert.equal((await call(env,'/api/admin/data')).status,401);assert.equal((await call(env,'/api/admin/login',{body:{username:'seiko',password:'wrong'}})).status,401);const cookie=await login(env);
 const registration=await call(env,'/api/register',{body:memberInput}),memberId=registration.data.member.id;
 assert.equal((await call(env,'/api/admin/member',{cookie,body:{id:memberId,name:'Changed'}})).status,403);
 assert.equal((await mutation(env,'/api/admin/checkin',cookie,{member_id:memberId})).status,400);
 assert.equal((await mutation(env,'/api/admin/payment',cookie,{member_id:memberId,amount:120001,method:'Cash'})).status,400);
 const paid=await mutation(env,'/api/admin/payment',cookie,{member_id:memberId,amount:120000,method:'Cash',reference:'TEST-001'});assert.equal(paid.status,200);assert.equal(paid.data.member.status,'active');assert.equal(paid.data.member.balance,0);
 assert.equal((await mutation(env,'/api/admin/checkin',cookie,{member_id:memberId})).status,200);assert.equal((await mutation(env,'/api/admin/checkin',cookie,{member_id:memberId})).status,409);
 const renewal=await mutation(env,'/api/admin/renew',cookie,{member_id:memberId,plan:'daily',trainer:true});assert.equal(renewal.status,200);assert.equal(renewal.data.member.charge_total,145000);assert.equal(renewal.data.member.total_paid,120000);assert.equal(renewal.data.member.balance,25000);
 const data=await call(env,'/api/admin/data',{cookie});assert.equal(data.data.payments.length,1);assert.equal(data.data.attendance.length,1);assert.ok(data.data.activity.some(a=>a.action==='membership_renewed'));assert.ok(data.data.activity.some(a=>a.action==='payment_recorded'));
 assert.equal((await mutation(env,'/api/admin/logout',cookie,{})).status,200);assert.equal((await call(env,'/api/admin/data',{cookie})).status,401);
});
test('class booking enforces active membership, capacity and cancellation ownership',async()=>{
 const env=fixture(),cookie=await login(env);
 await mutation(env,'/api/admin/class',cookie,{id:'test-class',title:'Strength foundations',day:'Monday',time:'18:00',duration:60,capacity:1,trainer:'Coach',active:1});
 const one=await call(env,'/api/register',{body:memberInput}),two=await call(env,'/api/register',{body:{...memberInput,email:'second@example.com'}});
 assert.equal((await call(env,'/api/member/book',{bearer:one.data.card_token,body:{class_id:'test-class'}})).status,400);
 for(const r of [one,two])await mutation(env,'/api/admin/payment',cookie,{member_id:r.data.member.id,amount:120000,method:'Cash',reference:r.data.member.id});
 assert.equal((await call(env,'/api/member/book',{bearer:one.data.card_token,body:{class_id:'test-class'}})).status,200);
 assert.equal((await call(env,'/api/member/book',{bearer:two.data.card_token,body:{class_id:'test-class'}})).status,409);
 const portal=await call(env,'/api/member',{bearer:one.data.card_token}),booking=portal.data.bookings[0];
 assert.equal((await call(env,'/api/member/cancel',{bearer:two.data.card_token,body:{booking_id:booking.id}})).status,404);
 assert.equal((await call(env,'/api/member/cancel',{bearer:one.data.card_token,body:{booking_id:booking.id}})).status,200);
 assert.equal((await call(env,'/api/member/book',{bearer:two.data.card_token,body:{class_id:'test-class'}})).status,200);
});
test('cross-origin writes and bad schedules are rejected, plan changes persist',async()=>{
 const env=fixture(),cookie=await login(env);
 assert.equal((await call(env,'/api/register',{body:memberInput,headers:{Origin:'https://attacker.example'}})).status,403);
 assert.equal((await mutation(env,'/api/admin/class',cookie,{title:'Late class',day:'Monday',time:'23:30',duration:60,capacity:10})).status,400);
 assert.equal((await mutation(env,'/api/admin/plan',cookie,{id:'monthly',fee:130000,trainer_fee:55000,days:31})).status,200);
 const config=await call(env,'/api/config');assert.equal(config.data.plans.find(p=>p.id==='monthly').fee,130000);
 const registration=await call(env,'/api/register',{body:{...memberInput,trainer:true}});assert.equal(registration.data.member.total,185000);
});
test('delayed payment starts full daily validity only after the remaining balance is paid',async()=>{
 const env=fixture(),cookie=await login(env);
 const r=await call(env,'/api/register',{body:{...memberInput,plan:'daily'}}),memberId=r.data.member.id;
 env.DB.sqlite.prepare('UPDATE members SET expires_at=? WHERE id=?').run('2020-01-01T00:00:00.000Z',memberId);
 assert.equal((await mutation(env,'/api/admin/renew',cookie,{member_id:memberId,plan:'daily',trainer:false})).status,400);
 const partial=await mutation(env,'/api/admin/payment',cookie,{member_id:memberId,amount:5000,method:'Cash',reference:'PART-1'});assert.equal(partial.data.member.status,'pending');assert.equal(partial.data.member.activated_at,null);
 const paid=await mutation(env,'/api/admin/payment',cookie,{member_id:memberId,amount:5000,method:'Cash',reference:'PART-2'});assert.equal(paid.data.member.status,'active');assert.ok(new Date(paid.data.member.expires_at).getTime()>Date.now()+23*3600000);assert.ok(paid.data.member.activated_at);
});
