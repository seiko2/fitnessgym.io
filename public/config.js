/* For GitHub Pages, set this to the HTTPS origin of your deployed Worker backend. */
window.ELITE_API_BASE = window.ELITE_API_BASE || '';
(() => {
 'use strict';
 const raw=String(window.ELITE_API_BASE||'').trim().replace(/\/+$/,'');
 let base='';
 if(raw){try{const u=new URL(raw);if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))throw new Error();base=u.origin;}catch{console.error('Set ELITE_API_BASE to a valid HTTPS backend origin.');}}
 const pages=Boolean(window.ELITE_PAGES_BUILD)||location.hostname.endsWith('.github.io');
 function apiUrl(path){if(pages&&!base)throw new Error('Membership services are not connected yet. Please contact the gym to register or book.');return base+path;}
 function assetUrl(path){return base&&/^\/assets\//.test(String(path))?base+path:path;}
 function verifyUrl(code){return (base||location.origin)+'/verify?code='+encodeURIComponent(code);}
 window.EliteGym=Object.freeze({apiBase:base,apiUrl,assetUrl,verifyUrl,pages});
 document.addEventListener('DOMContentLoaded',()=>{
  if(base&&base!==location.origin){
   document.querySelectorAll('a[href="/admin"],a[href="/staff"],a[href="./admin/"],a[href="./staff/"],a[data-backend-route]').forEach(a=>{const route=a.dataset.backendRoute||(a.getAttribute('href').includes('admin')?'/admin':'/staff');a.href=base+route;});
  }
  if(pages&&!base){const notice=document.createElement('div');notice.className='site-announcement';notice.setAttribute('role','status');notice.textContent='Membership services are being connected. Contact the gym on WhatsApp for registration and bookings.';document.querySelector('.site-header')?.insertAdjacentElement('afterend',notice);}
 });
})();
