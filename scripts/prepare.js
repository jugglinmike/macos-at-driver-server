#!/usr/bin/env node
'use strict';

/**
 * Verify that the expected machine-generated assets are present in the local
 * directory. This script is intended to be executed prior to packaging the
 * project via the "prepare" npm life cycle script as a guard against invalid
 * releases.
 */

const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');

const buildDir = path.resolve(
  __dirname, '..', 'src/MacOSATDriverServer/Build/Debug'
);

(async () => {
  assert(
    (await fs.stat(buildDir)).isDirectory(),
    `Expected directory '${buildDir}' to exist`
  );
})();
