'use strict';
'require view';
'require rpc';
'require fs';
'require ui';

// Follow LuCI's vetted firmware upload and system.validate_firmware_image
// / sysupgrade --test path. No raw MTD writes, reset, backups, or --force.
const validateImage = rpc.declare({
  object: 'system', method: 'validate_firmware_image', params: [ 'path' ],
  expect: { '': { valid: false, allow_backup: false } }
});
const firmwarePath = '/tmp/firmware.bin';

return view.extend({
  load() {
    return L.resolveDefault(fs.stat('/lib/upgrade/platform.sh'), {});
  },

  handleUpload(ev) {
    const button = ev.currentTarget;
    button.disabled = true;

    return ui.uploadFile(firmwarePath)
      .then(async image => {
        ui.showModal(_('Checking firmware…'), [ E('p', { class: 'spinning' }, _('Validating compatibility with this device.')) ]);
        const validation = await validateImage(firmwarePath);
        const test = await fs.exec('/sbin/sysupgrade', [ '--test', firmwarePath ]);

        if (!validation.valid || test.code !== 0) {
          ui.showModal(_('Firmware not supported'), [
            E('p', { class: 'alert-message danger' }, _('The firmware cannot be safely installed on this device. Choose the matching MD or MF sysupgrade image.')),
            test.stderr ? E('pre', { class: 'ar-upgrade-error' }, test.stderr) : '',
            E('div', { class: 'ar-modal-actions' }, E('button', {
              class: 'btn', click: ui.createHandlerFn(this, 'cancelUpload')
            }, _('Close')))
          ]);
          return;
        }

        const canKeep = Boolean(validation.allow_backup);
        const keep = E('input', { type: 'checkbox', checked: canKeep, disabled: !canKeep });
        const confirm = [
          E('p', {}, _('The image passed compatibility checks. Confirm the checksum and start the upgrade. Do not disconnect power during flashing.')),
          E('div', { class: 'ar-upgrade-file' }, [
            E('strong', {}, image.name || _('Selected firmware')),
            E('small', {}, image.size ? `${(image.size / 1024 / 1024).toFixed(1)} MB` : '—'),
            image.sha256sum ? E('code', {}, `SHA256: ${image.sha256sum}`) : ''
          ]),
          E('label', { class: 'ar-upgrade-keep' }, [ keep, _('Keep current settings') ]),
          !canKeep ? E('p', { class: 'ar-muted' }, _('This image cannot preserve existing settings.')) : '',
          E('div', { class: 'ar-modal-actions' }, [
            E('button', { class: 'btn', click: ui.createHandlerFn(this, 'cancelUpload') }, _('Cancel')),
            E('button', {
              class: 'btn cbi-button-action important',
              click: ui.createHandlerFn(this, 'confirmUpgrade', keep)
            }, _('Install firmware'))
          ])
        ];
        ui.showModal(_('Confirm firmware upgrade'), confirm);
      })
      .catch(err => {
        ui.hideModal();
        if (!/cancel/i.test(err.message || ''))
          ui.addNotification(null, E('p', {}, err.message || _('Firmware upload failed.')));
      })
      .finally(() => { button.disabled = false; });
  },

  cancelUpload() {
    return fs.remove(firmwarePath).finally(ui.hideModal);
  },

  confirmUpgrade(keep) {
    ui.showModal(_('Installing firmware…'), [
      E('p', { class: 'spinning' }, _('Flashing in progress. Do not power off the device. The console will reconnect after reboot.'))
    ]);

    const args = keep.checked ? [ firmwarePath ] : [ '-n', firmwarePath ];
    // The sysupgrade process intentionally ends the web request when rebooting.
    fs.exec('/sbin/sysupgrade', args).catch(err => {
      ui.addNotification(null, E('p', {}, err.message || _('Firmware upgrade command failed.')));
    });
    if (keep.checked) ui.awaitReconnect(window.location.host);
    else ui.awaitReconnect(window.location.host, '192.168.1.1');
  },

  render(platform) {
    const available = platform?.type === 'file';
    return E('div', { class: 'ar-upgrade-page' }, [
      E('div', { class: 'ar-page-heading' }, [
        E('div', {}, [
          E('div', { class: 'ar-eyebrow' }, _('SYSTEM MAINTENANCE')),
          E('h2', {}, _('Firmware upgrade')),
          E('p', {}, _('Install a verified AirRelay OS firmware image.'))
        ])
      ]),
      E('section', { class: 'ar-panel ar-upgrade-panel' }, [
        E('span', { class: 'ar-upgrade-symbol', 'aria-hidden': 'true' }, '↑'),
        E('h3', {}, _('Upgrade AirRelay OS')),
        E('p', { class: 'ar-muted' }, _('Choose the sysupgrade image for this exact device model (XG-040G-MD or XG-040G-MF). The file is checked before installation.')),
        E('button', {
          class: 'btn cbi-button-action important ar-upgrade-button',
          disabled: !available || !L.hasViewPermission(),
          click: ui.createHandlerFn(this, 'handleUpload')
        }, _('Choose firmware…')),
        !available ? E('p', { class: 'alert-message warning' }, _('Firmware upgrade is unavailable in this boot environment.')) : ''
      ])
    ]);
  },

  handleSaveApply: null,
  handleSave: null,
  handleReset: null
});
