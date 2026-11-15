import {cp, mkdir, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const destination = path.resolve(process.argv[2] || path.join(root, 'exports', 'elite-fitness-gym-kampala'));
if (destination === root || root.startsWith(destination + path.sep) || destination === path.parse(destination).root) throw new Error('Choose a separate export folder.');
const marker = '.elite-export-version';
async function exists(filename) {try {await stat(filename);return true;} catch (error) {if (error.code === 'ENOENT')return false;throw error;}}
if (await exists(destination) && !(await exists(path.join(destination, marker)))) throw new Error('The export folder already exists and was not created by this helper. Choose an empty/new folder.');
for (const filename of ['public/index.html','public/app.js','public/styles.css','public/config.js','public/admin.html','public/admin.js','public/admin.css','public/staff.html','public/staff.js','public/staff.css','src/api.js','src/hr-api.js','scripts/build.mjs','GITHUB-DEPLOYMENT.md']) {
  if (!(await exists(path.join(root, filename)))) throw new Error('Complete the application before exporting: missing ' + filename);
}
await rm(destination, {recursive:true,force:true});
await mkdir(destination, {recursive:true});
await writeFile(path.join(destination, marker), '1\n');

function include(filename) {
  const relative = path.relative(root, filename);
  const parts = relative.split(path.sep);
  if (parts.some(p => ['.git','.openai','node_modules','dist','.wrangler','.sites-runtime','outputs','exports'].includes(p))) return false;
  const basename = path.basename(filename);
  if (/^\.env/.test(basename) && basename !== '.env.example') return false;
  if (/^\.dev\.vars/.test(basename) || /\.(sqlite|sqlite3|db|tar\.gz|zip)$/.test(basename)) return false;
  if (basename === 'assets.generated.js') return false;
  return true;
}
for (const entry of ['public','src','scripts','drizzle','reference','tests','.github','ASSET-SOURCES.md','GITHUB-DEPLOYMENT.md','wrangler.jsonc.example','.env.example']) {
  const source = path.join(root, entry);
  if (await exists(source)) await cp(source, path.join(destination, entry), {recursive:true,filter:include,dereference:false});
}

const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
packageJson.engines = {...packageJson.engines,node:'>=24'};
packageJson.scripts = {...packageJson.scripts,'export:github':'node scripts/export-github.mjs'};
await writeFile(path.join(destination, 'package.json'), JSON.stringify(packageJson, null, 2) + '\n');
let ignore = await exists(path.join(root, '.gitignore')) ? await readFile(path.join(root, '.gitignore'), 'utf8') : '';
ignore += '\n# Keep the empty configuration example, never actual secrets.\n!.env.example\nexports/\n.elite-export-version\n';
await writeFile(path.join(destination, '.gitignore'), ignore);
if (await exists(path.join(root, 'README.md'))) await cp(path.join(root, 'README.md'), path.join(destination, 'PROJECT-NOTES.md'));
await writeFile(path.join(destination, 'README.md'), [
  '# Elite Fitness Gym Kampala',
  '',
  'Complete source package for the public gym website, member portal, staff ERP workspace, and administrator dashboard.',
  '',
  '**Start with [GITHUB-DEPLOYMENT.md](GITHUB-DEPLOYMENT.md)** for the upload and backend setup instructions for `seiko2`.',
  '',
  "- Upload this folder's contents to a GitHub repository, including `.github/`.",
  '- GitHub Pages publishes the prepared `docs/` marketing and member frontend.',
  '- Deploy the included Worker and D1 migrations for registration, login, HR, payroll, reviews, and accounting.',
  '- Set your backend origin in `docs/config.js`; its initial value is deliberately blank.',
  '- No live member/staff records, passwords, private Sites identity, or runtime secrets are included.',
  '',
  'Run `npm test` and `npm run build` with Node.js 24 or later. Further application notes are in [PROJECT-NOTES.md](PROJECT-NOTES.md).',
  ''
].join('\n'));

const docs = path.join(destination, 'docs');
await mkdir(docs, {recursive:true});
const excludedPublic = /^(?:admin|staff)\.(?:html|css|js)$/;
for (const entry of await readdir(path.join(root, 'public'), {withFileTypes:true})) {
  if (excludedPublic.test(entry.name)) continue;
  await cp(path.join(root, 'public', entry.name), path.join(docs, entry.name), {recursive:true,filter:include,dereference:false});
}

async function rewritePages(dir) {
  for (const entry of await readdir(dir,{withFileTypes:true})) {
    const filename = path.join(dir,entry.name);
    if (entry.isDirectory()) {await rewritePages(filename);continue;}
    if (!/\.(html|css|js)$/.test(entry.name) || entry.name === 'qr.js') continue;
    let value = await readFile(filename,'utf8');
    if (entry.name.endsWith('.html')) {
      value = value.replace(/\b(src|href)="\/(?!\/)([^"]*)"/g,(_m,attribute,target)=>{
        if (attribute === 'href' && ['admin','admin/','staff','staff/'].includes(target)) return `${attribute}="./${target.replace(/\/$/,'')}/"`;
        return `${attribute}="./${target}"`;
      });
    }
    value = value.replace(/(["'`])\/assets\//g,'$1./assets/').replace(/url\(\/(?!\/)/g,'url(./');
    await writeFile(filename,value);
  }
}
await rewritePages(docs);
const originalConfig = await readFile(path.join(docs, 'config.js'), 'utf8');
await writeFile(path.join(docs, 'config.js'), `/* GitHub Pages: set this to your deployed HTTPS backend origin, without /api. */\nwindow.ELITE_PAGES_BUILD = true;\nwindow.ELITE_API_BASE = '';\n\n${originalConfig}`);
await writeFile(path.join(docs,'.nojekyll'),'');

const workspaceBridge = route => `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${route === 'admin' ? 'Admin' : 'Staff'} workspace · Elite Fitness Gym Kampala</title><link rel="stylesheet" href="../styles.css"><script src="../config.js" defer></script><script src="../backend-redirect.js" defer></script></head><body data-workspace="${route}"><main class="verify-page"><section class="verify-box"><span class="section-kicker">ELITE FITNESS GYM KAMPALA</span><h1>YOUR<br>WORKSPACE.</h1><p id="workspace-message">Opening your secure workspace…</p><a class="text-link" href="../index.html">Return to the gym website ↗</a></section></main></body></html>\n`;
for (const route of ['admin','staff']) {await mkdir(path.join(docs,route),{recursive:true});await writeFile(path.join(docs,route,'index.html'),workspaceBridge(route));}
await writeFile(path.join(docs,'backend-redirect.js'), `(() => {\n  const base = String(window.ELITE_API_BASE || '').replace(/\\/$/, '');\n  const route = document.body.dataset.workspace;\n  try {\n    const url = new URL(base);\n    if (url.protocol !== 'https:') throw new Error('HTTPS is required.');\n    location.replace(url.origin + '/' + (route === 'staff' ? 'staff' : 'admin'));\n  } catch (_) {\n    document.getElementById('workspace-message').textContent = 'The secure workspace is not connected to this website yet. Please contact the gym administrator.';\n  }\n})();\n`);
await mkdir(path.join(docs,'verify'),{recursive:true});
await writeFile(path.join(docs,'verify','index.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Membership verification · Elite Fitness</title><script src="../verify-redirect.js" defer></script></head><body><p>Opening membership verification…</p></body></html>\n');
await writeFile(path.join(docs,'verify-redirect.js'), `const query = new URLSearchParams(location.search);\nquery.set('verify', '1');\nlocation.replace('../index.html?' + query.toString());\n`);

const textExtensions = /\.(?:js|mjs|json|jsonc|html|css|md|txt|yml|yaml|sql|py)$/;
let count = 0;
async function verifyExport(dir) {
  for (const entry of await readdir(dir,{withFileTypes:true})) {
    const filename=path.join(dir,entry.name);
    if (entry.isSymbolicLink()) throw new Error('Symlinks are not allowed in the export: '+filename);
    if (entry.isDirectory()) {await verifyExport(filename);continue;}
    count++;
    if (textExtensions.test(entry.name)) {
      const value=await readFile(filename,'utf8');
      if (/appgprj_[A-Za-z0-9]{8,}/.test(value)) throw new Error('Private Site identity was found in '+filename);
    }
  }
}
await verifyExport(destination);
async function verifyPagesLinks(dir) {
  for (const entry of await readdir(dir,{withFileTypes:true})) {
    const filename=path.join(dir,entry.name);
    if (entry.isDirectory()) {await verifyPagesLinks(filename);continue;}
    if (!entry.name.endsWith('.html')) continue;
    const html=await readFile(filename,'utf8');
    for (const match of html.matchAll(/\b(?:src|href)="((?:\.\/|\.\.\/)[^"]*)"/g)) {
      const link=match[1].split(/[?#]/)[0];
      const target=path.resolve(path.dirname(filename),link);
      if (!(target === docs || target.startsWith(docs + path.sep)) || !(await exists(target))) throw new Error('Missing Pages asset or route: '+match[1]+' in '+filename);
    }
  }
}
await verifyPagesLinks(docs);
console.log(JSON.stringify({folder:destination,files:count,pages:path.join(destination,'docs'),api_origin:'Configure docs/config.js before accepting memberships.'}));
