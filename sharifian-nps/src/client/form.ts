// Survey form enhancement: steps, auto-advance, draft, funnel events, JSON submit.
// Without this script the server-rendered single-page form still works (classic POST).
import { faDigits } from '../core/fa.ts';
import { normalizeMobile } from '../core/mobile.ts';

interface ClientConfig {
  titles: { promoter: string; passive: string; detractor: string; fallback: string };
  errors: { score: string; mobile: string; comment: string; tooFast: string; network: string };
  submit: string;
  submitting: string;
  maxLength: number;
  test: boolean;
}

interface Draft {
  score: number | null;
  drivers: string[];
  comment: string;
  step: number;
}

const DRAFT_KEY = 'sharifian-nps-draft';
const ADVANCE_DELAY_MS = 250;

function readDraft(): Draft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

function writeDraft(draft: Draft): void {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* storage may be blocked (private mode) — the form still works */
  }
}

function clearDraft(): void {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

function init(): void {
  document.documentElement.classList.add('js');
  (window as unknown as { __nps: boolean }).__nps = true;

  const form = document.getElementById('nps') as HTMLFormElement | null;
  const configEl = document.getElementById('nps-config');
  if (!form || !configEl) return;
  const cfg = JSON.parse(configEl.textContent || '{}') as ClientConfig;

  const $ = <T extends Element>(selector: string) => form.querySelector<T>(selector);
  const steps = Array.prototype.slice.call(form.querySelectorAll('.step')) as HTMLElement[];
  const bar = document.querySelector<HTMLElement>('.progress-bar');
  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | null;
  const tk = field('tk')?.value ?? '';
  const src = field('src')?.value ?? 'direct';
  const rep = field('rep')?.value ?? '';
  const title2 = $<HTMLElement>('#q2');
  const consent = $<HTMLElement>('#consent');
  const contact = $<HTMLInputElement>('#consent input');
  const comment = $<HTMLTextAreaElement>('#comment');
  const counter = $<HTMLElement>('#comment-counter');
  const mobile = $<HTMLInputElement>('#mobile');
  const mobileError = $<HTMLElement>('#mobile-error');
  const scoreError = $<HTMLElement>('#score-error');
  const formError = $<HTMLElement>('#form-error');
  const submitBtn = $<HTMLButtonElement>('[data-submit]');

  let current = 1;
  let busy = false;
  let lastPointer = 0;
  let advanceTimer = 0;
  const sent: Record<string, boolean> = {};

  const track = (type: string) => {
    if (cfg.test || sent[type]) return;
    sent[type] = true;
    const body = JSON.stringify({ tk, type, src });
    try {
      if (!(navigator.sendBeacon && navigator.sendBeacon('/api/events', body))) {
        fetch('/api/events', { method: 'POST', body, keepalive: true, headers: { 'content-type': 'text/plain' } }).catch(
          () => undefined,
        );
      }
    } catch {
      /* analytics must never break the form */
    }
  };

  const score = (): number | null => {
    const checked = $<HTMLInputElement>('input[name="score"]:checked');
    return checked ? Number(checked.value) : null;
  };
  const drivers = () =>
    (Array.prototype.slice.call(form.querySelectorAll('input[name="drivers"]:checked')) as HTMLInputElement[]).map(
      (el) => el.value,
    );

  const save = () => writeDraft({ score: score(), drivers: drivers(), comment: comment?.value ?? '', step: current });

  const show = (el: HTMLElement | null, text?: string) => {
    if (!el) return;
    if (text !== undefined) el.textContent = text;
    el.hidden = false;
  };
  const hide = (el: HTMLElement | null) => {
    if (el) el.hidden = true;
  };

  const updateStep2 = () => {
    const s = score();
    if (!title2) return;
    title2.textContent =
      s === null ? cfg.titles.fallback : s >= 9 ? cfg.titles.promoter : s >= 7 ? cfg.titles.passive : cfg.titles.detractor;
  };

  const updateConsent = () => {
    const s = score();
    const visible = s !== null && s <= 8;
    if (consent) consent.hidden = !visible;
    if (!visible && contact) contact.checked = false;
  };

  const updateCounter = () => {
    if (!comment || !counter) return;
    const len = comment.value.length;
    if (len >= cfg.maxLength - 200) show(counter, `${faDigits(len)} / ${faDigits(cfg.maxLength)}`);
    else hide(counter);
  };

  const go = (n: number, focus = true) => {
    current = Math.max(1, Math.min(3, n));
    for (const step of steps) step.classList.toggle('is-active', Number(step.getAttribute('data-step')) === current);
    if (bar) bar.style.width = `${(current / 3) * 100}%`;
    updateStep2();
    updateConsent();
    save();
    if (focus) {
      window.scrollTo(0, 0);
      const target = current === 3 ? mobile : steps[current - 1]?.querySelector<HTMLElement>('.question');
      if (target) target.focus({ preventScroll: true });
    }
  };

  const scheduleAdvance = () => {
    window.clearTimeout(advanceTimer);
    advanceTimer = window.setTimeout(() => go(2), ADVANCE_DELAY_MS);
  };

  // Restore a draft (sessionStorage) unless the server re-rendered the form with values.
  const draft = readDraft();
  const serverStep = Number(form.getAttribute('data-start-step')) || 1;
  if (draft && score() === null) {
    if (draft.score !== null) {
      const radio = $<HTMLInputElement>(`#score-${draft.score}`);
      if (radio) radio.checked = true;
    }
    for (const id of draft.drivers || []) {
      const chip = $<HTMLInputElement>(`#d-${id}`);
      if (chip) chip.checked = true;
    }
    if (comment && draft.comment) comment.value = draft.comment;
    go(draft.score === null ? 1 : Math.min(draft.step || 1, 3), false);
  } else {
    go(serverStep, false);
  }
  updateCounter();
  track('view');

  const markPointer = () => {
    lastPointer = Date.now();
  };
  form.addEventListener('pointerdown', markPointer, true);
  form.addEventListener('mousedown', markPointer, true);
  form.addEventListener('touchstart', markPointer, { capture: true, passive: true });

  // Auto-advance only for touch/mouse. Arrow keys inside a radio group also fire "click",
  // so keyboard users stay on step 1 and press Enter to continue.
  form.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.name === 'score' && Date.now() - lastPointer < 1500) {
      scheduleAdvance();
    }
    if (target.closest('[data-next]')) {
      track('step2_done');
      go(current + 1);
    }
    if (target.closest('[data-prev]')) go(current - 1);
  });

  form.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    if (target.name === 'score') {
      hide(scoreError);
      track('score_selected');
      updateStep2();
      updateConsent();
    }
    save();
  });

  form.addEventListener('keydown', (event) => {
    const target = event.target as HTMLInputElement;
    if (event.key === 'Enter' && target.name === 'score') {
      event.preventDefault();
      if (score() !== null) go(2);
    }
  });

  let saveTimer = 0;
  comment?.addEventListener('input', () => {
    updateCounter();
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(save, 300);
  });

  mobile?.addEventListener('blur', () => {
    if (mobile.value.trim() && !normalizeMobile(mobile.value)) {
      mobile.setAttribute('aria-invalid', 'true');
      show(mobileError, cfg.errors.mobile);
    }
  });
  mobile?.addEventListener('input', () => {
    if (mobile.getAttribute('aria-invalid') === 'true' && normalizeMobile(mobile.value)) {
      mobile.setAttribute('aria-invalid', 'false');
      hide(mobileError);
    }
  });

  if (typeof fetch !== 'function') return; // very old browser: let the classic POST happen

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (current < 3) {
      if (current === 1 && score() === null) show(scoreError, cfg.errors.score);
      else go(current + 1);
      return;
    }
    if (busy) return;
    hide(formError);

    const s = score();
    if (s === null) {
      go(1);
      show(scoreError, cfg.errors.score);
      return;
    }
    const normalized = normalizeMobile(mobile?.value ?? '');
    if (!normalized) {
      mobile?.setAttribute('aria-invalid', 'true');
      show(mobileError, cfg.errors.mobile);
      mobile?.focus();
      return;
    }

    const payload = {
      tk,
      src,
      rep,
      website: field('website')?.value ?? '',
      score: s,
      drivers: drivers(),
      comment: comment?.value ?? '',
      mobile: normalized,
      contact: !!contact && contact.checked && !consent?.hidden,
    };

    busy = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = cfg.submitting;
    }
    const done = () => {
      busy = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = cfg.submit;
      }
    };
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = window.setTimeout(() => controller?.abort(), 15000);

    fetch('/api/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: controller?.signal,
    })
      .then((res) =>
        res
          .json()
          .catch(() => ({}))
          .then((body: { error?: string; message?: string; fields?: Record<string, string> }) => {
            window.clearTimeout(timeout);
            if (res.status === 201) {
              clearDraft();
              window.location.replace('/thanks');
              return;
            }
            if (res.status === 409) {
              clearDraft();
              window.location.replace('/already');
              return;
            }
            if (res.status === 403 || body.error === 'bad_token') {
              window.location.reload();
              return;
            }
            done();
            if (body.error === 'invalid' && body.fields) {
              if (body.fields.score) {
                go(1);
                show(scoreError, cfg.errors.score);
              } else if (body.fields.comment) {
                go(2);
                show($<HTMLElement>('#comment-error'), cfg.errors.comment);
              } else {
                mobile?.setAttribute('aria-invalid', 'true');
                show(mobileError, cfg.errors.mobile);
              }
              return;
            }
            show(formError, body.message || cfg.errors.network);
          }),
      )
      .catch(() => {
        window.clearTimeout(timeout);
        done();
        show(formError, cfg.errors.network);
      });
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
