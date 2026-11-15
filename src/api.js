import {handleHrApi} from './hr-api.js';
const DEFAULT_PLANS = [
 {id:'daily',name:'Daily',fee:10000,trainer_fee:15000,days:1},
 {id:'monthly',name:'Monthly',fee:120000,trainer_fee:50000,days:30},
 {id:'quarterly',name:'Quarterly',fee:300000,trainer_fee:150000,days:90},
 {id:'annual',name:'Annual',fee:1000000,trainer_fee:600000,days:365},
];
const DEFAULT_SETTINGS={gym_name:'Elite Fitness Gym Kampala',hours:'08:00–00:00 · Kampala time',email:'kulabiraho@gmail.com',phone:'+256778676138',announcement:''};
const DEFAULT_TRAINERS=[
 {id:'strength',name:'Strength coaching',specialty:'Strength & technique',bio:'Build your foundation with guided strength training. Ask our team about trainer availability.',image:'/assets/trainer-strength.jpg',active:1,illustrative:true},
 {id:'conditioning',name:'Conditioning coaching',specialty:'Cardio & conditioning',bio:'Find a sustainable pace and train towards your fitness goals.',image:'/assets/trainer-conditioning.jpg',active:1,illustrative:true},
 {id:'mobility',name:'Mobility coaching',specialty:'Movement & mobility',bio:'Explore guided movement and develop confidence in your training.',image:'/assets/trainer-mobility.jpg',active:1,illustrative:true},
];
const encoder=new TextEncoder();
class ApiError extends Error{constructor(message,status=400){super(message);this.status=status;}}
const bad=(message,status=400)=>{throw new ApiError(message,status);};
const now=()=>new Date().toISOString();
const id=(prefix)=>prefix+'-'+crypto.randomUUID();
const hex=(bytes)=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
const token=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
const sha=async(value)=>hex(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
const all=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results||[];
const first=async(db,sql,...args)=>await db.prepare(sql).bind(...args).first();
const run=(db,sql,...args)=>db.prepare(sql).bind(...args);
function text(value,label,max=160,required=true){const s=typeof value==='string'?value.trim():'';if((required&&!s)||s.length>max)bad('Please enter a valid '+label+'.');return s;}
function integer(value,label,min=0,max=100000000){const n=typeof value==='number'?value:Number(value);if(!Number.isSafeInteger(n)||n<min||n>max)bad('Please enter a valid '+label+'.');return n;}
function email(value){const s=text(value,'email',254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))bad('Please enter a valid email address.');return s;}
function phone(value){const s=text(value,'phone number',24);if(!/^\+?[\d\s()-]{7,24}$/.test(s))bad('Please enter a valid phone number.');return s;}
function bool(value){return value===true||value===1||value==='1';}
function activeStatus(member){return member.status==='active'&&member.expires_at<=now()?'expired':member.status;}
function memberView(member){if(!member)return null;const {portal_token_hash,consent_at,...safe}=member;return {...safe,trainer:!!member.trainer,status:activeStatus(member),balance:Math.max(0,(member.charge_total??member.total)-(member.total_paid||0))};}
const memberSelect=`SELECT m.*,COALESCE((SELECT SUM(amount) FROM charges c WHERE c.member_id=m.id),m.total) charge_total,COALESCE((SELECT SUM(amount) FROM payments p WHERE p.member_id=m.id),0) total_paid FROM members m`;
async function readBody(request){if(Number(request.headers.get('content-length'))>16000)bad('Request too large.',413);const raw=await request.text();if(raw.length>16000)bad('Request too large.',413);try{const b=JSON.parse(raw);if(!b||typeof b!=='object'||Array.isArray(b))bad('Invalid request.');return b;}catch(e){if(e instanceof ApiError)throw e;bad('Please send valid JSON.');}}
function audit(db,action,detail,actor='seiko'){return run(db,'INSERT INTO activity (id,action,detail,actor,created_at) VALUES (?,?,?,?,?)',id('evt'),action,detail,actor,now());}
async function plans(db){const rows=await all(db,'SELECT * FROM plans');return DEFAULT_PLANS.map(p=>rows.find(r=>r.id===p.id)||p);}
async function settings(db){const rows=await all(db,'SELECT key,value FROM settings');return {...DEFAULT_SETTINGS,...Object.fromEntries(rows.map(x=>[x.key,x.value]))};}
async function classes(db,includeInactive=false){return all(db,`SELECT c.*,(SELECT COUNT(*) FROM bookings b WHERE b.class_id=c.id) booked FROM classes c ${includeInactive?'':'WHERE c.active=1'} ORDER BY c.day,c.time`);}
async function trainers(db,includeInactive=false){const rows=await all(db,'SELECT * FROM trainers ORDER BY name');return rows.length?(includeInactive?rows:rows.filter(r=>r.active===1)):DEFAULT_TRAINERS;}
async function getMember(db,memberId){return first(db,memberSelect+' WHERE m.id=?',memberId);}
async function requireMember(request,db){const t=request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/i)?.[1];if(!t)bad('Open your member portal using the access saved after registration.',401);const member=await first(db,memberSelect+' WHERE m.portal_token_hash=?',await sha(t));if(!member)bad('Your member access is invalid. Please contact the gym.',401);return member;}
async function requireAdmin(request,db){const t=request.headers.get('cookie')?.match(/(?:^|;\s*)__Host-elite_admin=([a-f0-9]{64})(?:;|$)/)?.[1];if(!t)bad('Please sign in to the admin panel.',401);const session=await first(db,'SELECT * FROM admin_sessions WHERE token_hash=? AND expires_at>?',await sha(t),now());if(!session)bad('Your session has expired. Please sign in again.',401);return session;}
async function rate(db,key,limit,seconds){const stamp=Date.now();await run(db,'INSERT INTO rate_limits (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.expires_at<? THEN 1 ELSE rate_limits.count+1 END,expires_at=CASE WHEN rate_limits.expires_at<? THEN excluded.expires_at ELSE rate_limits.expires_at END',key,stamp+seconds*1000,stamp,stamp).run();const r=await first(db,'SELECT count FROM rate_limits WHERE key=?',key);if(r.count>limit)bad('Too many attempts. Please wait and try again.',429);}
export async function verifyPassword(password,encoded){try{const [kind,iterations,salt,expected]=encoded.split('$');if(kind!=='pbkdf2_sha256'||!/^\d+$/.test(iterations)||!/^([a-f0-9]{2})+$/.test(salt)||!/^([a-f0-9]{2}){32}$/.test(expected))return false;const count=Number(iterations);if(count<10000||count>1000000)return false;const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);const derived=hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:Uint8Array.from(salt.match(/../g),v=>parseInt(v,16)),iterations:count,hash:'SHA-256'},key,256));let mismatch=0;for(let n=0;n<expected.length;n++)mismatch|=derived.charCodeAt(n)^expected.charCodeAt(n);return mismatch===0;}catch{return false;}}
export async function hashPassword(password){const salt=crypto.getRandomValues(new Uint8Array(16));const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);const derived=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:100000,hash:'SHA-256'},key,256);return 'pbkdf2_sha256$100000$'+hex(salt)+'$'+hex(derived);}
function adminCookie(value,maxAge){return `__Host-elite_admin=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;}
function assertOrigin(request,env){const url=new URL(request.url),origin=request.headers.get('origin');const publicEndpoint=url.pathname==='/api/register'||url.pathname.startsWith('/api/member');const approved=publicEndpoint&&String(env.PUBLIC_ORIGINS||'').split(',').map(s=>s.trim()).includes(origin);if(origin&&origin!==url.origin&&!approved)bad('This request is not allowed.',403);if(request.headers.get('sec-fetch-site')==='cross-site'&&!approved)bad('This request is not allowed.',403);}
function planId(value){const s=text(value,'membership plan',20);if(!DEFAULT_PLANS.some(p=>p.id===s))bad('Please select a valid membership plan.');return s;}
function health(b,age=18){const weight=Number(b.weight),height=Number(b.height);if(b.weight==null||b.height==null||b.weight===''||b.height===''||!Number.isFinite(weight)||!Number.isFinite(height)||weight<20||weight>400||height<0.8||height>2.5)bad('Enter your weight in kilograms and height in metres. Both measurements are required.');const bmi=age<18?null:Math.round(weight/(height*height)*10)/10;const program=age<18?'Discuss age-appropriate goals with your guardian and a qualified coach':bmi<18.5?'Strength & nutrition':bmi<25?'General fitness':bmi<30?'Cardio & conditioning':'Guided fitness support';return {weight,height,bmi,program};}
const hrHelpers={all,first,run,audit,text,integer,email,phone,sha,token,id,now,verifyPassword,hashPassword,rate,bad};
export async function handleApi(request,env){
 try{
  const url=new URL(request.url),path=url.pathname,method=request.method;
  if(!env.DB)bad('The member database is not connected. Please contact the gym.',503);
  const db=env.DB;
  if(!['GET','POST'].includes(method))bad('Method not allowed.',405);
  if(method==='POST')assertOrigin(request,env);
  if(path.startsWith('/api/staff/')){
   if(method==='POST'&&path!=='/api/staff/login'&&request.headers.get('X-Requested-With')!=='EliteGym')bad('This request is not allowed.',403);
   const result=await handleHrApi(request,env,{db,b:method==='POST'?await readBody(request):{},admin:false,helpers:hrHelpers});if(result)return result;bad('Endpoint not found.',404);
  }
  if(path==='/api/config'&&method==='GET')return Response.json({plans:await plans(db),classes:await classes(db),trainers:await trainers(db),settings:await settings(db)});
  if(path==='/api/verify'&&method==='GET'){
   const code=text(url.searchParams.get('code'),'card code',100);
   const m=await first(db,'SELECT name,plan,status,expires_at FROM members WHERE card_code=?',code);
   if(!m)return Response.json({valid:false});
   return Response.json({valid:true,name:m.name,plan:m.plan,status:activeStatus(m),expires_at:m.expires_at});
  }
  if(path==='/api/register'&&method==='POST'){
   await rate(db,'register:'+await sha(request.headers.get('cf-connecting-ip')||'unknown'),15,3600);
   const b=await readBody(request),name=text(b.name,'full name',100),age=integer(b.age,'age',12,100),mail=age<18&&!b.email?null:email(b.email),tel=phone(b.phone),plan=planId(b.plan),trainer=bool(b.trainer);
   if(b.consent!==true)bad('Please accept the registration terms and privacy notice.');
   const h=health(b,age),p=(await plans(db)).find(x=>x.id===plan),stamp=now(),expires=new Date(Date.now()+p.days*86400000).toISOString(),memberId='EFK-'+token().slice(0,12).toUpperCase(),cardToken=token(),cardCode=token().slice(0,32),total=p.fee+(trainer?p.trainer_fee:0);
   let parentName=null,parentPhone=null,parentEmail=null,parentRelationship=null,parentConsentAt=null;
   if(age<18){parentName=text(b.parent_name,'parent or guardian name',100);parentPhone=phone(b.parent_phone);parentEmail=email(b.parent_email);parentRelationship=text(b.parent_relationship,'relationship to the member',80);if(b.parent_consent!==true)bad('A parent or legal guardian must represent and consent for members aged 12–17.');parentConsentAt=stamp;}
   await db.batch([
    run(db,'INSERT INTO members (id,name,email,phone,age,plan,trainer,fee,trainer_fee,total,joined_at,expires_at,duration_days,status,weight,height,bmi,program,consent_at,parent_name,parent_phone,parent_email,parent_relationship,parent_consent_at,portal_token_hash,card_code,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',memberId,name,mail,tel,age,plan,trainer?1:0,p.fee,trainer?p.trainer_fee:0,total,stamp,expires,p.days,'pending',h.weight,h.height,h.bmi,h.program,stamp,parentName,parentPhone,parentEmail,parentRelationship,parentConsentAt,await sha(cardToken),cardCode,stamp),
    run(db,'INSERT INTO charges (id,member_id,amount,plan,trainer,description,created_at) VALUES (?,?,?,?,?,?,?)',id('chg'),memberId,total,plan,trainer?1:0,'Initial membership',stamp),
    run(db,'INSERT INTO member_progress (id,member_id,recorded_at,weight,height,note) VALUES (?,?,?,?,?,?)',id('progress'),memberId,stamp,h.weight,h.height,'Initial registration measurement'),
    audit(db,'registration',memberId+' registered for '+p.name+(trainer?' with trainer':''),'member'),
   ]);
   return Response.json({member:memberView(await getMember(db,memberId)),card_token:cardToken},{status:201});
  }
  if(path.startsWith('/api/member')){
   const m=await requireMember(request,db);
   if(path==='/api/member'&&method==='GET')return Response.json({member:memberView(m),payments:await all(db,'SELECT id,amount,method,reference,created_at FROM payments WHERE member_id=? ORDER BY created_at DESC',m.id),bookings:await all(db,'SELECT b.id,b.class_id,b.created_at,c.title,c.day,c.time,c.duration,c.trainer,c.active FROM bookings b JOIN classes c ON c.id=b.class_id WHERE b.member_id=?',m.id),classes:await classes(db),sessions:await all(db,'SELECT s.*,s.starts_at started_at,st.name staff_name,sm.attended,EXISTS(SELECT 1 FROM staff_reviews r WHERE r.session_id=s.id AND r.member_id=?) reviewed FROM training_sessions s JOIN staff st ON st.id=s.staff_id JOIN session_members sm ON sm.session_id=s.id WHERE sm.member_id=? ORDER BY s.starts_at DESC',m.id,m.id),reviews:await all(db,'SELECT r.*,st.name staff_name FROM staff_reviews r JOIN staff st ON st.id=r.staff_id WHERE r.member_id=? ORDER BY r.created_at DESC',m.id),progress:await all(db,'SELECT id,recorded_at,weight,height,note FROM member_progress WHERE member_id=? ORDER BY recorded_at DESC',m.id),attendance:await all(db,'SELECT id,visit_day,created_at FROM attendance WHERE member_id=? ORDER BY created_at DESC',m.id)});
   const b=await readBody(request);
   if(path==='/api/member/review'&&method==='POST'){
    const sessionId=text(b.session_id,'session ID',100),rating=integer(b.rating,'rating',1,5),comment=text(b.comment??'','review comment',1000,false);const s=await first(db,"SELECT s.id,s.staff_id FROM training_sessions s JOIN session_members sm ON sm.session_id=s.id WHERE s.id=? AND sm.member_id=? AND sm.attended=1 AND s.status='completed' AND s.ended_at IS NOT NULL",sessionId,m.id);if(!s)bad('Reviews are available only after a completed session that you attended.',403);
    await db.batch([run(db,'INSERT INTO staff_reviews (id,session_id,member_id,staff_id,rating,comment,created_at) VALUES (?,?,?,?,?,?,?)',id('review'),s.id,m.id,s.staff_id,rating,comment,now()),audit(db,'staff_review_submitted',m.id+' reviewed session '+s.id,'member')]);return Response.json({ok:true});
   }
   if(path==='/api/member/progress'&&method==='POST'){
    const h=health(b,m.age),note=text(b.note??'','progress note',500,false),stamp=now();await db.batch([run(db,'INSERT INTO member_progress (id,member_id,recorded_at,weight,height,note) VALUES (?,?,?,?,?,?)',id('progress'),m.id,stamp,h.weight,h.height,note),run(db,'UPDATE members SET weight=?,height=?,bmi=?,program=?,updated_at=? WHERE id=?',h.weight,h.height,h.bmi,h.program,stamp,m.id),audit(db,'member_progress_recorded',m.id+' recorded measurements','member')]);return Response.json({ok:true});
   }
   if(path==='/api/member/book'&&method==='POST'){
    if(activeStatus(m)!=='active')bad('An active membership is needed to book a class. Please contact the gym.');
    const classId=text(b.class_id,'class',100),c=await first(db,'SELECT * FROM classes WHERE id=? AND active=1',classId);if(!c)bad('This class is no longer available.',404);
    const r=await run(db,'INSERT INTO bookings (id,member_id,class_id,created_at) SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM bookings WHERE class_id=?) < ? AND NOT EXISTS(SELECT 1 FROM bookings WHERE member_id=? AND class_id=?)',id('bkg'),m.id,classId,now(),classId,c.capacity,m.id,classId).run();
    if(!r.meta?.changes)bad('This class is full or you already have a booking.',409);
    await audit(db,'class_booking',m.id+' booked '+c.title,'member').run();return Response.json({ok:true});
   }
   if(path==='/api/member/cancel'&&method==='POST'){
    const bookingId=text(b.booking_id,'booking',100),r=await run(db,'DELETE FROM bookings WHERE id=? AND member_id=?',bookingId,m.id).run();if(!r.meta?.changes)bad('Booking not found.',404);await audit(db,'booking_cancelled',m.id+' cancelled '+bookingId,'member').run();return Response.json({ok:true});
   }
   bad('Endpoint not found.',404);
  }
  if(path==='/api/admin/login'&&method==='POST'){
   await rate(db,'login:'+await sha(request.headers.get('cf-connecting-ip')||'unknown'),8,900);
   const b=await readBody(request),username=text(b.username,'username',60),password=text(b.password,'password',200);
   if(!env.ADMIN_PASSWORD_HASH)bad('Admin credentials have not been configured.',503);
   const verified=await verifyPassword(password,env.ADMIN_PASSWORD_HASH);
   if(username!=='seiko'||!verified){await audit(db,'login_failed','Unsuccessful admin sign-in','anonymous').run();bad('Incorrect username or password.',401);}
   const t=token(),stamp=now(),expiry=new Date(Date.now()+8*3600000).toISOString();
   await db.batch([run(db,'DELETE FROM admin_sessions WHERE expires_at<?',stamp),run(db,'INSERT INTO admin_sessions (token_hash,expires_at,created_at) VALUES (?,?,?)',await sha(t),expiry,stamp),audit(db,'admin_login','Admin signed in')]);
   return Response.json({ok:true},{headers:{'Set-Cookie':adminCookie(t,28800)}});
  }
  if(path.startsWith('/api/admin/')){
   const session=await requireAdmin(request,db);
   if(method==='POST'&&request.headers.get('X-Requested-With')!=='EliteGym')bad('This request is not allowed.',403);
   if(path.startsWith('/api/admin/erp')){const result=await handleHrApi(request,env,{db,b:method==='POST'?await readBody(request):{},admin:true,session,helpers:hrHelpers});if(result)return result;bad('Endpoint not found.',404);}
   if(path==='/api/admin/data'&&method==='GET')return Response.json({members:(await all(db,memberSelect+' ORDER BY m.joined_at DESC')).map(memberView),payments:await all(db,'SELECT p.*,m.name FROM payments p JOIN members m ON m.id=p.member_id ORDER BY p.created_at DESC'),attendance:await all(db,'SELECT a.*,m.name FROM attendance a JOIN members m ON m.id=a.member_id ORDER BY a.created_at DESC'),activity:await all(db,'SELECT * FROM activity ORDER BY created_at DESC'),plans:await plans(db),classes:await classes(db,true),trainers:await trainers(db,true),settings:await settings(db)});
   if(path==='/api/admin/logout'&&method==='POST'){await db.batch([run(db,'DELETE FROM admin_sessions WHERE token_hash=?',session.token_hash),audit(db,'admin_logout','Admin signed out')]);return Response.json({ok:true},{headers:{'Set-Cookie':adminCookie('',0)}});}
   if(method!=='POST')bad('Endpoint not found.',404);
   const b=await readBody(request);
   if(path==='/api/admin/member'){
    const memberId=text(b.id,'member ID',100),m=await getMember(db,memberId);if(!m)bad('Member not found.',404);
    const name=text(b.name??m.name,'name',100),mail=m.age<18&&!(b.email??m.email)?null:email(b.email??m.email),tel=phone(b.phone??m.phone),status=b.status??m.status;if(!['pending','active','suspended'].includes(status))bad('Please select a valid membership status.');
    const activated=status==='active'&&!m.activated_at;
    await db.batch([run(db,'UPDATE members SET name=?,email=?,phone=?,status=?,activated_at=?,expires_at=?,updated_at=? WHERE id=?',name,mail,tel,status,activated?now():m.activated_at,activated?new Date(Date.now()+m.duration_days*86400000).toISOString():m.expires_at,now(),memberId),audit(db,'member_updated',memberId+' details updated; status '+status)]);return Response.json({ok:true,member:memberView(await getMember(db,memberId))});
   }
   if(path==='/api/admin/renew'){
    const memberId=text(b.member_id,'member ID',100),m=await getMember(db,memberId);if(!m)bad('Member not found.',404);if(!m.activated_at)bad('Activate the initial membership before adding a renewal.');const plan=planId(b.plan),p=(await plans(db)).find(x=>x.id===plan),trainer=bool(b.trainer),total=p.fee+(trainer?p.trainer_fee:0),expiry=new Date(Math.max(Date.now(),new Date(m.expires_at).getTime())+p.days*86400000).toISOString();
    await db.batch([run(db,'UPDATE members SET plan=?,trainer=?,fee=?,trainer_fee=?,total=?,duration_days=?,expires_at=?,status=?,updated_at=? WHERE id=?',plan,trainer?1:0,p.fee,trainer?p.trainer_fee:0,total,p.days,expiry,m.status==='suspended'?'suspended':'pending',now(),memberId),run(db,'INSERT INTO charges (id,member_id,amount,plan,trainer,description,created_at) VALUES (?,?,?,?,?,?,?)',id('chg'),memberId,total,plan,trainer?1:0,'Membership renewal',now()),audit(db,'membership_renewed',memberId+' renewed '+p.name)]);return Response.json({ok:true,member:memberView(await getMember(db,memberId))});
   }
   if(path==='/api/admin/payment'){
    const memberId=text(b.member_id,'member ID',100),m=await getMember(db,memberId);if(!m)bad('Member not found.',404);const amount=integer(b.amount,'amount',1,100000000);if(amount>m.charge_total-m.total_paid)bad('The payment exceeds the outstanding membership balance.');const method=text(b.method,'payment method',40),reference=text(b.reference??'','reference',100,false),note=text(b.note??'','payment note',300,false),stamp=now(),dedup=await sha([memberId,amount,method,reference||stamp.slice(0,16),note].join('|'));
    const paymentId=id('pay');
    const result=await db.batch([
     run(db,'INSERT INTO payments (id,member_id,amount,method,reference,note,dedup_key,created_at) SELECT ?,?,?,?,?,?,?,? WHERE ? <= (SELECT COALESCE(SUM(amount),0) FROM charges WHERE member_id=?) - (SELECT COALESCE(SUM(amount),0) FROM payments WHERE member_id=?)',paymentId,memberId,amount,method,reference,note,dedup,stamp,amount,memberId,memberId),
     run(db,"UPDATE members SET status=CASE WHEN status='suspended' THEN 'suspended' WHEN (SELECT COALESCE(SUM(amount),0) FROM payments WHERE member_id=members.id)>=(SELECT COALESCE(SUM(amount),0) FROM charges WHERE member_id=members.id) THEN 'active' ELSE status END,activated_at=CASE WHEN activated_at IS NULL AND (SELECT COALESCE(SUM(amount),0) FROM payments WHERE member_id=members.id)>=(SELECT COALESCE(SUM(amount),0) FROM charges WHERE member_id=members.id) THEN ? ELSE activated_at END,expires_at=CASE WHEN activated_at IS NULL AND (SELECT COALESCE(SUM(amount),0) FROM payments WHERE member_id=members.id)>=(SELECT COALESCE(SUM(amount),0) FROM charges WHERE member_id=members.id) THEN strftime('%Y-%m-%dT%H:%M:%fZ',?,'+' || duration_days || ' days') ELSE expires_at END,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM payments WHERE id=?)",stamp,stamp,stamp,memberId,paymentId),
     run(db,'INSERT INTO activity (id,action,detail,actor,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM payments WHERE id=?)',id('evt'),'payment_recorded',memberId+' paid UGX '+amount+' via '+method,'seiko',stamp,paymentId),
    ]);
    if(!result[0].meta?.changes)bad('The balance changed before this payment was saved. Refresh and try again.',409);
    return Response.json({ok:true,member:memberView(await getMember(db,memberId))});
   }
   if(path==='/api/admin/checkin'){
    const memberId=text(b.member_id,'member ID',100),m=await getMember(db,memberId);if(!m)bad('Member not found.',404);if(activeStatus(m)!=='active')bad('Only active, unexpired members can check in.');const visitDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Kampala',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());await db.batch([run(db,'INSERT INTO attendance (id,member_id,visit_day,created_at) VALUES (?,?,?,?)',id('visit'),memberId,visitDay,now()),audit(db,'member_checkin',memberId+' checked in')]);return Response.json({ok:true});
   }
   if(path==='/api/admin/class'){
    const classId=b.id?text(b.id,'class ID',100):id('class'),title=text(b.title,'class title',100),day=text(b.day,'day',20),time=text(b.time,'time',5),duration=integer(b.duration,'duration',15,240),capacity=integer(b.capacity,'capacity',1,500),trainer=text(b.trainer??'','trainer',100,false),active=b.active===undefined?1:bool(b.active)?1:0;
    if(!['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].includes(day))bad('Choose a valid day.');if(!/^(?:0[8-9]|1[0-9]|2[0-3]):[0-5][0-9]$/.test(time))bad('Choose a time between 08:00 and 23:59.');if(Number(time.slice(0,2))*60+Number(time.slice(3))+duration>1440)bad('Classes must finish by midnight.');const booked=await first(db,'SELECT COUNT(*) count FROM bookings WHERE class_id=?',classId);if(booked.count>capacity)bad('Capacity cannot be below the current booking count.');
    await db.batch([run(db,'INSERT INTO classes (id,title,day,time,duration,capacity,trainer,active) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,day=excluded.day,time=excluded.time,duration=excluded.duration,capacity=excluded.capacity,trainer=excluded.trainer,active=excluded.active',classId,title,day,time,duration,capacity,trainer,active),audit(db,'class_updated',title+' timetable updated')]);return Response.json({ok:true});
   }
   if(path==='/api/admin/trainer'){
    const trainerId=b.id?text(b.id,'trainer ID',100):id('trainer'),name=text(b.name,'trainer name',100),specialty=text(b.specialty,'specialty',100),bio=text(b.bio??'','trainer bio',600,false),image=text(b.image||'/assets/trainer-strength.jpg','image',300),active=b.active===undefined?1:bool(b.active)?1:0;if(!/^\/assets\/[a-zA-Z0-9._-]+\.(jpg|jpeg|webp|png)$/.test(image))bad('Choose one of the supplied local trainer images.');await db.batch([run(db,'INSERT INTO trainers (id,name,specialty,bio,image,active) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,specialty=excluded.specialty,bio=excluded.bio,image=excluded.image,active=excluded.active',trainerId,name,specialty,bio,image,active),audit(db,'trainer_updated',name+' trainer profile updated')]);return Response.json({ok:true});
   }
   if(path==='/api/admin/plan'){
    const plan=planId(b.id),p=DEFAULT_PLANS.find(x=>x.id===plan),fee=integer(b.fee,'membership fee',1,100000000),trainerFee=integer(b.trainer_fee,'trainer fee',0,100000000),days=integer(b.days,'membership length',1,730);await db.batch([run(db,'INSERT INTO plans (id,name,fee,trainer_fee,days) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET fee=excluded.fee,trainer_fee=excluded.trainer_fee,days=excluded.days',plan,p.name,fee,trainerFee,days),audit(db,'plan_updated',p.name+' fees and duration updated')]);return Response.json({ok:true});
   }
   if(path==='/api/admin/settings'){
    const values={gym_name:text(b.gym_name??DEFAULT_SETTINGS.gym_name,'gym name',100),hours:text(b.hours??DEFAULT_SETTINGS.hours,'hours',100),email:email(b.email??DEFAULT_SETTINGS.email),phone:phone(b.phone??DEFAULT_SETTINGS.phone),announcement:text(b.announcement??'','announcement',300,false)};await db.batch([...Object.entries(values).map(([k,v])=>run(db,'INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',k,v)),audit(db,'settings_updated','Gym contact and display settings updated')]);return Response.json({ok:true});
   }
   if(path==='/api/admin/export'){const kind=text(b.kind,'export type',30);if(!['members','payments','attendance','activity'].includes(kind))bad('Invalid export type.');await audit(db,'data_export',kind+' CSV exported').run();return Response.json({ok:true});}
   bad('Endpoint not found.',404);
  }
  bad('Endpoint not found.',404);
 }catch(error){
  if(error instanceof ApiError)return Response.json({error:error.message},{status:error.status});
  if(/UNIQUE constraint failed/.test(error?.message||''))return Response.json({error:/members.email/.test(error.message)?'This email is already registered. Open your saved member portal or contact the gym.':/attendance/.test(error.message)?'This member has already checked in today.':'This record already exists. Please check before submitting again.'},{status:409});
  console.error('api_failed',error?.message);return Response.json({error:'Unable to complete this request. Please try again.'},{status:500});
 }
}
