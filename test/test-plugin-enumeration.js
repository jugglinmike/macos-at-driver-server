'use strict';
const assert = require('assert');

const { _listAllPlugins } = require('../lib/installation');

suite('_listAllPlugins', () => {
  test('validity of enumeration', async () => {
    const plugins = await _listAllPlugins();

    assert(plugins.length > 0, 'Identifies at least one plugin');

    for (let idx = 0; idx < plugins.length; idx += 1) {
      const plugin = plugins[idx];
      const idString = `(plugin #${idx} of ${plugins.length})`;

      assert.equal(typeof plugin.identifier, 'string', `identifier ${idString}`);
      assert.equal(typeof plugin.version, 'string', `version ${idString}`);
      assert.equal(typeof plugin.uuid, 'string', `uuid ${idString}`);
      assert.equal(typeof plugin.date, 'string', `date ${idString}`);
      assert.equal(typeof plugin.location, 'string', `location ${idString}`);
    }
  });
});
