import { handleApi } from './api.js';
import { assets } from './assets.generated.js';

const security = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://images.unsplash.com; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com https://*.chatgpt.site",
};

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const origin=request.headers.get('origin');
      const publicApi=url.pathname==='/api/config'||url.pathname==='/api/verify'||url.pathname==='/api/register'||url.pathname.startsWith('/api/member');
      const allowedOrigin=origin&&publicApi&&String(env.PUBLIC_ORIGINS||'').split(',').map(s=>s.trim()).includes(origin);
      let response;
      if(request.method==='OPTIONS'&&url.pathname.startsWith('/api/')){
        response=allowedOrigin?new Response(null,{status:204}):new Response('Origin not allowed',{status:403});
      } else if (url.pathname.startsWith('/api/')) {
        response = await handleApi(request, env);
        if (!response) response = Response.json({error:'Endpoint not found.'},{status:404});
      } else if (!['GET','HEAD'].includes(request.method)) {
        response = new Response('Method not allowed',{status:405});
      } else {
        let path = url.pathname;
        if (path === '/' || path === '/verify') path = '/index.html';
        if (path === '/admin' || path === '/admin/') path = '/admin.html';
        if (path === '/staff' || path === '/staff/') path = '/staff.html';
        const asset = assets[path];
        if (!asset) response = new Response('Page not found',{status:404});
        else {
          const bytes = Uint8Array.from(atob(asset.data),c=>c.charCodeAt(0));
          response = new Response(request.method === 'HEAD' ? null : bytes, {headers:{'Content-Type':asset.type,'Cache-Control': path.endsWith('.html') ? 'no-cache' : 'public, max-age=3600'}});
          if(path.endsWith('.zip'))response.headers.set('Content-Disposition','attachment; filename="elite-fitness-gym-kampala-source.zip"');
        }
      }
      const final = new Response(response.body,response);
      for(const [key,value] of Object.entries(security)) final.headers.set(key,value);
      if(url.pathname.startsWith('/api/')) final.headers.set('Cache-Control','no-store');
      if(allowedOrigin){final.headers.set('Access-Control-Allow-Origin',origin);final.headers.set('Vary','Origin');final.headers.set('Access-Control-Allow-Methods','GET, POST, OPTIONS');final.headers.set('Access-Control-Allow-Headers','Content-Type, Authorization, X-Requested-With');final.headers.set('Access-Control-Max-Age','600');}
      return final;
    } catch(error) {
      console.error('request_failed',error?.message);
      return Response.json({error:'Unable to complete this request. Please try again.'},{status:500,headers:{...security,'Cache-Control':'no-store'}});
    }
  }
};
