'use strict';
'require view';

return view.extend({
  render() {
    return E('div', { class: 'ar-agent-page' }, [
      E('div', { class: 'ar-page-heading' }, E('h2', {}, 'AirRoute Agent')),
      E('section', { class: 'ar-panel' }, E('span', { class: 'ar-pill' }, _('Not installed')))
    ]);
  },
  handleSaveApply: null,
  handleSave: null,
  handleReset: null
});
