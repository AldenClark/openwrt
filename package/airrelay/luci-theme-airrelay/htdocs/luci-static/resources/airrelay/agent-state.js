'use strict';
'require baseclass';
'require rpc';

const callServices = rpc.declare({ object: 'rc', method: 'list', params: [ 'name' ], expect: { '': {} } });

function classify(services) {
  if (!services || typeof services !== 'object' || Array.isArray(services))
    throw new Error(_('Unable to detect AirRoute Agent.'));
  const service = services['airroute-agent'];
  return { installed: !!service, enabled: service?.enabled === true,
    managed: !!service && (service.enabled === true || service.running === true) };
}

async function status() {
  return classify(await callServices('airroute-agent'));
}

async function assertManual() {
  if ((await status()).managed)
    throw new Error(_('AirRoute Agent is managing WireGuard. Refresh this page.'));
}

return baseclass.extend({ classify, status, assertManual });
