#!/bin/bash

set -ex

# Source:
# https://stackoverflow.com/questions/59895/how-do-i-get-the-directory-where-a-bash-script-is-located-from-within-the-script
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

cd $SCRIPT_DIR/../src/MacOSATDriverServer

xcodebuild clean

echo ::group::Build output for MacOSATDriverServer

xcodebuild \
  -project MacOSATDriverServer.xcodeproj/ \
  -arch arm64 \
  -scheme MacOSATDriverServer \
  -configuration Debug

echo ::endgroup::

echo ::group::Build output for MacOSATDriverServerExtension

xcodebuild \
  -project MacOSATDriverServer.xcodeproj/ \
  -arch arm64 \
  -scheme MacOSATDriverServerExtension \
  -configuration Debug

echo ::endgroup::

echo ::group::Build output for MacOSATDriverServerService

xcodebuild \
  -project MacOSATDriverServer.xcodeproj/ \
  -arch arm64 \
  -scheme MacOSATDriverServerService \
  -configuration Debug

echo ::endgroup::
