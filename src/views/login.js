// Sign-in screen. Docs: docs/user-flows.md#1-first-launch
// @req REQ-AUTH-1 @req REQ-AUTH-2 @req REQ-AUTH-4 @req REQ-LANG-2

import { h } from '../lib/dom.js';
import { t, LANGUAGES, language, setLanguage } from '../i18n.js';
import {
  firebaseConfigured, signInEmail, signUpEmail, signInGoogle, resetPassword, startLocalDemo, authErrorMessage, takeRedirectError,
} from '../auth.js';

export function render(root, ctx) {
  let mode = 'signin'; // or 'signup'
  const error = h('p', { class: 'error', role: 'alert' });
  const redirectError = firebaseConfigured ? takeRedirectError() : null;
  if (redirectError) error.textContent = authErrorMessage(redirectError);
  const email = h('input', { type: 'email', autocomplete: 'email', placeholder: t('Email'), required: true, dir: 'ltr' });
  const password = h('input', { type: 'password', autocomplete: 'current-password', placeholder: t('Password'), required: true, minLength: 6, dir: 'ltr' });
  const submit = h('button', { class: 'primary', type: 'submit' });
  const switchLink = h('button', { type: 'button', class: 'link' });

  const busy = async (fn) => {
    error.textContent = '';
    root.querySelectorAll('button').forEach((b) => (b.disabled = true));
    try { await fn(); } catch (e) { error.textContent = authErrorMessage(e); }
    root.querySelectorAll('button').forEach((b) => (b.disabled = false));
  };

  const paint = () => {
    submit.textContent = mode === 'signin' ? t('Sign in') : t('Create account');
    password.autocomplete = mode === 'signin' ? 'current-password' : 'new-password';
    switchLink.textContent = mode === 'signin' ? t('New here? Create an account') : t('Have an account? Sign in');
  };
  switchLink.onclick = () => { mode = mode === 'signin' ? 'signup' : 'signin'; paint(); };
  paint();

  const form = h('form', {
    class: 'stack',
    onsubmit: (e) => {
      e.preventDefault();
      busy(() => (mode === 'signin' ? signInEmail : signUpEmail)(email.value.trim(), password.value));
    },
  }, email, password, submit);

  const content = firebaseConfigured
    ? [
        h('button', { class: 'google', type: 'button', onclick: () => busy(signInGoogle) },
          h('span', { class: 'g' }, 'G'), t('Continue with Google')),
        h('div', { class: 'divider' }, t('or')),
        form,
        switchLink,
        h('button', {
          type: 'button', class: 'link small',
          onclick: () => email.value
            ? busy(async () => { await resetPassword(email.value.trim()); error.textContent = t('Password reset email sent.'); })
            : (error.textContent = t('Type your email first.')),
        }, t('Forgot password?')),
      ]
    : [
        h('p', { class: 'notice' },
          t('Firebase is not set up yet, so accounts are off. Follow docs/setup.md to turn on email and Google sign-in.')),
        h('button', { class: 'primary', type: 'button', onclick: () => ctx.setUser(startLocalDemo()) },
          t('Continue in local demo mode')),
      ];

  // Before signing in there is no Options button yet: the other language is one tap away here.
  const languageLinks = LANGUAGES.filter((l) => l.id !== language()).map((l) =>
    h('button', { type: 'button', class: 'link small', lang: l.id, onclick: () => setLanguage(l.id) }, `🌐 ${l.name}`));

  root.append(
    h('main', { class: 'screen center' },
      h('div', { class: 'brand' },
        h('img', { src: 'icons/icon-192.png', alt: '', width: 96, height: 96 }),
        h('h1', {}, 'Knight Bus'),
        h('p', { class: 'muted' }, t('Your buses, live.'))),
      h('div', { class: 'card stack' }, ...content, error),
      h('div', { class: 'row center-row' }, ...languageLinks)),
  );
}
