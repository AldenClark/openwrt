'use strict';
'require view';

return view.extend({
  render() {
    return E('div', { class: 'ar-agent-page' }, [
      E('div', { class: 'ar-page-heading' }, [
        E('div', {}, [
          E('div', { class: 'ar-eyebrow' }, _('CONTROL PLANE')),
          E('h2', {}, 'AirRoute Agent'),
          E('p', {}, _('Cloud registration, configuration sync and live status will appear here.'))
        ])
      ]),
      E('section', { class: 'ar-panel ar-agent-hero' }, [
        E('div', { class: 'ar-agent-symbol', 'aria-hidden': 'true' }, '✧'),
        E('span', { class: 'ar-pill' }, _('Not installed')),
        E('h3', { style: 'margin-top:16px' }, _('One node, one lightweight Agent')),
        E('p', {}, _('The Rust Agent will register this node, receive control-plane changes, and configure kernel WireGuard and forwarding. Packet forwarding does not pass through the Agent.')),
        E('ul', { class: 'ar-list' }, [
          E('li', {}, _('Secure device enrollment and controller connection')),
          E('li', {}, _('Sync WireGuard peers, routes and network policy')),
          E('li', {}, _('Report heartbeats, link quality, traffic and resources')),
          E('li', {}, _('Apply configuration atomically with rollback'))
        ])
      ]),
      E('div', { class: 'ar-notice' },
        _('This page is a placeholder. It does not imply that the Agent is installed, connected or running. Kernel WireGuard works independently.'))
    ]);
  },

  handleSaveApply: null,
  handleSave: null,
  handleReset: null
});
