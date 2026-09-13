// Re-exports the real userscript's text so the admin panel's "Copy script"
// button and tampermonkey/progress-sync.user.js can never drift apart.
export { default as TAMPERMONKEY_SCRIPT } from '../../tampermonkey/progress-sync.user.js?raw';
