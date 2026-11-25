import { brandMark, brandHTML } from '../components/icons.js';
import { esc } from '../core/storage.js';

export function showTour({force = false, user, setActions, syncNative, haptic}) {
  const tourKey = 'velt.tour.065.' + (user ? 'user.' + user.id : 'guest');
  try { if (!force && localStorage.getItem(tourKey) === '1') return; } catch {}
  if (document.querySelector('#tour')) return;
  const steps = [
    { title: 'Welcome to Velt', copy: 'Keep your cards, tickets and receipts in one place.', image: '/onboarding/story-1.webp' },
    { title: 'Add in seconds', copy: 'Use the Add screen to save a code, attach a photo or scan with Telegram.', image: '/onboarding/story-2.webp' },
    { title: 'Stay organized', copy: 'Filter by Card, Ticket or Note and keep favorites close.', image: '/onboarding/story-3.webp' },
    { title: 'Ready every day', copy: 'Your wallet stays simple, fast and easy to reach.', image: '/onboarding/story-4.webp' },
  ];
  let step = 0;
  const dialog = document.createElement('dialog');
  dialog.id = 'tour'; dialog.className = 'tour stories-tour'; dialog.tabIndex = -1;
  dialog.setAttribute('aria-labelledby', 'tourTitle');
  document.body.append(dialog);
  const finish = () => {
    try { localStorage.setItem(tourKey, '1'); } catch {}
    setActions(null);
    dialog.close(); dialog.remove(); syncNative();
  };
  const previous = () => { if (step) { step--; paint(); haptic('light'); } };
  const next = () => { if (step === steps.length - 1) finish(); else { step++; paint(); haptic('light'); } };
  const paint = () => {
    const current = steps[step];
    const label = step === steps.length - 1 ? 'Get started' : 'Continue';
    dialog.innerHTML = `
      <div class="story-progress">${steps.map((_, n) => `<span class="${n <= step ? 'current' : ''}"></span>`).join('')}</div>
      <div class="tour-brand">${brandHTML()}<button data-tour="skip">Skip</button></div>
      <div class="story-stage">
        <div class="story-screen"><img src="${current.image}" alt="${esc(current.title)}" onerror="this.hidden=true;this.parentElement.classList.add('story-fallback')"><div class="story-fallback-copy">${brandMark()}<strong>${esc(current.title)}</strong><span>${esc(current.copy)}</span></div></div>
      </div>
      <div class="tour-copy">
        <h2 id="tourTitle">${current.title}</h2>
        <p>${current.copy}</p>
      </div>
      <div class="tour-actions">${step ? '<button class="secondary" data-tour="back">Back</button>' : '<span></span>'}<button class="primary" data-tour="next">${label}</button></div>`;
    setActions({ main:null, secondary:null, back: { onClick: step ? previous : finish }, settings:null });
    syncNative();
    dialog.focus();
  };
  dialog.addEventListener('click', e => {
    const action = e.target.closest('[data-tour]')?.dataset.tour;
    if (action === 'skip') finish();
    if (action === 'back') previous();
    if (action === 'next') next();
  });
  dialog.addEventListener('cancel', e => { e.preventDefault(); if (step) previous(); else finish(); });
  let touchX;
  dialog.addEventListener('touchstart', e => { touchX = e.changedTouches[0].clientX; }, { passive: true });
  dialog.addEventListener('touchend', e => {
    const delta = e.changedTouches[0].clientX - touchX;
    if (Math.abs(delta) > 60) { if (delta < 0) next(); else previous(); }
  }, { passive: true });
  dialog.showModal(); paint();
}