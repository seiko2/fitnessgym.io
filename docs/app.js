(() => {
  'use strict';
  const $ = (q, root = document) => root.querySelector(q);
  const $$ = (q, root = document) => [...root.querySelectorAll(q)];
  const money = n => 'UGX ' + Number(n || 0).toLocaleString('en-UG');
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date = v => { if (!v) return 'Pending'; const d = new Date(v); return Number.isNaN(d.getTime()) ? esc(v) : d.toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric',timeZone:'Africa/Kampala'}); };
  const statusText = s => ({pending:'Pending payment',pending_payment:'Pending payment',active:'Active',expired:'Expired',suspended:'Suspended'}[s] || String(s || 'Pending payment').replace(/_/g,' '));
  const statusTag = s => `<span class="status-tag ${esc(s || 'pending')}">${esc(statusText(s))}</span>`;
  const defaults = [
    {id:'daily',name:'Daily',fee:10000,trainer_fee:15000,days:1},
    {id:'monthly',name:'Monthly',fee:120000,trainer_fee:50000,days:30},
    {id:'quarterly',name:'Quarterly',fee:300000,trainer_fee:150000,days:90},
    {id:'annual',name:'Annual',fee:1000000,trainer_fee:600000,days:365}
  ];
  let config = {plans:defaults,classes:[],settings:{}}, step = 1, currentMember = null, currentPortal = null, returnFocus = null, toastTimer;
  let memberToken = '';
  try { memberToken = localStorage.getItem('elite_member_token') || ''; } catch (_) {}
  const params = new URLSearchParams(location.search);
  const privateParams = new URLSearchParams(location.hash.slice(1));
  if (privateParams.get('member') || params.get('member')) {
    memberToken = privateParams.get('member') || params.get('member');
    try { localStorage.setItem('elite_member_token', memberToken); } catch (_) {}
    params.delete('member');
    history.replaceState(null, '', location.pathname + (params.size ? '?' + params : '') + (privateParams.has('member') ? '' : location.hash));
  }
  const regDialog = $('#registration-dialog'), portalDialog = $('#portal-dialog'), form = $('#registration-form');
  async function api(path, options = {}) {
    const endpoint=window.EliteGym?window.EliteGym.apiUrl(path):path;
    const headers = {'Content-Type':'application/json',...(options.member && memberToken ? {'Authorization':'Bearer ' + memberToken} : {}),...options.headers};
    let response;
    try { response = await fetch(endpoint, {...options,headers}); } catch (_) { throw new Error('Unable to connect. Check your internet connection and try again.'); }
    let data;
    try { data = await response.json(); } catch (_) { throw new Error('The server could not complete this request. Please try again.'); }
    if (!response.ok) throw new Error(data.error || data.message || 'This request could not be completed. Please try again.');
    return data;
  }
  function notify(message) {
    const toast = $('#toast'); toast.textContent = message; toast.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 4200);
  }
  function showDialog(dialog) { returnFocus = document.activeElement; if (!dialog.open) dialog.showModal(); dialog.scrollTop = 0; }
  function closeDialog(dialog) { dialog.close(); returnFocus?.focus?.(); }
  $$('[data-close]').forEach(b => b.addEventListener('click', () => closeDialog(b.closest('dialog'))));
  $$('dialog').forEach(d => d.addEventListener('click', e => { if(e.target === d){ const r = d.getBoundingClientRect(); if(e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeDialog(d); } }));
  const menu = $('.menu-toggle'), nav = $('#main-nav');
  menu?.addEventListener('click', () => { const open = menu.getAttribute('aria-expanded') !== 'true'; menu.setAttribute('aria-expanded', String(open)); menu.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation'); nav.classList.toggle('open', open); });
  $$('a', nav).forEach(a => a.addEventListener('click', () => { nav.classList.remove('open'); menu.setAttribute('aria-expanded','false'); }));
  $('#year').textContent = new Date().getFullYear();
  const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => entries.forEach(e => { if(e.isIntersecting){ e.target.classList.add('visible'); observer.unobserve(e.target); } }), {threshold:.08}) : null;
  $$('.reveal').forEach(el => observer ? observer.observe(el) : el.classList.add('visible'));
  function planById(id) { return config.plans.find(p => p.id === id) || config.plans[1] || defaults[1]; }
  function selectedPlan() { return planById(form.elements.plan?.value || 'monthly'); }
  function renderRegPlans(selected = 'monthly') {
    $('#registration-plans').innerHTML = config.plans.map(p => `<label class="registration-plan"><input type="radio" name="plan" value="${esc(p.id)}" ${p.id === selected ? 'checked' : ''} required><strong>${esc(p.name).toUpperCase()}</strong><span>${money(p.fee)}</span><small>${esc(p.days)} ${Number(p.days)===1?'day':'days'}</small></label>`).join('');
    $$('input[name=plan]', form).forEach(i => i.addEventListener('change', updateTotal));
    updateTotal();
  }
  function updateTotal() {
    const p = selectedPlan(); $('#trainer-addon').textContent = money(p.trainer_fee);
    $('#registration-total').textContent = money(Number(p.fee) + (form.elements.trainer.checked ? Number(p.trainer_fee) : 0));
  }
  form.elements.trainer.addEventListener('change', updateTotal);
  function setError(message) { const el = $('#registration-error'); el.textContent = message || ''; el.hidden = !message; if(message){ regDialog.scrollTop = 0; } }
  function showStep(n) {
    step = n; setError(''); $$('.form-step').forEach(s => s.hidden = Number(s.dataset.step) !== n);
    $$('[data-progress]').forEach(p => p.classList.toggle('current', Number(p.dataset.progress) <= n));
    if(n === 3) renderReview();
    regDialog.scrollTop = 0;
    setTimeout(() => $(`[data-step="${n}"] input, [data-step="${n}"] button`,form)?.focus({preventScroll:true}), 40);
  }
  function validateStep(n) {
    if(n===1)updateGuardian();
    const section = $(`[data-step="${n}"]`,form);
    for(const el of $$('input, select, textarea',section)) if(!el.checkValidity()){ el.reportValidity(); return false; }
    if(n === 1) {
      const digits = form.elements.phone.value.replace(/\D/g,'');
      if(digits.length < 9 || digits.length > 15){ form.elements.phone.setCustomValidity('Enter a valid phone number, such as +256 778 676 138.'); form.elements.phone.reportValidity(); return false; }
      if(!form.elements.name.value.trim()){ form.elements.name.setCustomValidity('Please enter your full name.');form.elements.name.reportValidity();return false; }
    }
    if(n === 1 && isMinor()){
      const digits=form.elements.parent_phone.value.replace(/\D/g,'');
      if(digits.length<9 || digits.length>15){form.elements.parent_phone.setCustomValidity('Enter a valid parent or guardian phone number.');form.elements.parent_phone.reportValidity();return false;}
      if(!form.elements.parent_name.value.trim()){form.elements.parent_name.setCustomValidity('Please enter the representing adult’s full name.');form.elements.parent_name.reportValidity();return false;}
    }
    return true;
  }
  function isMinor(){const age=Number(form.elements.age.value);return !!form.elements.age.value && age>=12 && age<18;}
  function updateGuardian(){
    const minor=isMinor(),section=$('#guardian-section');section.hidden=!minor;section.disabled=!minor;
    $$('[data-guardian-required]',section).forEach(input=>input.required=minor);
    form.elements.email.required=!minor;form.elements.email.placeholder=minor?'Optional member email':'you@example.com';
    $('#member-email-label').textContent=minor?'Member email address (optional)':'Member email address';
    $('#age-guidance').textContent=minor?'Parent / guardian registration is required below. The representing adult must consent and confirm training arrangements with the gym.':'Members aged 12–17 must be represented by a parent or guardian. Online registration starts at age 12.';
  }
  form.elements.age.addEventListener('input',updateGuardian);
  form.elements.parent_phone.addEventListener('input',()=>form.elements.parent_phone.setCustomValidity(''));
  form.elements.parent_name.addEventListener('input',()=>form.elements.parent_name.setCustomValidity(''));
  form.elements.phone.addEventListener('input', () => form.elements.phone.setCustomValidity(''));
  form.elements.name.addEventListener('input', () => form.elements.name.setCustomValidity(''));
  function reviewRow(label,value,classes='') { return `<div class="review-row ${classes}"><span>${esc(label)}</span><b>${esc(value)}</b></div>`; }
  function renderReview(){
    const p = selectedPlan(), trainer = form.elements.trainer.checked;
    $('#registration-review').innerHTML = reviewRow('Member',form.elements.name.value.trim()) + reviewRow('Age',form.elements.age.value+' years') + reviewRow('Member email',form.elements.email.value.trim()||'Not provided') + reviewRow('Phone',form.elements.phone.value.trim()) + reviewRow('Measurements',form.elements.weight.value+' kg · '+form.elements.height.value+' cm') + (isMinor()?reviewRow('Representing parent / guardian',form.elements.parent_name.value.trim())+reviewRow('Guardian contact',form.elements.parent_phone.value.trim()+' · '+form.elements.parent_email.value.trim()):'') + reviewRow('Membership',p.name + ' · ' + money(p.fee)) + reviewRow('Optional personal trainer',trainer ? money(p.trainer_fee) : 'Not selected') + reviewRow('Total payable', money(Number(p.fee) + (trainer ? Number(p.trainer_fee) : 0)), 'total');
  }
  function openRegistration(plan='monthly') {
    if(portalDialog.open) portalDialog.close();
    form.hidden = false; $('#registration-success').hidden = true; $('.registration-progress').hidden = false;
    updateGuardian();renderRegPlans(plan); showStep(1); showDialog(regDialog);
  }
  $$('[data-register]').forEach(b => b.addEventListener('click', () => openRegistration(b.dataset.plan || 'monthly')));
  $$('[data-next]',form).forEach(b => b.addEventListener('click', () => { if(validateStep(step)) showStep(step+1); }));
  $$('[data-back]',form).forEach(b => b.addEventListener('click', () => showStep(step-1)));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if(step !== 3){ if(validateStep(step)) showStep(step+1); return; }
    if(!validateStep(3)) return;
    const submit = $('#submit-registration');submit.disabled = true; submit.textContent = 'Saving your registration…';setError('');
    const payload = {name:form.elements.name.value.trim(),email:form.elements.email.value.trim(),phone:form.elements.phone.value.trim(),age:Number(form.elements.age.value),plan:selectedPlan().id,trainer:form.elements.trainer.checked,consent:form.elements.consent.checked};
    payload.weight=Number(form.elements.weight.value);payload.height=Number(form.elements.height.value)/100;
    if(isMinor()){for(const key of ['parent_name','parent_phone','parent_email','parent_relationship'])payload[key]=form.elements[key].value.trim();payload.parent_consent=form.elements.parent_consent.checked;}
    try {
      const result = await api('/api/register',{method:'POST',body:JSON.stringify(payload)});
      if(!result.member || !result.card_token) throw new Error('Your registration response was incomplete. Please contact the gym before registering again.');
      currentMember = result.member; memberToken = result.card_token;
      try { localStorage.setItem('elite_member_token',memberToken); } catch (_) {}
      form.hidden = true; $('.registration-progress').hidden = true; $('#registration-success').hidden = false;
      $('#new-member-card').innerHTML = cardMarkup(currentMember);renderQr($('#new-member-card'),currentMember);
      regDialog.scrollTop=0;
      $('#print-new-card').focus({preventScroll:true});
    } catch(error) {setError(error.message);} finally {submit.disabled=false;submit.innerHTML='Create my membership <span>↗</span>';}
  });
  function cardMarkup(m){
    const p = planById(m.plan);
    return `<div class="member-card"><div class="card-top"><div class="brand"><span class="brand-symbol" aria-hidden="true">E</span><span>ELITE<span class="brand-small">FITNESS GYM · KAMPALA</span></span></div><span class="card-status">${esc(statusText(m.status).toUpperCase())}</span></div><div class="card-member"><small>MEMBERSHIP CARD</small><h3>${esc(m.name)}</h3><div class="card-id">${esc(m.id)}</div></div><div class="card-bottom"><div><small>YOUR PLAN</small><b>${esc(p.name)}${m.trainer ? ' + Trainer' : ''}</b></div><div><small>VALID UNTIL</small><b>${m.status === 'pending' || m.status === 'pending_payment' ? 'After activation' : date(m.expires_at)}</b></div><div class="card-qr" aria-label="Membership verification QR code"></div></div></div>`;
  }
  function renderQr(root,m){
    const el = $('.card-qr',root); if(!el) return;
    if(typeof window.qrcode === 'function' && m.card_code){const code = window.qrcode(0,'M');code.addData(window.EliteGym?window.EliteGym.verifyUrl(m.card_code):location.origin + '/verify?code=' + encodeURIComponent(m.card_code));code.make();el.innerHTML = code.createSvgTag({cellSize:2,margin:0,scalable:true});}
    else{el.innerHTML='<small>MEMBER<br>VERIFICATION</small>';}
  }
  function printCard(m){$('#print-area').innerHTML = cardMarkup(m) + `<p>Elite Fitness Gym Kampala · +256 778 676 138<br>${m.status==='pending' || m.status==='pending_payment' ? 'Registration saved. Membership pending payment confirmation.' : 'Present this card at reception.'}</p>`; renderQr($('#print-area'),m); window.print();}
  $('#print-new-card').addEventListener('click',()=>currentMember && printCard(currentMember));
  $('#open-new-portal').addEventListener('click',()=>{regDialog.close();openPortal();});
  $$('[data-portal]').forEach(b=>b.addEventListener('click',()=>openPortal()));
  function noMember(message=''){
    $('#portal-content').innerHTML=`<div class="no-account"><span class="section-kicker">A STRONGER YOU STARTS HERE</span><h2>YOUR NEXT<br>CHAPTER.</h2><p>${esc(message || 'Register to receive your membership card and access your membership details, payment history, and class bookings.')}</p><button class="button button-dark" id="portal-register">Become a member <span>↗</span></button><p>Already registered? Open your saved private membership link, or use the device you registered on. For help restoring access, contact reception.</p><a class="text-link" href="https://wa.me/256778676138" target="_blank" rel="noopener">Contact the gym <span>↗</span></a></div>`;
    $('#portal-register').addEventListener('click',()=>openRegistration());
  }
  async function openPortal(bookClassId){
    showDialog(portalDialog);
    if(!memberToken){noMember();return;}
    $('#portal-content').innerHTML='<div class="empty-state"><span class="section-kicker">WELCOME BACK</span><h2>YOUR SPACE<br>TO GROW.</h2><p>Loading your membership…</p></div>';
    try{currentPortal = await api('/api/member',{member:true});currentMember=currentPortal.member;if(!currentMember) throw new Error('Unable to find this membership. Please contact reception.');renderPortal(bookClassId ? 'bookings' : 'membership');if(bookClassId) notify('Choose your session below to confirm your booking.');}
    catch(error){noMember(error.message);}
  }
  function reviewableSessions(){
    const reviewed=new Set((currentPortal.reviews||[]).map(r=>String(r.session_id)));
    return (currentPortal.sessions||[]).filter(session=>session.attended && session.status==='completed' && !session.reviewed && !reviewed.has(String(session.id)));
  }
  function renderPortal(tab='membership'){
    const data=currentPortal,m=data.member,awaiting=reviewableSessions();
    const tabs=[['membership','Membership'],['bookings','Bookings'],['sessions','Sessions & reviews'],['progress','My progress'],['payments','Payments']];
    $('#portal-content').innerHTML=`<div class="portal-title"><span class="section-kicker">WELCOME BACK, ${esc(m.name.split(' ')[0].toUpperCase())}</span><h2>KEEP SHOWING UP.</h2><p>Your membership. Your progress. Your next move.</p></div>${awaiting.length?`<div class="review-prompt"><div><strong>Your session. Your say.</strong><p>${awaiting.length} completed ${awaiting.length===1?'session is':'sessions are'} ready for your feedback. Help us recognise great coaching and improve your experience.</p></div><button class="button button-dark" id="open-reviews">Leave a review <span>↗</span></button></div>`:''}<div class="portal-summary"><div><small>MEMBERSHIP</small><b>${esc(planById(m.plan).name)}${m.trainer?' + Trainer':''}</b></div><div><small>STATUS</small><b>${statusTag(m.status)}</b></div><div><small>VALID UNTIL</small><b>${m.status==='pending' || m.status==='pending_payment' ? 'After payment confirmation' : date(m.expires_at)}</b></div></div><div class="portal-tabs" role="tablist" aria-label="Member workspace">${tabs.map(([id,label])=>`<button class="portal-tab ${tab===id?'active':''}" data-tab="${id}" id="member-tab-${id}" role="tab" aria-controls="portal-panel" aria-selected="${tab===id}">${label}${id==='sessions'&&awaiting.length?`<span class="tab-count">${awaiting.length}</span>`:''}</button>`).join('')}</div><div class="portal-panel" id="portal-panel" role="tabpanel" aria-labelledby="member-tab-${tab}"></div>`;
    $$('.portal-tab').forEach(b=>b.addEventListener('click',()=>renderPortal(b.dataset.tab)));
    $('#open-reviews')?.addEventListener('click',()=>renderPortal('sessions'));
    const panel=$('#portal-panel');
    if(tab==='membership'){
      panel.innerHTML=cardMarkup(m)+`<div class="portal-actions"><button class="button button-dark" id="portal-print">Print / save PDF <span>↗</span></button><button class="button button-outline" id="copy-member-link">Save private link <span>↗</span></button><a class="button button-outline" href="https://wa.me/256778676138?text=${encodeURIComponent('Hello Elite Fitness, I would like to renew my membership. Member ID: '+m.id)}" target="_blank" rel="noopener">Ask about renewal <span>↗</span></a></div>${m.age<18?`<div class="guardian-record"><strong>Parent / guardian representation</strong><p>${esc(m.parent_name||'Guardian details held by reception')}${m.parent_relationship?' · '+esc(m.parent_relationship):''}</p>${m.parent_phone?`<p>${esc(m.parent_phone)}${m.parent_email?' · '+esc(m.parent_email):''}</p>`:''}<small>Training arrangements for members under 18 are confirmed with their representing adult.</small></div>`:''}<p class="portal-note">${m.status==='pending' || m.status==='pending_payment' ? 'Your registration is saved. Visit the gym to pay '+money(m.balance ?? m.total)+' and activate your membership. Your payment is only confirmed when staff record it.' : 'Your card verifies your current membership details. Contact reception about renewals, trainer arrangements, or changes to your information.'}</p><div id="private-link-container"></div><div class="portal-actions"><button class="text-link" id="forget-membership">Remove member access from this device</button></div>`;
      renderQr(panel,m);$('#portal-print').addEventListener('click',()=>printCard(m));$('#copy-member-link').addEventListener('click',copyMemberLink);$('#forget-membership').addEventListener('click',()=>{memberToken='';try{localStorage.removeItem('elite_member_token');}catch(_){}noMember('Member access has been removed from this device. You can return using your saved private link.');});
    }else if(tab==='payments'){
      const payments=data.payments || [];
      panel.innerHTML=`<h3>PAYMENT HISTORY</h3><p class="portal-note" style="margin:0 0 17px">Only payments recorded by gym staff appear here. Amounts are in UGX.</p>${payments.length?`<div class="portal-table-scroll"><table class="portal-table"><thead><tr><th>DATE</th><th>AMOUNT</th><th>METHOD</th><th>REFERENCE</th></tr></thead><tbody>${payments.map(p=>`<tr><td>${date(p.created_at || p.paid_at)}</td><td>${money(p.amount)}</td><td>${esc(p.method || 'Recorded at gym')}</td><td>${esc(p.reference || '—')}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty-state"><h3>NO PAYMENTS RECORDED.</h3><p>Visit reception to pay and have your payment confirmed.</p></div>'}<div class="form-total"><span>Outstanding recorded balance</span><strong>${money(m.balance ?? Math.max(0,Number(m.total||0)-payments.reduce((a,p)=>a+Number(p.amount||0),0)))}</strong></div>`;
    }else if(tab==='sessions')renderSessions(panel);
    else if(tab==='progress')renderProgress(panel);
    else renderBookings(panel);
  }
  function renderSessions(panel){
    const sessions=[...(currentPortal.sessions||[])].sort((a,b)=>String(b.started_at||'').localeCompare(String(a.started_at||''))),reviews=currentPortal.reviews||[],ready=reviewableSessions();
    panel.innerHTML=`<div class="portal-section-heading"><h3>YOUR SESSIONS & FEEDBACK</h3><p>Tell us about coaching after a session you attended. Your feedback is shared with gym management and the staff member concerned to evaluate and improve the training experience.</p></div>${ready.length?`<div class="member-review-list">${ready.map(session=>`<form class="member-review-form" data-review-session="${esc(session.id)}"><span class="section-kicker">COMPLETED ${date(session.ended_at||session.started_at)}</span><h4>${esc(session.title||'Gym session')}</h4><p>With ${esc(session.staff_name||'your gym coach')}</p><label>How was your session?<select name="rating" required><option value="">Choose a rating</option><option value="5">★★★★★ · Excellent</option><option value="4">★★★★☆ · Good</option><option value="3">★★★☆☆ · Okay</option><option value="2">★★☆☆☆ · Needs improvement</option><option value="1">★☆☆☆☆ · Poor</option></select></label><label>Your feedback<textarea name="comment" maxlength="1000" rows="3" placeholder="What went well? What could be better?"></textarea></label><p class="inline-form-error" role="alert" hidden></p><button type="submit" class="button button-dark">Send my review <span>↗</span></button></form>`).join('')}</div>`:'<div class="portal-empty-note"><strong>You’re all caught up.</strong><p>A review invitation appears here after staff mark a session you attended as complete.</p></div>'}<h3 class="portal-subheading">SESSION HISTORY</h3>${sessions.length?`<div class="portal-rows">${sessions.map(session=>{const review=reviews.find(r=>String(r.session_id)===String(session.id));return `<article class="session-history-row"><div><strong>${esc(session.title||'Gym session')}</strong><p>${esc(session.staff_name||'Gym coaching')} · ${date(session.started_at)}</p><small>${session.attended?'Attendance confirmed':'Attendance not yet confirmed'} · ${esc(String(session.status||'scheduled').replace(/_/g,' '))}</small></div>${review?`<span class="review-stars" aria-label="${Number(review.rating)} out of 5 stars">${'★'.repeat(Math.min(5,Math.max(0,Number(review.rating)||0)))}${'☆'.repeat(Math.max(0,5-(Number(review.rating)||0)))}</span>`:''}</article>`;}).join('')}</div>`:'<div class="empty-state"><h3>YOUR NEXT SESSION AWAITS.</h3><p>Sessions assigned to you by gym staff will appear here.</p></div>'}${reviews.length?`<h3 class="portal-subheading">YOUR REVIEWS</h3><div class="member-submitted-reviews">${reviews.map(review=>`<article><div><strong>${esc(review.staff_name||'Gym coach')}</strong><span>${Number(review.rating)} / 5 · ${date(review.created_at)}</span></div>${review.comment?`<p>${esc(review.comment)}</p>`:'<p>Rating submitted. Thank you for your feedback.</p>'}</article>`).join('')}</div>`:''}`;
    $$('[data-review-session]',panel).forEach(reviewForm=>reviewForm.addEventListener('submit',event=>submitReview(event,reviewForm)));
  }
  async function submitReview(event,reviewForm){
    event.preventDefault();if(!reviewForm.reportValidity())return;
    const error=$('.inline-form-error',reviewForm),button=$('button[type=submit]',reviewForm);error.hidden=true;button.disabled=true;
    try{await api('/api/member/review',{method:'POST',member:true,body:JSON.stringify({session_id:reviewForm.dataset.reviewSession,rating:Number(reviewForm.elements.rating.value),comment:reviewForm.elements.comment.value.trim()})});currentPortal=await api('/api/member',{member:true});renderPortal('sessions');notify('Thank you. Your session review has been saved.');}
    catch(reason){error.textContent=reason.message;error.hidden=false;button.disabled=false;}
  }
  function renderProgress(panel){
    const m=currentPortal.member,records=[...(currentPortal.progress||[])].sort((a,b)=>String(b.recorded_at||'').localeCompare(String(a.recorded_at||''))),latest=records[0]||m;
    const visits=(currentPortal.attendance||[]).length,completed=(currentPortal.sessions||[]).filter(s=>s.attended&&s.status==='completed').length;
    panel.innerHTML=`<div class="portal-section-heading"><h3>YOUR PROGRESS, YOUR PACE.</h3><p>Keep a private record of your measurements and the sessions you’ve completed. Progress is personal; these numbers are a starting point, not a score.</p></div><div class="progress-metrics"><div><small>LATEST WEIGHT</small><strong>${latest.weight?esc(Number(latest.weight).toFixed(1))+' <span>kg</span>':'—'}</strong></div><div><small>HEIGHT</small><strong>${latest.height?esc(Math.round(Number(latest.height)*1000)/10)+' <span>cm</span>':'—'}</strong></div><div><small>RECORDED VISITS</small><strong>${visits}</strong></div><div><small>COMPLETED SESSIONS</small><strong>${completed}</strong></div></div>${m.age<18?'<div class="portal-empty-note"><strong>Growing at your own pace.</strong><p>Age-appropriate goals should be discussed with your parent or guardian and a qualified coach. Adult BMI categories are not used for members under 18.</p></div>':m.bmi?`<div class="portal-fitness"><b>Recorded BMI estimate: ${esc(Number(m.bmi).toFixed(1))}</b>${m.program?`<p>Starting focus: ${esc(m.program)}</p>`:''}<p>BMI is a general screening estimate. Discuss individual goals with an appropriate health professional.</p></div>`:''}<form id="member-progress-form" class="member-progress-form"><h4>ADD A MEASUREMENT</h4><p>Enter current measurements. Height is shown in centimetres and weight in kilograms.</p><div class="form-grid"><label>Weight (kg)<input name="weight" type="number" min="20" max="400" step="0.1" required value="${latest.weight?esc(latest.weight):''}" inputmode="decimal"></label><label>Height (cm)<input name="height" type="number" min="80" max="250" step="0.1" required value="${latest.height?esc(Math.round(Number(latest.height)*1000)/10):''}" inputmode="decimal"></label><label class="full">A note about your progress<textarea name="note" rows="3" maxlength="500" placeholder="Optional: how are you feeling about your training?"></textarea></label></div><p class="inline-form-error" role="alert" hidden></p><button class="button button-dark" type="submit">Save my measurement <span>↗</span></button></form><h3 class="portal-subheading">MEASUREMENT HISTORY</h3>${records.length?`<div class="progress-timeline">${records.map(record=>`<article><span class="timeline-dot"></span><div><small>${date(record.recorded_at||record.created_at)}</small><strong>${esc(Number(record.weight).toFixed(1))} kg <span>·</span> ${esc(Math.round(Number(record.height)*1000)/10)} cm</strong>${record.note?`<p>${esc(record.note)}</p>`:''}</div></article>`).join('')}</div>`:'<div class="portal-empty-note"><p>Your registration measurements are saved in your member record. Add an update above to begin your progress timeline.</p></div>'}`;
    $('#member-progress-form').addEventListener('submit',submitProgress);
  }
  async function submitProgress(event){
    event.preventDefault();const progressForm=event.currentTarget;if(!progressForm.reportValidity())return;
    const error=$('.inline-form-error',progressForm),button=$('button[type=submit]',progressForm);error.hidden=true;button.disabled=true;
    try{await api('/api/member/progress',{method:'POST',member:true,body:JSON.stringify({weight:Number(progressForm.elements.weight.value),height:Number(progressForm.elements.height.value)/100,note:progressForm.elements.note.value.trim()})});currentPortal=await api('/api/member',{member:true});currentMember=currentPortal.member;renderPortal('progress');notify('Your measurement has been saved. Keep showing up.');}
    catch(reason){error.textContent=reason.message;error.hidden=false;button.disabled=false;}
  }
  async function copyMemberLink(){
    const url=new URL('./',document.baseURI).href+'?portal=1#member='+encodeURIComponent(memberToken);
    const container=$('#private-link-container');container.innerHTML=`<p class="portal-saved-link">Your private member link grants access to your membership details. Keep it to yourself.<br><a href="${esc(url)}">Open your private member area ↗</a></p>`;
    try{await navigator.clipboard.writeText(url);notify('Your private member link has been copied. Keep it somewhere safe.');}catch(_){notify('Your private link is shown below. Save it somewhere safe.');}
  }
  function classTitle(c){return c.title || c.name || 'Gym session';}
  function classTime(c){return `${c.day || c.date || ''}${c.time?' · '+c.time:''}${c.duration?' · '+c.duration+' min':''}`;}
  function renderBookings(panel){
    const classes=currentPortal.classes || config.classes || [],bookings=(currentPortal.bookings || []).filter(b=>b.status!=='cancelled');
    panel.innerHTML=`<h3>YOUR UPCOMING SESSIONS</h3><div class="portal-rows">${bookings.length?bookings.map(b=>{const c=classes.find(c=>String(c.id)===String(b.class_id))||b;return `<div class="portal-row"><div><strong>${esc(classTitle(c))}</strong><small>${esc(classTime(c))}</small></div><button class="button button-outline" data-cancel-booking="${esc(b.id)}">Cancel <span>×</span></button></div>`;}).join(''):'<p class="portal-note" style="margin:0 0 22px">No upcoming bookings yet. Choose an available session below.</p>'}</div><h3 style="margin-top:26px">FIND YOUR NEXT SESSION</h3>${classes.length?`<div class="portal-rows">${classes.map(c=>{const booked=bookings.some(b=>String(b.class_id)===String(c.id)),full=Number(c.booked||0)>=Number(c.capacity||1),active=currentPortal.member.status==='active';return `<div class="portal-row"><div><strong>${esc(classTitle(c))}</strong><small>${esc(classTime(c))} · ${Math.max(0,Number(c.capacity||0)-Number(c.booked||0))} places left</small></div><button class="button ${booked?'button-outline':'button-dark'}" data-book-class="${esc(c.id)}" ${booked||full||!active?'disabled':''}>${booked?'Booked':full?'Full':!active?'Activate first':'Book'} ${!booked&&!full&&active?'<span>↗</span>':''}</button></div>`;}).join('')}</div>`:'<div class="empty-state"><h3>MORE MOVEMENT, COMING SOON.</h3><p>Published gym sessions will appear here. Contact the gym for current availability.</p></div>'}<p class="portal-note">Class bookings require an active membership. Personal training arrangements are confirmed directly with the gym.</p>`;
    $$('[data-book-class]',panel).forEach(b=>b.addEventListener('click',()=>updateBooking('/api/member/book',{class_id:b.dataset.bookClass},b)));
    $$('[data-cancel-booking]',panel).forEach(b=>b.addEventListener('click',()=>updateBooking('/api/member/cancel',{booking_id:b.dataset.cancelBooking},b)));
  }
  async function updateBooking(path,body,button){
    button.disabled=true;
    try{await api(path,{method:'POST',member:true,body:JSON.stringify(body)});currentPortal=await api('/api/member',{member:true});renderPortal('bookings');notify(path.endsWith('/cancel')?'Booking cancelled.':'Your session is booked. See you at Elite.');}
    catch(error){notify(error.message);button.disabled=false;}
  }
  function applyConfig(){
    for(const p of config.plans){
      const button=$(`#plan-grid [data-plan="${p.id}"]`);if(!button)continue;
      const article=button.closest('article');$('.price strong',article).textContent=Number(p.fee).toLocaleString('en-UG');$('.trainer-price b',article).textContent='+ '+money(p.trainer_fee);const defaultDays={daily:1,monthly:30,quarterly:90,annual:365};if(Number(p.days)!==defaultDays[p.id])$('.price>span',article).textContent='/ '+p.days+' days';
    }
    if(config.trainers?.length && $('.trainer-grid')){
      $('.trainer-grid').innerHTML=config.trainers.map((t,i)=>`<article class="trainer-card reveal visible"><div class="trainer-image"><img src="${esc(window.EliteGym?window.EliteGym.assetUrl(t.image || './assets/trainer-strength.jpg'):(t.image || './assets/trainer-strength.jpg'))}" alt="${esc(t.illustrative?'Representative stock fitness portrait':t.name+' — trainer portrait')}" loading="lazy"><span>${String(i+1).padStart(2,'0')}</span></div><div class="trainer-info"><h3>${esc(t.name.toUpperCase())}</h3><span>${esc(t.specialty || '')} ↗</span></div>${t.bio?`<p class="trainer-bio">${esc(t.bio)}</p>`:''}</article>`).join('');
      $('.image-note').textContent=config.trainers.some(t=>t.illustrative)?'Representative stock photography. Contact us for current trainer names, availability, and specialisms.':'Trainer profile photos are representative stock images. Contact us to confirm current availability.';
    } else if(Array.isArray(config.trainers) && $('.trainer-grid')) {
      $('.trainer-grid').innerHTML='<div class="empty-state" style="grid-column:1/-1"><span class="empty-icon">↗</span><h3>LET’S FIND YOUR NEXT STEP.</h3><p>Trainer profiles are being updated. Contact the gym to ask about current personal training availability.</p><a class="text-link" href="https://wa.me/256778676138?text=Hello%20Elite%20Fitness%2C%20I%27d%20like%20to%20ask%20about%20personal%20training." target="_blank" rel="noopener">Ask about a trainer <span>↗</span></a></div>';
      if($('.image-note')) $('.image-note').textContent='Personal training is an optional membership add-on. Availability is confirmed directly with the gym.';
    }
    if($('#trainer-fee-answer')) $('#trainer-fee-answer').textContent='Personal training is optional and charged separately. Trainer add-ons are '+config.plans.map(p=>money(p.trainer_fee)+' for '+String(p.name).toLowerCase()+' membership').join(', ')+'. Confirm session arrangements with the gym.';
    const settings=config.settings||{};
    if(settings.gym_name){document.title=settings.gym_name+' — Find your stronger';$$('[data-gym-name]').forEach(el=>el.textContent=settings.gym_name);}
    if(settings.hours){const hours=String(settings.hours).split('·')[0].trim();$$('[data-gym-hours]').forEach(el=>el.textContent=hours);if($('.hero-location>span:last-child')) $('.hero-location>span:last-child').innerHTML='KAMPALA, UGANDA <i></i>'+esc(settings.hours);if($('#hours-answer')) $('#hours-answer').textContent='Our opening hours are '+settings.hours+'. Contact us to confirm holiday opening and trainer availability.';}

    if(settings.announcement){const announcement=document.createElement('div');announcement.className='site-announcement';announcement.textContent=settings.announcement;$('.site-header').insertAdjacentElement('afterend',announcement);}
    if(settings.email){$$('a[href^="mailto:"]').forEach(a=>{a.href='mailto:'+settings.email;if(a.closest('.contact-links'))$('span',a).textContent=settings.email+' ↗';});}
    if(settings.phone){const digits=String(settings.phone).replace(/\D/g,'');if(digits){$$('a[href^="tel:"]').forEach(a=>{a.href='tel:+'+digits;if(a.closest('.contact-links'))$('span',a).textContent='+'+digits+' ↗';});$$('a[href^="https://wa.me/"]').forEach(a=>{const u=new URL(a.href);u.pathname='/'+digits;a.href=u.href;});}}
  }
  function renderSchedule(){
    if(!config.classes?.length || !$('#schedule-list')) return;
    $('#schedule-list').innerHTML=config.classes.map(c=>`<div class="schedule-row"><div class="schedule-day">${esc(c.day || c.date || 'Upcoming')}<span>${esc(c.time || '')} EAT</span></div><div class="schedule-title">${esc(classTitle(c).toUpperCase())}</div><div class="schedule-meta">${c.duration?esc(c.duration)+' MIN':'GYM SESSION'}</div><div class="schedule-meta">${Math.max(0,Number(c.capacity||0)-Number(c.booked||0))} PLACES LEFT</div><button class="button button-outline" data-schedule-book="${esc(c.id)}">Book session <span>↗</span></button></div>`).join('');
    $$('[data-schedule-book]').forEach(b=>b.addEventListener('click',()=>openPortal(b.dataset.scheduleBook)));
  }
  async function verifyCard(){
    const main=$('#main');main.innerHTML='<section class="verify-page"><div class="verify-box"><span class="section-kicker">ELITE / MEMBERSHIP VERIFICATION</span><h1>CHECKING<br>MEMBERSHIP.</h1><p>Please wait…</p></div></section>';
    const code=new URLSearchParams(location.search).get('code');
    try{
      if(!code) throw new Error('No verification code was provided. Scan the QR code on an Elite membership card.');
      const result=await api('/api/verify?code='+encodeURIComponent(code)),m=result.member || result;
      if(!result.valid) throw new Error('This membership card could not be verified. Please ask reception for help.');
      main.innerHTML=`<section class="verify-page"><div class="verify-box"><span class="verify-icon">✓</span><span class="section-kicker" style="display:block;margin-top:20px">ELITE / MEMBERSHIP VERIFICATION</span><h1>MEMBERSHIP<br>VERIFIED.</h1><div class="review-card">${reviewRow('Member',m.name)}${reviewRow('Plan',planById(m.plan).name)}${reviewRow('Status',statusText(m.status))}${reviewRow('Valid until',m.status==='pending'||m.status==='pending_payment'?'After activation':date(m.expires_at))}</div><p>${m.status==='active'?'This member currently has an active Elite membership.':'This card is registered. Membership status is shown above; contact reception for activation or renewal.'}</p><a class="text-link" href="/">Back to Elite <span>↗</span></a></div></section>`;
    }catch(error){main.innerHTML=`<section class="verify-page"><div class="verify-box invalid"><span class="verify-icon">!</span><h1>LET’S CHECK<br>WITH RECEPTION.</h1><p>${esc(error.message)}</p><a class="text-link" href="https://wa.me/256778676138" target="_blank" rel="noopener">Contact the gym <span>↗</span></a></div></section>`;}
  }
  updateGuardian();
  renderRegPlans();
  api('/api/config').then(data=>{config={...config,...data,plans:data.plans?.length?data.plans:defaults};renderRegPlans();applyConfig();renderSchedule();}).catch(()=>{});
  if(location.pathname==='/verify'||params.has('verify')) verifyCard();
  else if(params.has('portal')) openPortal();
})();
