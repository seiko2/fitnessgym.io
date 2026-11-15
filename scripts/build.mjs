import { readdir, readFile, writeFile, mkdir, rm, copyFile, cp, access } from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd();
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.ico':'image/x-icon','.txt':'text/plain; charset=utf-8','.zip':'application/zip'};
const assets={};
async function walk(dir){
 for(const ent of await readdir(dir,{withFileTypes:true})){
  const filename=path.join(dir,ent.name);
  if(ent.isDirectory()) await walk(filename);
  else {
   const key='/'+path.relative(path.join(root,'public'),filename).split(path.sep).join('/');
   assets[key]={type:types[path.extname(filename)]||'application/octet-stream',data:(await readFile(filename)).toString('base64')};
  }
 }
}
await walk(path.join(root,'public'));
for(const file of ['/index.html','/admin.html','/staff.html','/app.js','/admin.js','/staff.js','/styles.css','/admin.css','/staff.css','/config.js','/qr.js','/assets/hero.jpg']) if(!assets[file]) throw new Error('Missing required asset '+file);
await rm('dist',{recursive:true,force:true});
await mkdir('dist/server',{recursive:true});
await mkdir('dist/.openai',{recursive:true});
await writeFile('dist/server/assets.generated.js','export const assets='+JSON.stringify(assets)+';\n');
for(const filename of await readdir('src')) if(filename.endsWith('.js') && filename!=='assets.generated.js') await copyFile('src/'+filename,'dist/server/'+filename);
await copyFile('src/worker.js','dist/server/index.js');
let hasHostingManifest=false;
try{await access('.openai/hosting.json');hasHostingManifest=true;}catch{}
if(hasHostingManifest) await copyFile('.openai/hosting.json','dist/.openai/hosting.json');
await cp('drizzle','dist/drizzle',{recursive:true});
if(hasHostingManifest){const manifest=JSON.parse(await readFile('.openai/hosting.json','utf8'));if(!manifest.project_id) throw new Error('Site identity missing');}
console.log('Built Worker with '+Object.keys(assets).length+' local assets.');
