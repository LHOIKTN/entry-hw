const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'app/native/MicrobitIdentity.exe');
if (process.platform !== 'win32') {
    throw new Error('Build MicrobitIdentity.exe on Windows before syncing or packaging.');
}
const compiler = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
const result = spawnSync(compiler, ['/nologo', '/target:exe', '/platform:x64', '/optimize+',
    '/reference:System.Web.Extensions.dll', `/out:${output}`, path.join(root, 'app/native/MicrobitIdentity.cs')],
{ encoding: 'utf8', windowsHide: true });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(result.stdout + result.stderr);
fs.writeFileSync(`${output}.config`, '<?xml version="1.0"?><configuration><startup><supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.0"/></startup></configuration>');
console.log('Built Windows x64 MicrobitIdentity helper (SetupAPI / Configuration Manager).');
