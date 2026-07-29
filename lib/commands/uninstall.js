'use strict';

const installation = require('../installation');

module.exports = /** @type {import('yargs').CommandModule} */ ({
  command: 'uninstall',
  describe: 'Uninstall text to speech extension and other support',
  builder(yargs) {
    return yargs.option('when-many', {
      desc: 'How to respond when more than one instance of the extension is present (the default behavior is to fail)',
      choices: ['local', 'all'],
    });
  },
  async handler({ whenMany }) {
    await installation.uninstall({ whenMany });

    console.log('Uninstallation completed successfully.');
  },
});
