'use strict';
'require view';
'require form';
'require uci';
'require ui';
'require airrelay.system as systemManager';
'require airrelay.agent-state as agentState';
'require airrelay.wg-config as wgConfig';

return view.extend({
  load() {
    return Promise.all([uci.load('network'), uci.load('firewall'),
      agentState.status().catch(() => null)]);
  },

  render([_network, _firewall, agent]) {
    const map = new form.Map('network', _('Network interfaces'));
    map.readonly = !L.hasViewPermission();
    this._networkMap = map;

    const section = map.section(form.NamedSection, 'lan', 'interface');
    section.addremove = false;
    section.anonymous = true;

    let option = section.option(form.ListValue, 'proto', _('IPv4 address mode'));
    option.value('dhcp', _('Automatic (DHCP client)'));
    option.value('static', _('Static IPv4'));
    option.rmempty = false;
    option.default = 'dhcp';

    option = section.option(form.Value, 'ipaddr', _('IPv4 address'));
    option.datatype = 'ip4addr';
    option.rmempty = false;
    option.placeholder = '192.168.1.20';
    option.depends('proto', 'static');

    option = section.option(form.Value, 'netmask', _('Subnet mask'));
    option.datatype = 'ip4addr';
    option.default = '255.255.255.0';
    option.rmempty = false;
    option.depends('proto', 'static');

    option = section.option(form.Value, 'gateway', _('Default gateway'));
    option.datatype = 'ip4addr';
    option.placeholder = '192.168.1.1';
    option.rmempty = true;
    option.depends('proto', 'static');

    option = section.option(form.DynamicList, 'dns', _('DNS servers'));
    option.datatype = 'ip4addr';
    option.rmempty = true;
    option.depends('proto', 'static');

    option = section.option(form.DummyValue, '_apply', ' ');
    option.renderWidget = () => this.renderApplyButton();

    return Promise.all([map.render(), agent && !agent.managed ? wgConfig.render() : Promise.resolve(null)]).then(([node, wireguard]) => {
      return E('div', { class: 'ar-settings-page' }, [
        E('div', { class: 'ar-page-heading' }, E('h2', {}, _('Settings'))),
        node,
        wireguard || (agent ? '' : E('p', { class: 'ar-muted' }, _('Unable to detect AirRoute Agent.'))),
        systemManager.render()
      ]);
    });
  },

  handleApply(ev) {
    // Keep LuCI's confirmed apply / automatic rollback path, with no
    // unchecked-apply dropdown or separate save/reset actions.
    return this._networkMap.save().then(() => ui.changes.apply(true));
  },

  renderApplyButton() {
    return E('button', {
      class: 'btn cbi-button cbi-button-apply important',
      disabled: L.hasViewPermission() ? null : true,
      click: ui.createHandlerFn(this, 'handleApply')
    }, _('Save & Apply'));
  },

  addFooter() {
    return E([]);
  }
});
