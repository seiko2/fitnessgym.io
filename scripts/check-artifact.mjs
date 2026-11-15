import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import worker from '../dist/server/index.js';
import {assets} from '../dist/server/assets.generated.js';
for(const [route,part] of [['/','FIND YOUR'],['/admin','STAFF ACCESS'],['/staff','staff'],['/verify?code=example','membership']]){
 const r=await worker.fetch(new Request('https://gym.example'+route),{});
 assert.equal(r.status,200);
 assert.match(r.headers.get('Content-Type'),/text\/html/);
 assert.match(r.headers.get('Content-Security-Policy'),/script-src 'self'/);
 assert.ok((await r.text()).toLowerCase().includes(part.toLowerCase()));
}
for(const [asset,info] of Object.entries(assets)){
 const r=await worker.fetch(new Request('https://gym.example'+asset),{});
 assert.equal(r.status,200,asset);
 assert.equal((await r.arrayBuffer()).byteLength,Buffer.from(info.data,'base64').length,asset);
}
assert.equal((await worker.fetch(new Request('https://gym.example/missing'),{})).status,404);
assert.equal((await worker.fetch(new Request('https://gym.example/api/config'),{})).status,503);
const corsRequest=new Request('https://gym.example/api/member',{method:'OPTIONS',headers:{Origin:'https://seiko2.github.io','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'Authorization, Content-Type'}});
let cors=await worker.fetch(corsRequest,{PUBLIC_ORIGINS:'https://seiko2.github.io'});
assert.equal(cors.status,204);assert.equal(cors.headers.get('Access-Control-Allow-Origin'),'https://seiko2.github.io');
cors=await worker.fetch(new Request('https://gym.example/api/admin/erp',{method:'OPTIONS',headers:{Origin:'https://seiko2.github.io'}}),{PUBLIC_ORIGINS:'https://seiko2.github.io'});
assert.equal(cors.status,403);assert.equal(cors.headers.get('Access-Control-Allow-Origin'),null);
for(const file of ['public/index.html','public/admin.html','public/staff.html']){
 const html=await readFile(file,'utf8');
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
 assert.equal(new Set(ids).size,ids.length,'Duplicate IDs in '+file);
 for(const m of html.matchAll(/\b(?:src|href)="(\/(?!\/)[^"?#]*)"/g)){
    if(['/','/admin','/staff','/verify'].includes(m[1]))continue;
  assert.ok(assets[m[1]],'Missing referenced asset '+m[1]);
 }
 assert.doesNotMatch(html,/\bon(?:click|error|load)=/i);
}
const qrContext=vm.createContext({});
vm.runInContext(await readFile('public/qr.js','utf8'),qrContext);
const qr=qrContext.qrcode(0,'M');qr.addData('https://gym.example/verify?code=0123456789abcdef0123456789abcdef');qr.make();assert.ok(qr.getModuleCount()>20);assert.match(qr.createSvgTag(),/<svg/);
console.log('Artifact checked: routes, assets, headers, HTML references and QR generation.');
