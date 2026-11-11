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
  handleUpload() {
    // Do not gate the file picker on a best-effort filesystem stat or the
    // frontend view permission hint. The upload RPC enforces authorization,
    // and validate_firmware_image + sysupgrade --test enforce compatibility.
    // An unavailable stat must never silently disable the only page action.
    return ui.uploadFile(firmwarePath)
      .then(async image => {
        ui.showModal(_('Checking firmware…'), [ E('p', { class: 'spinning' }, _('Validating compatibility with this device.')) ]);
        const validation = await validateImage(firmwarePath);
        const test = await fs.exec('/sbin/sysupgrade', [ '--test', firmwarePath ]);

        if (validation.valid !== true || test.code !== 0) {
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
          E('p', { class: 'ar-muted' }, _('Without preserved settings, the management IP may change because AirRelay OS obtains its address via DHCP.')),
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
        if (!/cancel|取消/i.test(err.message || '')) {
          // The upload may have completed before the validation RPC failed.
          // Release the firmware-sized tmpfs allocation on that path.
          fs.remove(firmwarePath).catch(() => {});
          ui.addNotification(null, E('p', {}, err.message || _('Firmware upload failed.')));
        }
      });
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
    fs.exec('/sbin/sysupgrade', args).then(result => {
      if (result.code !== 0)
        ui.showModal(_('Firmware upgrade command failed.'), [
          E('p', { class: 'alert-message danger' }, result.stderr || _('Firmware upgrade command failed.')),
          E('div', { class: 'ar-modal-actions' }, E('button', {
            class: 'btn', click: ui.createHandlerFn(this, 'cancelUpload')
          }, _('Close')))
        ]);
    }).catch(err => {
      // A successful flash closes the RPC connection. Only a definite access
      // failure proves that sysupgrade was not started.
      if (/access denied|permission denied/i.test(err.message || ''))
        ui.showModal(_('Firmware upgrade command failed.'), [
          E('p', { class: 'alert-message danger' }, err.message)
        ]);
    });
    // A clean upgrade may change the management address (DHCP, not 192.168.1.1).
    ui.awaitReconnect(window.location.host);
  },

  render() {
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
          click: ui.createHandlerFn(this, 'handleUpload')
        }, _('Choose firmware…'))
      ])
    ]);
  },

  handleSaveApply: null,
  handleSave: null,
  handleReset: null
});
