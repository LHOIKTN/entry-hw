const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../app/src/main/core/serial/windowsMicrobitIdentity.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018, esModuleInterop: true,
} }).outputText;
function loader(response, failure) {
    const module = { exports: {} };
    vm.runInNewContext(compiled, { module, exports: module.exports, __dirname: 'C:/Entry/resources/app.asar/node_modules/entry-hw/app/src/main',
        require: id => id === 'child_process' ? { execFile(executable, args, options, callback) {
            assert(executable.endsWith('MicrobitIdentity.exe'));
            assert(executable.includes('app.asar.unpacked'));
            assert(!/powershell|cmd\.exe/i.test(executable));
            assert.strictEqual(args.length, 0);
            assert.strictEqual(options.windowsHide, true);
            assert.strictEqual(options.timeout, 15000);
            callback(failure, response, failure ? 'native failure details' : '');
        } } : require(id),
    });
    return module.exports.readWindowsMicrobitIdentity;
}
(async () => {
    assert.strictEqual((await loader('{"version":1,"elapsedMs":1,"nodes":[]}')()).nodes.length, 0);
    assert.strictEqual((await loader(JSON.stringify({version:1,elapsedMs:1,nodes:[],registryIdentities:[
        {instanceId:'USB\\VID_0D28&PID_0204\\test',containerId:'test',source:'registry'},
    ]}))()).registryIdentities.length, 1);
    for (const invalid of ['bad json', '{}', '{"version":2,"elapsedMs":0,"nodes":[]}',
        '{"version":1,"elapsedMs":0,"nodes":[{"instanceId":42,"isPort":true}]}',
        '{"version":1,"elapsedMs":0,"nodes":[{"instanceId":"x","isPort":true},{"instanceId":"X","isPort":true}]}']) {
        await assert.rejects(loader(invalid)());
    }
    for (const registryIdentities of [{}, [null], [{instanceId:'x',containerId:42,source:'registry'}],
        [{instanceId:'x',containerId:'x',source:'unknown'}]]) {
        await assert.rejects(loader(JSON.stringify({version:1,elapsedMs:1,nodes:[],registryIdentities}))());
    }
    const error = Object.assign(new Error('Native timeout'), { code: 'ETIMEDOUT' });
    await assert.rejects(loader('', error)(), e => e.code === 'ETIMEDOUT' && e.stderr === 'native failure details');
    console.log('PASS: native identity invocation, ASAR unpack path, timeout and malformed snapshots');
})().catch(error => { console.error(error); process.exitCode = 1; });
