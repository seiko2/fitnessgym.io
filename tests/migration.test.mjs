import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
const initial=await readFile(new URL('../drizzle/0000_init.sql',import.meta.url),'utf8');
const upgrade=await readFile(new URL('../drizzle/0001_erp.sql',import.meta.url),'utf8');
test('ERP migration preserves existing members, receipts, charges and foreign keys',()=>{
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON;'+initial);
 db.prepare('INSERT INTO members (id,name,email,phone,age,plan,trainer,fee,trainer_fee,total,joined_at,expires_at,status,consent_at,portal_token_hash,card_code,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('EFK-EXISTING','Existing Member','existing@example.com','+256700000000',30,'monthly',0,120000,0,120000,'2026-11-01T08:00:00.000Z','2026-12-01T08:00:00.000Z','active','2026-11-01T08:00:00.000Z','existing-token-hash','existing-public-code','2026-11-01T08:00:00.000Z');
 db.exec("INSERT INTO charges VALUES ('c1','EFK-EXISTING',120000,'monthly',0,'Initial membership','2026-11-01T08:00:00.000Z'); INSERT INTO payments VALUES ('p1','EFK-EXISTING',120000,'Cash','PAY-OLD','','dedup-old','2026-11-01T08:00:00.000Z');");
 db.exec('BEGIN;'+upgrade+'COMMIT;');
 assert.equal(db.prepare('SELECT name FROM members WHERE id=?').get('EFK-EXISTING').name,'Existing Member');
 assert.equal(db.prepare('SELECT SUM(amount) total FROM payments').get().total,120000);
 assert.equal(db.prepare('SELECT COUNT(*) total FROM charges').get().total,1);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 assert.throws(()=>db.exec("INSERT INTO charges VALUES ('invalid','NO-SUCH-MEMBER',10,'daily',0,'Invalid foreign key','2026-11-01T08:00:00.000Z');"),/FOREIGN KEY/);
 assert.equal(db.prepare('SELECT sql FROM sqlite_master WHERE name=?').get('members').sql.includes('age >= 12'),true);
 db.close();
});
