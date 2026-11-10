'use strict';
'require view';
'require form';
'require uci';

return view.extend({
  load() {
    return uci.load('network');
  },

  render() {
    const map = new form.Map('network', _('管理上联'),
      _('仅配置节点自身的管理连接。四个以太网端口继续由 br-lan 桥接；本机不会提供 DHCP 服务。'));
    map.readonly = !L.hasViewPermission();

    const section = map.section(form.NamedSection, 'lan', 'interface', _('br-lan · 管理接口'));
    section.addremove = false;
    section.anonymous = true;

    let option = section.option(form.DummyValue, '_device', _('设备'));
    option.cfgvalue = () => 'br-lan（LAN1–LAN4）';

    option = section.option(form.ListValue, 'proto', _('IPv4 地址获取方式'));
    option.value('dhcp', _('自动获取（DHCP 客户端）'));
    option.value('static', _('静态 IPv4'));
    option.rmempty = false;
    option.default = 'dhcp';

    option = section.option(form.Value, 'ipaddr', _('IPv4 地址'));
    option.datatype = 'ip4addr';
    option.rmempty = false;
    option.placeholder = '192.168.1.20';
    option.depends('proto', 'static');

    option = section.option(form.Value, 'netmask', _('子网掩码'));
    option.datatype = 'ip4addr';
    option.default = '255.255.255.0';
    option.rmempty = false;
    option.depends('proto', 'static');

    option = section.option(form.Value, 'gateway', _('默认网关'));
    option.datatype = 'ip4addr';
    option.placeholder = '192.168.1.1';
    option.rmempty = true;
    option.depends('proto', 'static');

    option = section.option(form.DynamicList, 'dns', _('DNS 服务器'));
    option.datatype = 'ip4addr';
    option.rmempty = true;
    option.depends('proto', 'static');

    return map.render().then(node => E('div', { class: 'ar-network-page' }, [
      E('div', { class: 'ar-page-heading' }, [
        E('div', {}, [
          E('div', { class: 'ar-eyebrow' }, 'UPLINK CONFIGURATION'),
          E('h2', {}, '网络设置'),
          E('p', {}, '设备上联、管理 IP 与 WireGuard 接口')
        ])
      ]),
      E('div', { class: 'ar-notice' }, [
        E('strong', {}, '连接保护：'),
        '更改管理 IP 后浏览器可能暂时失联。请通过 LuCI 的“保存并应用”确认配置，或等待自动回滚。'
      ]),
      node,
      E('section', { class: 'ar-panel', style: 'margin-top:22px' }, [
        E('h3', {}, 'WireGuard'),
        E('p', { class: 'ar-panel-subtitle' },
          'WireGuard 运行在 Linux 内核。当前可通过 OpenWrt 原生网络接口页维护隧道；未来由 AirRoute Agent 从云端同步。'),
        E('div', { class: 'ar-actions' }, [
          E('a', { class: 'ar-button', href: L.url('admin/network/network') }, '高级接口管理'),
          E('a', { class: 'ar-button', href: L.url('admin/airrelay/agent') }, 'Agent 接入计划')
        ])
      ])
    ]));
  }
});
