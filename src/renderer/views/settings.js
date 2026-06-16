/* Admin Settings — accounts, clinic settings, and software updates. */
import { h, mount, toast, field, spinner } from '../util.js';
import { T } from '../i18n/index.js';
import { renderAccounts } from '../components/accounts.js';

export function renderSettings(container, ctx) {
  let section = 'accounts';
  let unsubscribeUpdates = null;

  function nav() {
    const btn = (key, label) => h('button', {
      class: 'subtab' + (section === key ? ' active' : ''),
      onClick: () => { section = key; route(); }
    }, label);
    return h('div', { class: 'subnav' }, [
      btn('accounts', '👤 ' + T.set_section_accounts),
      btn('clinic', '🏥 ' + T.set_section_clinic),
      btn('updates', '⬇ ' + T.set_section_updates)
    ]);
  }

  function route() {
    if (unsubscribeUpdates) { unsubscribeUpdates(); unsubscribeUpdates = null; }
    const body = h('div', { class: 'settings-body' });
    mount(container, h('div', { class: 'view settings-view' }, [
      h('div', { class: 'view-head' }, [h('h2', { text: T.settings_title })]),
      nav(),
      body
    ]));
    if (section === 'accounts') renderAccounts(body);
    else if (section === 'clinic') renderClinic(body);
    else renderUpdates(body);
  }

  // ---- Clinic settings ----
  async function renderClinic(host) {
    mount(host, spinner(T.loading));
    const res = await window.api.config.get();
    const c = (res && res.clinic_name != null) ? res : (window.api.bootConfig || {});

    const name = h('input', { class: 'text-input', value: c.clinic_name || '' });
    const deployment = h('input', { class: 'text-input', value: c.deployment_label || '' });
    const startNum = h('input', { class: 'text-input', type: 'number', min: '1', value: c.patient_number_start || 1 });
    const langSelect = (val) => {
      const s = h('select', { class: 'text-input' }, [
        h('option', { value: 'en', text: T.lang_en }),
        h('option', { value: 'es', text: T.lang_es })
      ]);
      s.value = val || 'en';
      return s;
    };
    const uiLang = langSelect(c.ui_language);
    const reportLang = langSelect(c.report_language);
    const consentLang = langSelect(c.consent_language);

    async function save() {
      const res2 = await window.api.config.save({
        clinic_name: name.value.trim() || 'Mexico Clinic',
        deployment_label: deployment.value.trim(),
        patient_number_start: parseInt(startNum.value, 10) || 1,
        ui_language: uiLang.value,
        report_language: reportLang.value,
        consent_language: consentLang.value
      });
      if (!res2.ok) { toast(T.error, 'error'); return; }
      toast(T.settings_saved, 'success', 5000);
    }

    mount(host, h('div', { class: 'card settings-card' }, [
      h('h3', { class: 'card-title', text: T.clinic_settings }),
      h('div', { class: 'form-grid' }, [
        field(T.clinic_name_label, name),
        field(T.deployment_label_label, deployment),
        field(T.patient_number_start_label, startNum),
        field(T.ui_language_label, uiLang),
        field(T.report_language_label, reportLang),
        field(T.consent_language_label, consentLang)
      ]),
      h('div', { class: 'view-foot settings-foot' }, [
        h('button', { class: 'btn btn-primary', onClick: save }, '💾 ' + T.save_settings)
      ])
    ]));
  }

  // ---- Updates ----
  async function renderUpdates(host) {
    mount(host, spinner(T.loading));
    const [infoRes, availRes, stateRes] = await Promise.all([
      window.api.app.info(), window.api.update.available(), window.api.update.state()
    ]);
    const version = infoRes && infoRes.ok ? infoRes.data.version : '—';
    const available = !!(availRes && availRes.ok && availRes.data);

    const statusLine = h('div', { class: 'update-status muted' });
    const installBtn = h('button', { class: 'btn btn-secondary', onClick: async () => { await window.api.update.install(); } }, '↻ ' + T.install_restart);
    installBtn.style.display = 'none';
    const checkBtn = h('button', { class: 'btn btn-primary', onClick: async () => { await window.api.update.check(); } }, '🔄 ' + T.check_updates);

    function applyState(s) {
      if (!s) return;
      installBtn.style.display = s.status === 'downloaded' ? '' : 'none';
      const map = {
        idle: '',
        checking: T.update_checking,
        'up-to-date': T.update_up_to_date,
        available: T.update_available_msg.replace('{v}', s.version || ''),
        downloading: T.update_downloading.replace('{p}', s.percent || 0),
        downloaded: T.update_downloaded_msg.replace('{v}', s.version || ''),
        error: (s.error ? `${T.update_error_msg} (${s.error})` : T.update_error_msg)
      };
      statusLine.textContent = map[s.status] || '';
    }
    if (stateRes && stateRes.ok) applyState(stateRes.data);
    if (available) unsubscribeUpdates = window.api.update.onStatus(applyState);

    mount(host, h('div', { class: 'card settings-card' }, [
      h('h3', { class: 'card-title', text: T.updates_title }),
      h('div', { class: 'update-version' }, [
        h('span', { text: T.current_version + ': ' }),
        h('strong', { text: 'v' + version })
      ]),
      available
        ? h('div', {}, [
            h('div', { class: 'update-actions' }, [checkBtn, installBtn]),
            statusLine
          ])
        : h('div', { class: 'info-banner', text: T.updates_unavailable })
    ]));
  }

  route();
}
