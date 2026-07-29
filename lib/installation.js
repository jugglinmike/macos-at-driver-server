'use strict';

const { exec: _exec } = require('child_process');
const fs = require('fs/promises');
const { resolve } = require('path');
const { promisify } = require('util');

const debug = require('debug')('install');

const { 'interaction.userIntent': userIntent } = require('./modules/interaction');

const LSREGISTER_EXECUTABLE_PATH =
  '/System/Library/Frameworks/CoreServices.framework/Versions/Current/Frameworks/LaunchServices.framework/Versions/Current/Support/lsregister';
const APPLICATION_NAME = 'MacOSATDriverServer.app';
const EXTENSION_IDENTIFIER = 'com.bocoup.MacOSATDriverServer.MacOSATDriverServerExtension';
const VOICE_IDENTIFIER =
  'com.bocoup.MacOSATDriverServer.MacOSATDriverServerExtension.MacOSATDriverServerExtension';
const SYSTEM_VOICE_IDENTIFIER = 'com.apple.Fred';
/**
 * This string comprises three tokens (the "type", "subtype", and
 * "manufacturer" of the Audio Unit) which must be kept in-sync with other
 * references in this project:
 *
 * - src/MacOSATDriverServer/MacOSATDriverServer/Model/AudioUnitHostModel.swift
 * - src/MacOSATDriverServer/MacOSATDriverServerExtension/Info.plist
 */
const PLUGIN_TRIPLET_IDENTIFIER = 'ausp atdg BOCU';
/**
 * From pluginkit(8):
 *
 * > All matching plug-ins are returned, one per line. Each line may begin with any one of the following tags indicating the user election state:
 * >     + indicates that the user has elected to use the plug-in
 * >     - indicates that the user has elected to ignore the plug-in
 * >     ! indicates that the user has elected to use the plug-in for debugger use
 * >     = indicates that the plug-in is superseded by another plug-in
 * >     ? unknown user election state
 */
const pluginkitFirstElementPattern = /^[+!=?-]?\s*([^\s(]+)\((.+)\)$/;

/**
 * Execute the "exec" method from the built-in `child_process` module. In the
 * event of failure due to the absence of the specified current working
 * directory, provide a meaningful error description.
 *
 * @param {string} command
 * @param {ExecOptions} [options]
 */
const exec = async (command, options) => {
  try {
    return await promisify(_exec)(command, options);
  } catch (error) {
    const cwd = options?.cwd || process.cwd();
    const cwdExists = !!(await fs.stat(cwd).catch(() => null));

    if (error.code === 'ENOENT' && !cwdExists) {
      throw new Error(`Cannot access directory: ${cwd}`, { cause: error });
    }

    throw error;
  }
};
const enableKeyAutomationPrompt = `This tool can only be installed on systems which allow automated key pressing.
Please allow the Terminal application to control your computer (the setting is
controlled in System Settings > Privacy & Security > Accessibility).`;

/** @typedef {import('child_process').ExecOptions} ExecOptions */

/**
 * Prompt the user to press any key. Resolves when the user presses a key.
 *
 * @returns {Promise<void>}
 */
const promptForManualKeyPress = async () => {
  process.stdout.write('Press any key to continue... ');
  const wasRaw = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  const byteArray = await new Promise(resolve => {
    process.stdin.once('data', data => resolve(Array.from(data)));
  });

  process.stdin.pause();
  process.stdin.setRawMode(wasRaw);
  process.stdout.write('\n');

  // Honor "Control + C" motion by exiting.
  if (byteArray[0] === 3) {
    process.exit(1);
  }
};

/**
 * @param {object} options
 * @param {boolean} options.unattended - Whether installation should fail if
 *                                       human intervention is required
 *
 * @returns {Promise<void>}
 */
exports.install = async function ({ unattended }) {
  const options = await getExecOptions();

  if (!(await canPressKeys())) {
    if (unattended) {
      throw new Error('The system cannot automate key pressing.');
    } else {
      console.error(enableKeyAutomationPrompt);

      await promptForManualKeyPress();

      if (!(await canPressKeys())) {
        throw new Error('The system cannot automate key pressing.');
      }
    }
  }

  const plugins = await listPlugins();

  debug(`Found ${plugins.length} plugin(s)`);

  if (plugins.length) {
    return console.log('Already installed.');
  }

  await removeQuarantine(options);
  await registerExtensions(options);
  await enableExtension();
  await setSystemVoice(VOICE_IDENTIFIER);
  console.log('Installation completed successfully.');
};

/**
 * Uninstall the driver. Since installations occupy space in a global registry,
 * the installation status may be complicated by the presence of prior
 * releases. The `whenMany` parameter (exposed to end users via the
 * `--when-many` command-line argument) attempts to assist recovery from such
 * states.
 *
 * @param {object} options
 * @param {"local"|"all"} [options.whenMany] - Whether (and how) to tolerate
 *                                             the case that more than one
 *                                             version of the plugin is present
 *                                             on the system.
 * @returns {Promise<void>}
 */
exports.uninstall = async function ({ whenMany }) {
  const options = await getExecOptions();
  const plugins = await listPlugins();

  debug(`Found ${plugins.length} plugin(s)`);

  if (!plugins.length) {
    throw new Error('Not installed');
  }

  if (plugins.length > 1 && !whenMany) {
    throw new Error(
      `Found ${plugins.length} installations. Use the \`--when-many\` ` +
        `argument to handle this condition.`,
    );
  }

  let toUninstall;

  if (whenMany === 'local') {
    toUninstall = plugins.filter(plugin => plugin.location.startsWith(options.cwd.toString()));
    if (!toUninstall.length) {
      throw new Error('Local installation not found.');
    }
  } else {
    toUninstall = plugins;
  }

  await setSystemVoice(SYSTEM_VOICE_IDENTIFIER);

  for (const plugin of plugins) {
    const parts = plugin.location.split(APPLICATION_NAME);
    if (parts.length !== 2) {
      throw new Error(`Unsupported installation path: '${plugin.location}'`);
    }

    await unregisterExtensions({ cwd: parts[0] });
  }

  return;
};

/**
 * Experimentally determine whether the current system supports automated key
 * pressing by attempting to press an arbitrary key.
 *
 * @returns {Promise<boolean>}
 */
const canPressKeys = async () => {
  try {
    await userIntent(null, { name: 'pressKeys', keys: ['shift'] });
  } catch ({}) {
    return false;
  }
  return true;
};

/**
 * The output of `pluginkit` is poorly-documented, so this function parses that
 * output strictly according to the apparent structure as of July 2026. It is
 * intended to fail in the presence of any changes to the structure because in
 * the absence of a formal contract, such changes could reflect any number of
 * incompatibilities that should be reviewed by a maintainer.
 *
 */
const listAllPlugins = async function () {
  const { stdout } = await exec('pluginkit -mvAD');

  return Promise.all(
    stdout
      .split('\n')
      // Ignore empty lines
      .filter(line => !!line)
      // Ignore final line of output
      .filter(line => !/^\s*\(\d+ plug-ins\)$/.test(line))
      .map(async line => {
        const [firstElement, uuid, date, location, ...rest] = line.split('\t');

        if (rest.length) {
          throw new TypeError(`Encountered unexpected trailing output: "${line}"`);
        }
        const match = pluginkitFirstElementPattern.exec(firstElement);

        if (!match) {
          throw new TypeError(`Encountered unexpected identifier: "${line}"`);
        }
        const [, identifier, version] = match;

        if (!(await fs.stat(location)).isDirectory()) {
          throw new TypeError(`Encountered non-existent directory: "${line}"`);
        }

        return { identifier, version, uuid, date, location };
      }),
  );
};

/**
 * Export the function so it can be executed in the project's test suite. While
 * the set of available plugins is system-dependent, simply invoking the
 * function will help to surface new incompatibilities in future release of
 * macOS.
 */
exports._listAllPlugins = listAllPlugins;

const listPlugins = async function () {
  return (await listAllPlugins()).filter(({ identifier }) => identifier === EXTENSION_IDENTIFIER);
};

/**
 * @returns {Promise<ExecOptions>}
 */
const getExecOptions = async function () {
  return {
    cwd: resolve(__dirname, '../src/MacOSATDriverServer/Build/Debug'),
  };
};

/**
 * Remove the "quarantine" attribute which macOS uses to prevent accidental
 * execution of code from unverified sources.
 *
 * https://support.apple.com/en-us/101987
 *
 * @param {ExecOptions} options
 * @returns {Promise<boolean>} Whether a change took place
 */
async function removeQuarantine(options) {
  debug('Removing macOS quarantine');
  await exec(`xattr -r -d com.apple.quarantine ${APPLICATION_NAME}`, options);
  return true;
}

/**
 * @param {ExecOptions} options
 * @returns {Promise<void>}
 */
async function registerExtensions(options) {
  debug('Registering trusted macOS extension');
  await exec(`${LSREGISTER_EXECUTABLE_PATH} -f -R -trusted ${APPLICATION_NAME}`, options);
}

/**
 * @param {ExecOptions} options
 * @returns {Promise<void>}
 */
async function unregisterExtensions(options) {
  debug('Unregistering trusted macOS extension');
  await exec(`${LSREGISTER_EXECUTABLE_PATH} -u ${APPLICATION_NAME}`, options);
}

async function enableExtension() {
  debug('Enabling macOS extension');
  await exec(`pluginkit -e use -i ${EXTENSION_IDENTIFIER}`);
}

/**
 * @param {string} newValue the identifier for the voice to set
 * @returns {Promise<void>}
 */
async function setSystemVoice(newValue) {
  debug(`Setting macOS system voice to "${newValue}"`);
  let stdout;

  try {
    ({ stdout } = await exec(
      'defaults read com.apple.Accessibility SpeechVoiceIdentifierForLanguage',
    ));
  } catch (error) {
    if (!error || !error.stderr.includes('does not exist')) {
      throw error;
    }
  }

  const currentValue = stdout ? stdout.replace(/[\s]/g, '').match(/2={en="([^"]+)";};/) : null;

  debug(`Current value: ${currentValue ? JSON.stringify(currentValue[1]) : '(unset)'}`);

  if (currentValue && currentValue[1] === newValue) {
    debug('Already set.');
    return;
  }

  await exec(
    `defaults write com.apple.Accessibility SpeechVoiceIdentifierForLanguage '{2 = {en = "${newValue}";};}'`,
  );
}
