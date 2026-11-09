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
const devices = load('app/src/main/core/serial/microbitDevices.ts', {
    child_process: { execFile() { throw new Error('COM discovery must not launch PowerShell'); } },
});
const a = '990636020005282024DE7068953428F0000000006E052820';
const b = '990636020005282045F0227BE5DC3934000000006E052820';
const usb = serial => `USB\\VID_0D28&PID_0204\\${serial}`;
const portId = 'USB\\VID_0D28&PID_0204&MI_01\\7&123&0&0001';
const ports = [{ path: 'COM22', pnpId: portId }];
const collision = '990636020005282024DE7068953428F0000000006E052821';
assert.strictEqual(devices.serialFromInstance(portId), undefined);
assert.strictEqual(devices.serialFromInstance(usb(a)), a);
assert.strictEqual(devices.serialFromInstance(usb('7&ABCD&0')), undefined);

// Exercise actual scanner branches: blocked devices must never reach electPort.
async function scanTest(selection, platform = 'win32', moduleName = 'microbit2.js', fail = false, options = {}) {
    const opened = [];
    const events = [];
    let listCalls = 0;
    const Scanner = load('app/src/main/core/serial/scanner.ts', {
        '../rendererConsole': { log() {} },
        serialport: { list: async () => {
            if (fail) { throw new Error('COM enumeration failed'); }
            const lists = options.portLists || [ports];
            return lists[Math.min(listCalls++, lists.length - 1)];
        } },
        './electPortFunction': async candidates => { opened.push(...candidates); },
        '../../../common/constants': { CloudModeTypes: { cloud: 'cloud' } },
        '../baseScanner': class { constructor(router) { this.router = router; } },
        '../../electron/functions/createLogger': () => ({ verbose() {}, info() {}, warn() {} }),
        './flasher': class {},
        './microbitDevices': devices,
        './windowsMicrobitIdentity': { readWindowsMicrobitIdentity: async () => {
            if (options.identityFails) throw Object.assign(new Error('Native helper failed'), { code: 'ETIMEDOUT' });
            return { nodes: options.nodes || [] };
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
    assert.deepStrictEqual((await scanTest('COM22', 'win32', 'microbit2.js', false,
        { portLists: [ports, []] })).opened, []);
    assert.deepStrictEqual((await scanTest('COM22', 'win32', 'microbit2.js', false,
        { identityFails: true })).opened, ['COM22']);
    const studentScan = await scanTest(undefined, 'win32', 'microbit2.js', false,
        { portLists: [studentPorts], nodes: [...ownNodes, ...roots] });
    assert.strictEqual(studentScan.events[0][1][0].displayName, 'microbit (B6284873)');
    assert.strictEqual(studentScan.events[0][1][1].displayName, 'microbit (E5DC3934)');
    assert.deepStrictEqual((await scanTest('COM31', 'win32', 'microbit2.js', false,
        { portLists: [studentPorts], nodes: [...ownNodes, ...roots] })).opened, ['COM31']);
    console.log('PASS: COM labels, direct COM connection, missing COM rejection and legacy paths');
})().catch(error => { console.error(error); process.exitCode = 1; });

const macSerial = '990636020005282083A474A7828EF1B5000000006E052820';
const winPort = { path: 'COM22', vendorId: '0d28', productId: '0204', serialNumber: a.toLowerCase() };
const winDevices = devices.buildWindowsMicrobitPorts([winPort, { path: 'COM23' }]);
// An unregistered board in the same family must work without an inventory lookup.
const newSerial = '990636020005282012345678ABCDEF12000000006E052820';
assert.strictEqual(devices.windowsBoardSerial(newSerial.toLowerCase()), newSerial);
assert.strictEqual(devices.windowsBoardSerial('880000' + newSerial.slice(6)), undefined);
assert.strictEqual(devices.windowsBoardSerial(newSerial.slice(0, -1)), undefined);
assert.strictEqual(devices.buildWindowsMicrobitPorts([{ ...winPort, serialNumber: newSerial }])[0].displayName,
    'microbit (ABCDEF12)');
assert.strictEqual(devices.buildWindowsMicrobitPorts([{ path: 'COM26',
    pnpId: `TS_USB\\VID_0D28&PID_0204\\TS_${newSerial}`,
}])[0].displayName, 'microbit (ABCDEF12)');
assert.strictEqual(winDevices[0].path, 'COM22');
assert.strictEqual(winDevices[0].displayName, 'microbit (953428F0)');
assert.strictEqual(winDevices[1].displayName, 'COM23');
assert.ok(!winDevices[1].connectionError);
for (const invalid of ['SESSIONID4', '7&123&0&SESSIONID4', 'DEADBEEF', `${a}&SESSIONID4`, `${a}SESSIONID4`]) {
    const item = devices.buildWindowsMicrobitPorts([{ ...winPort, serialNumber: invalid }])[0];
    assert.strictEqual(item.displayName, 'COM22');
    assert.strictEqual(item.serialNumber, undefined);
    assert.strictEqual(item.path, 'COM22');
    assert.ok(!item.connectionError);
}
assert.strictEqual(devices.buildWindowsMicrobitPorts([{ ...winPort,
    serialNumber: 'SESSIONID4', pnpId: `USB\\VID_0D28&PID_0204&MI_01\\${a}`,
}])[0].serialNumber, a);
assert.strictEqual(devices.buildWindowsMicrobitPorts([{ ...winPort, pnpId: usb(b) }])[0].serialNumber, undefined);
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

// Actual student COM IDs: neither contains a board serial. Only OS-provided
// relationships may connect these IDs to the TS_USB root board instances.
const studentIds = [
    'USB\\VID_0D28&PID_0204&MI_01\\4&74D80D8&0&SESSION4-3735928574&2&4E95264B-3A72-4237-B66C-F326FD60D739',
    'USB\\VID_0D28&PID_0204&MI_01\\4&244D5CD5&0&SESSION4-3735928574&3&BA1B13E3-50B8-403B-B44F-16B38CE31B42',
];
const studentSerials = ['9906360200052820D87671F8B6284873000000006E052820', b];
const containers = ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'];
const studentPorts = studentIds.map((pnpId, i) => ({ path: `COM${30 + i}`, pnpId, serialNumber: `SESSION${i}` }));
const roots = studentSerials.map((serial, i) => ({
    instanceId: `TS_USB\\VID_0D28&PID_0204\\TS_${serial}`, containerId: containers[i], isPort: false,
}));
const ownNodes = studentIds.map((instanceId, i) => ({ instanceId, containerId: containers[i], isPort: true }));
const assertStudentLabels = nodes => {
    // Deliberately reverse enumeration order to rule out index-based pairing.
    const result = devices.buildWindowsMicrobitPorts(studentPorts, [...nodes].reverse());
    assert.strictEqual(result[0].displayName, 'microbit (B6284873)');
    assert.strictEqual(result[1].displayName, 'microbit (E5DC3934)');
    assert.strictEqual(result[0].path, 'COM30');
    assert.strictEqual(result[1].path, 'COM31');
};
assertStudentLabels([...ownNodes, ...roots]);
assertStudentLabels([...ownNodes.map((node, i) => ({ ...node, containerId: undefined, parentId: roots[i].instanceId })), ...roots]);
for (const nodes of [[], roots, ownNodes,
    [...ownNodes.map(node => ({ ...node, containerId: '00000000-0000-0000-ffff-ffffffffffff' })),
        ...roots.map(node => ({ ...node, containerId: '00000000-0000-0000-ffff-ffffffffffff' }))],
    [...ownNodes, ...roots, { ...roots[1], containerId: containers[0] }],
    [{ ...ownNodes[0], parentId: ownNodes[0].instanceId }, ...roots],
]) {
    assert.strictEqual(devices.buildWindowsMicrobitPorts(studentPorts, nodes)[0].displayName, 'COM30');
}
assert.strictEqual(devices.buildWindowsMicrobitPorts([{ ...studentPorts[0], serialNumber: a }],
    [...ownNodes, ...roots])[0].serialNumber, undefined);
// A shared ancestor/hub container must not match a sibling's serial.
assert.strictEqual(devices.buildWindowsMicrobitPorts([studentPorts[0]], [
    { ...ownNodes[0], containerId: undefined, parentId: 'USB\\HUB\\1' },
    { instanceId: 'USB\\HUB\\1', containerId: containers[0], isPort: false }, ...roots,
])[0].displayName, 'COM30');
console.log('PASS: student SESSION IDs resolved through exact containers/parents; ambiguous, absent and conflicting identities rejected');

// Reproduce the actual session-15 diagnostic, not a hypothetical direct match.
const actualStudent = require('./fixtures/microbit-session15.json');
const actualLabels = devices.buildWindowsMicrobitPorts(actualStudent.ports, actualStudent.nodes);
assert.strictEqual(actualLabels[0].path, 'COM55');
assert.strictEqual(actualLabels[0].displayName, 'microbit (B5E79A42)');
assert.strictEqual(actualLabels[1].path, 'COM74');
assert.strictEqual(actualLabels[1].displayName, 'microbit (E5DC3934)');
const renumbered = actualStudent.ports.map((port, i) => ({ ...port, path: `COM${900 + i}` })).reverse();
const renumberedLabels = devices.buildWindowsMicrobitPorts(renumbered, [...actualStudent.nodes].reverse());
assert.deepStrictEqual(Array.from(renumberedLabels, item => [item.path, item.displayName]),
    [['COM901', 'microbit (E5DC3934)'], ['COM900', 'microbit (B5E79A42)']]);
const composite = actualStudent.nodes.find(node => /&REV_1000\\/.test(node.instanceId));
assert(composite);
assert.strictEqual(devices.buildWindowsMicrobitPorts(actualStudent.ports,
    [...actualStudent.nodes].reverse())[1].displayName, 'microbit (E5DC3934)');
assert.strictEqual(devices.buildWindowsMicrobitPorts(actualStudent.ports,
    actualStudent.nodes.filter(node => node !== composite))[1].displayName, 'COM74');
const unrelatedRoot = actualStudent.nodes.find(node => node.instanceId.startsWith('TS_USB\\') &&
    node.containerId !== composite.containerId);
assert(unrelatedRoot);
assert.strictEqual(devices.buildWindowsMicrobitPorts(actualStudent.ports,
    [...actualStudent.nodes, { ...unrelatedRoot, containerId: composite.containerId }])[1].displayName, 'COM74');
// A second redirected board, with its own composite relationship, must resolve
// independently of the first COM and independently of enumeration order.
const thirdId = `${studentIds[0]}-TEST`;
const thirdComposite = 'USB\\VID_0D28&PID_0204&REV_1000\\TEST-SECOND-COMPOSITE';
const multi = devices.buildWindowsMicrobitPorts([...actualStudent.ports, { path: 'COM76', pnpId: thirdId }], [
    { instanceId: thirdId, isPort: true, parentId: thirdComposite },
    { instanceId: thirdComposite, isPort: false, containerId: unrelatedRoot.containerId }, ...actualStudent.nodes,
]);
assert.deepStrictEqual(Array.from(multi, item => item.displayName),
    ['microbit (B5E79A42)', 'microbit (E5DC3934)', 'microbit (B6284873)']);
console.log('PASS: captured session-15 composite-parent regression, multiple redirected boards and conflicting container rejection');

const registryStudent = require('./fixtures/microbit-session4-registry.json');
const { ports: registryPorts, nodes: registryNodes, registryIdentities } = registryStudent;
assert.strictEqual(devices.buildWindowsMicrobitPorts(registryPorts, registryNodes)[1].displayName, 'COM37');
const registryResult = devices.buildWindowsMicrobitPorts(registryPorts, registryNodes, registryIdentities);
assert.strictEqual(registryResult[0].displayName, 'COM1');
assert.strictEqual(registryResult[1].path, 'COM37');
assert.strictEqual(registryResult[1].displayName, 'microbit (828EF1B5)');
assert.strictEqual(registryResult[1].serialNumber, '990636020005282083A474A7828EF1B5000000006E052820');
assert.strictEqual(devices.buildWindowsMicrobitPorts([], registryNodes, registryIdentities).length, 0);
assert.strictEqual(devices.buildWindowsMicrobitPorts(registryPorts, [], registryIdentities)[1].displayName, 'COM37');
assert.strictEqual(devices.buildWindowsMicrobitPorts(registryPorts, registryNodes,
    registryIdentities.map(item => ({ ...item, containerId: containers[0] })))[1].displayName, 'COM37');
assert.strictEqual(devices.buildWindowsMicrobitPorts(registryPorts, registryNodes, [
    ...registryIdentities, { ...registryIdentities[0], instanceId: usb(a) },
])[1].displayName, 'COM37');
const registryRenumbered = devices.buildWindowsMicrobitPorts([
    { ...registryPorts[1], path: 'COM777' },
], [...registryNodes].reverse(), [...registryIdentities].reverse());
assert.strictEqual(registryRenumbered[0].path, 'COM777');
assert.strictEqual(registryRenumbered[0].displayName, 'microbit (828EF1B5)');
console.log('PASS: captured session-4 registry identity fallback, duplicate serial deduplication, missing/live COM and conflicting metadata checks');
