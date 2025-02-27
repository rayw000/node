'use strict';

const {
  ArrayPrototypeConcat,
  ArrayPrototypeSome,
  FunctionPrototypeBind,
  ObjectDefineProperty,
  ObjectKeys,
  ObjectPrototypeHasOwnProperty,
  RegExpPrototypeExec,
} = primordials;

const { validatePort } = require('internal/validators');

const kMinPort = 1024;
const kMaxPort = 65535;
const kInspectArgRegex = /--inspect(?:-brk|-port)?|--debug-port/;
const kInspectMsgRegex = /Debugger listening on ws:\/\/\[?(.+?)\]?:(\d+)\/|Debugger attached|Waiting for the debugger to disconnect\.\.\./;

let _isUsingInspector;
function isUsingInspector() {
  _isUsingInspector ??=
    ArrayPrototypeSome(process.execArgv, (arg) => RegExpPrototypeExec(kInspectArgRegex, arg) !== null) ||
    RegExpPrototypeExec(kInspectArgRegex, process.env.NODE_OPTIONS) !== null;
  return _isUsingInspector;
}

let debugPortOffset = 1;
function getInspectPort(inspectPort) {
  if (!isUsingInspector()) {
    return null;
  }
  if (typeof inspectPort === 'function') {
    inspectPort = inspectPort();
  } else if (inspectPort == null) {
    inspectPort = process.debugPort + debugPortOffset;
    if (inspectPort > kMaxPort)
      inspectPort = inspectPort - kMaxPort + kMinPort - 1;
    debugPortOffset++;
  }
  validatePort(inspectPort);

  return inspectPort;
}

let session;
function sendInspectorCommand(cb, onError) {
  const { hasInspector } = internalBinding('config');
  if (!hasInspector) return onError();
  const inspector = require('inspector');
  if (session === undefined) session = new inspector.Session();
  session.connect();
  try {
    return cb(session);
  } finally {
    session.disconnect();
  }
}

function isInspectorMessage(string) {
  return isUsingInspector() && RegExpPrototypeExec(kInspectMsgRegex, string) !== null;
}

// Create a special require function for the inspector command line API
function installConsoleExtensions(commandLineApi) {
  if (commandLineApi.require) { return; }
  const { tryGetCwd } = require('internal/process/execution');
  const CJSModule = require('internal/modules/cjs/loader').Module;
  const { makeRequireFunction } = require('internal/modules/cjs/helpers');
  const consoleAPIModule = new CJSModule('<inspector console>');
  const cwd = tryGetCwd();
  consoleAPIModule.paths = ArrayPrototypeConcat(
    CJSModule._nodeModulePaths(cwd),
    CJSModule.globalPaths
  );
  commandLineApi.require = makeRequireFunction(consoleAPIModule);
}

// Wrap a console implemented by Node.js with features from the VM inspector
function wrapConsole(consoleFromNode) {
  const { consoleCall, console: consoleFromVM } = internalBinding('inspector');
  for (const key of ObjectKeys(consoleFromVM)) {
    // If global console has the same method as inspector console,
    // then wrap these two methods into one. Native wrapper will preserve
    // the original stack.
    if (ObjectPrototypeHasOwnProperty(consoleFromNode, key)) {
      consoleFromNode[key] = FunctionPrototypeBind(
        consoleCall,
        consoleFromNode,
        consoleFromVM[key],
        consoleFromNode[key]
      );
      ObjectDefineProperty(consoleFromNode[key], 'name', {
        __proto__: null,
        value: key
      });
    } else {
      // Add additional console APIs from the inspector
      consoleFromNode[key] = consoleFromVM[key];
    }
  }
}

module.exports = {
  getInspectPort,
  installConsoleExtensions,
  isInspectorMessage,
  isUsingInspector,
  sendInspectorCommand,
  wrapConsole,
};
