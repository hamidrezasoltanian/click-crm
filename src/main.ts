import { createApp, ref } from 'vue';
import ProformaPanel from './components/ProformaPanel.vue';

// Fetch current user role from API, then mount components.
// This ensures the role is always up-to-date regardless of HTML static content.
fetch('/api/auth/me')
  .then(r => r.ok ? r.json() : null)
  .then(user => {
    const userRole = user?.role || '';

    const pfEl = document.getElementById('vue-proforma');
    if (pfEl) {
      createApp(ProformaPanel, {
        userRole,
        onNew:     () => (window as any)._pfNew?.(),
        onView:    (pf: any) => (window as any)._pfView?.(pf),
        onSend:    (pf: any) => (window as any)._pfSend?.(pf),
        onApprove: (pf: any) => (window as any)._pfApprove?.(pf),
        onReject:  (pf: any) => (window as any)._pfReject?.(pf),
      }).mount(pfEl);
    }
  })
  .catch(() => {
    // Not logged in or server unreachable — components stay unmounted
  });
