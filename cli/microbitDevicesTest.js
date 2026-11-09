/* No USB hardware or native serialport bindings required. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');
function load(relative, mocks = {}, globals = {}) {
    const filename = path.resolve(__dirname, '..', relative);
    const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018, esModuleInterop: true },
        fileName: filename, reportDiagnostics: true,
    });
    assert.deepStrictEqual(result.diagnostics, []);
    const module = { exports: {} };
    vm.runInNewContext(result.outputText, {
        module, exports: module.exports, Buffer, Set, console,
        require: id => Object.prototype.hasOwnProperty.call(mocks, id) ? mocks[id] : require(id),
        ...globals,
    }, { filename });
    return module.exports;
}
const devices = load('app/src/main/core/serial/microbitDevices.ts');
const a = '990636020005282024DE7068953428F0000000006E052820';
const b = '990636020005282045F0227BE5DC3934000000006E052820';
const usb = serial => `USB\\VID_0D28&PID_0204\\${serial}`;
const redirected = serial => `TS_USB\\VID_0D28&PID_0204\\TS_${serial}`;
const portId = 'USB\\VID_0D28&PID_0204&MI_01\\7&123&0&0001';
const snapshot = { devices: [usb(a), redirected(b), usb(a).toLowerCase()], ports: [
    { instanceId: portId, ancestors: [usb(a)] },
] };
const ports = [{ path: 'COM22', pnpId: portId }];
let result = devices.buildMicrobitDevices(snapshot, ports);
assert.strictEqual(result.length, 2);
assert.strictEqual(result[0].displayName, 'microbit (953428F0)');
assert.strictEqual(result[1].displayName, 'microbit (E5DC3934)');
assert.strictEqual(result[0].comPath, 'COM22');
assert.strictEqual(result[1].comPath, undefined);
assert.ok(result[1].connectionError);
assert.strictEqual(devices.serialFromInstance(portId), undefined);
assert.strictEqual(devices.serialFromInstance('USB\\VID_1234&PID_0204\\12345678'), undefined);
assert.strictEqual(devices.serialFromInstance(usb('9900000012345678')), '9900000012345678');
assert.strictEqual(devices.serialFromInstance(usb('7&ABCD&0')), undefined);
assert.strictEqual(devices.buildMicrobitDevices(snapshot, [{ path: 'COM99', pnpId: portId }])[0].path, result[0].path);
assert.strictEqual(devices.buildMicrobitDevices(snapshot, [{ path: 'COM99', pnpId: portId }])[0].comPath, 'COM99');
assert.ok(devices.buildMicrobitDevices(snapshot, [...ports, { path: 'COM23', pnpId: portId }])[0].connectionError);
assert.ok(devices.buildMicrobitDevices(snapshot, [{ path: 'COM22' }])[0].connectionError);
assert.strictEqual(devices.buildMicrobitDevices({ devices: [], ports: [] }, ports).length, 0);
const collision = '990636020005282024DE7068953428F0000000006E052821';
result = devices.buildMicrobitDevices({ devices: [usb(a), usb(collision)], ports: [] }, []);
assert.strictEqual(result[0].displayName, `microbit (${a})`);
assert.strictEqual(result[1].displayName, `microbit (${collision})`);
assert.ok(devices.buildMicrobitDevices({ ...snapshot, devices: [usb(a), redirected(a)] }, ports)[0].connectionError);
assert.ok(devices.buildMicrobitDevices({ ...snapshot, ports: [
    { instanceId: portId, ancestors: ['TS_USB_HUB_ENUMERATOR\\X', usb(a)] },
] }, ports)[0].connectionError);

// Exercise actual scanner branches: blocked devices must never reach electPort.
async function scanTest(selection, platform = 'win32', moduleName = 'microbit2.js', fail = false) {
    const opened = [];
    const events = [];
    const Scanner = load('app/src/main/core/serial/scanner.ts', {
        '../rendererConsole': { log() {} },
        serialport: { list: async () => { if (fail) { throw new Error('COM enumeration failed'); } return ports; } },
        './electPortFunction': async candidates => { opened.push(...candidates); },
        '../../../common/constants': { CloudModeTypes: { cloud: 'cloud' } },
        '../baseScanner': class { constructor(router) { this.router = router; } },
        '../../electron/functions/createLogger': () => ({ verbose() {}, info() {}, warn() {} }),
        './flasher': class {},
        './microbitDevices': { ...devices, readMicrobitSnapshot: async () => {
            if (fail) { throw new Error('PowerShell unavailable'); }
            return snapshot;
        } },
    }, { process: { platform } }).default;
    const scanner = new Scanner({ selectedPort: selection, sendEventToMainWindow: (...args) => events.push(args) });
    scanner.config = { module: moduleName, hardware: { type: 'serial' }, selectPort: true };
    scanner.hwModule = {};
    scanner.isScanning = true;
    await scanner.scan();
    return { opened, events };
}
(async () => {
    assert.deepStrictEqual((await scanTest(`microbit:${a}`)).opened, []);
    assert.deepStrictEqual((await scanTest('COM22')).opened, ['COM22']);
    assert.deepStrictEqual((await scanTest('COM22', 'win32', 'microbit2.js', true)).opened, []);
    assert.deepStrictEqual((await scanTest('COM99')).opened, []);
    for (const selection of [undefined, `microbit:${b}`, 'microbit:missing']) {
        const scan = await scanTest(selection);
        assert.deepStrictEqual(scan.opened, []);
        assert.strictEqual(scan.events[0][1].length, 1);
        assert.strictEqual(scan.events[0][1][0].path, 'COM22');
    }
    const failure = await scanTest(`microbit:${a}`, 'win32', 'microbit2.js', true);
    assert.deepStrictEqual(failure.opened, []);
    assert.ok(failure.events[0][1][0].connectionError);
    assert.ok(failure.events[0][1][0].displayName.includes('COM enumeration failed'));
    assert.deepStrictEqual((await scanTest('COM22', 'darwin')).opened, []);
    assert.deepStrictEqual((await scanTest('COM22', 'win32', 'other.js')).opened, ['COM22']);
    console.log('PASS: microbit identity, labels, mapping, fail-closed scanner and legacy paths');
})().catch(error => { console.error(error); process.exitCode = 1; });

const macSerial = '990636020005282083A474A7828EF1B5000000006E052820';
const winPort = { path: 'COM22', vendorId: '0d28', productId: '0204', serialNumber: a.toLowerCase() };
const winDevices = devices.buildWindowsMicrobitPorts([winPort, { path: 'COM23' }]);
assert.strictEqual(winDevices[0].path, 'COM22');
assert.strictEqual(winDevices[0].displayName, 'microbit (953428F0)');
assert.strictEqual(winDevices[1].displayName, 'COM23');
assert.ok(!winDevices[1].connectionError);
assert.strictEqual(devices.buildWindowsMicrobitPorts([{ path: 'COM24', pnpId: usb(a) }])[0].displayName, 'microbit (953428F0)');
assert.strictEqual(devices.buildWindowsMicrobitPorts([{ ...winPort, serialNumber: '7&123&0' }])[0].displayName, 'COM22');
assert.notStrictEqual(devices.buildWindowsMicrobitPorts([winPort, { ...winPort, path: 'COM25', serialNumber: collision }])[0].displayName,
    devices.buildWindowsMicrobitPorts([winPort, { ...winPort, path: 'COM25', serialNumber: collision }])[1].displayName);
const macPort = { path: '/dev/tty.usbmodem11402', vendorId: '0d28', productId: '0204', serialNumber: macSerial.toLowerCase() };
const macDevices = devices.buildMacMicrobitDevices([macPort, { path: '/dev/tty.other' }]);
assert.strictEqual(macDevices.length, 1);
assert.strictEqual(macDevices[0].displayName, 'microbit (828EF1B5)');
assert.strictEqual(macDevices[0].comPath, macPort.path);
assert.strictEqual(devices.buildMacMicrobitDevices([{ ...macPort, path: '/dev/tty.new' }])[0].path, macDevices[0].path);
assert.ok(devices.buildMacMicrobitDevices([macPort, { ...macPort, path: '/dev/tty.ambiguous' }])[0].connectionError);
