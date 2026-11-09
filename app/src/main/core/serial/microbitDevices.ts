import { execFile } from 'child_process';

export interface PnpSnapshot {
    devices: string[];
    ports: { instanceId: string; ancestors: string[] }[];
}

export interface MicrobitDevice extends ISerialPortScanData {
    serialNumber: string;
    displayName: string;
    connectionError?: string;
    comPath?: string;
}

// Bundled with the main process: no external script path or execution-policy change.
export const discoveryScript = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$present = @(Get-PnpDevice -PresentOnly)
$devices = @($present | Where-Object { $_.InstanceId -match '^(USB|TS_USB)\\VID_0D28&PID_0204\\' } | ForEach-Object { $_.InstanceId })
$ports = @($present | Where-Object { $_.Class -eq 'Ports' } | ForEach-Object {
    $id = $_.InstanceId
    $current = $id
    $ancestors = @()
    for ($depth = 0; $depth -lt 16; $depth++) {
        try {
            $parent = (Get-PnpDeviceProperty -InstanceId $current -KeyName 'DEVPKEY_Device_Parent' -ErrorAction Stop).Data
        } catch { break }
        if (!$parent -or $ancestors -contains $parent) { break }
        $ancestors += [string]$parent
        $current = $parent
    }
    [PSCustomObject]@{ instanceId = $id; ancestors = @($ancestors) }
})
[PSCustomObject]@{ devices = @($devices); ports = @($ports) } | ConvertTo-Json -Depth 5 -Compress
`;

export function readMicrobitSnapshot(): Promise<PnpSnapshot> {
    return new Promise((resolve, reject) => {
        execFile('powershell.exe', [
            '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
            Buffer.from(discoveryScript, 'utf16le').toString('base64'),
        ], { windowsHide: true, timeout: 12000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
            if (error) {
                reject(error);
                return;
            }
            try {
                const snapshot = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
                if (!Array.isArray(snapshot.devices) || !Array.isArray(snapshot.ports) ||
                    !snapshot.devices.every((id: unknown) => typeof id === 'string') ||
                    !snapshot.ports.every((port: PnpSnapshot['ports'][0]) => port &&
                        typeof port.instanceId === 'string' && Array.isArray(port.ancestors) &&
                        port.ancestors.every(id => typeof id === 'string'))) {
                    throw new Error('Invalid PnP snapshot');
                }
                resolve(snapshot);
            } catch (parseError) {
                reject(parseError);
            }
        });
    });
}

// Only accept a complete USB instance serial, never an interface/location ID.
// Do not depend on the tested 990636 board prefix or 48-character length.
export function serialFromInstance(id: string): string | undefined {
    const match = /^(USB|TS_USB)\\VID_0D28&PID_0204\\(TS_)?([0-9A-F]{8,128})$/i.exec(id);
    return match ? match[3].toUpperCase() : undefined;
}

export function buildMicrobitDevices(
    snapshot: PnpSnapshot,
    ports: { path: string; pnpId?: string }[],
): MicrobitDevice[] {
    const serials = Array.from(new Set(snapshot.devices.map(serialFromInstance).filter(
        (serial): serial is string => !!serial,
    ))).sort();
    const shortSerial = (serial: string) => serial.length === 48 ? serial.substr(24, 8) : serial.slice(-8);
    return serials.map((serial) => {
        const redirected = snapshot.devices.some(id => /^TS_USB\\/i.test(id) && serialFromInstance(id) === serial);
        // Match the port's exact PnP instance to its real ancestry. Never pair by
        // list order, friendly name, session number, or merely matching VID/PID.
        const candidates = redirected ? [] : ports.filter(port => snapshot.ports.some(pnp => {
            if (!port.pnpId || pnp.instanceId.toUpperCase() !== port.pnpId.toUpperCase()) {
                return false;
            }
            const chain = [pnp.instanceId, ...pnp.ancestors];
            if (chain.some(id => /^TS_USB/i.test(id))) {
                return false;
            }
            const identities = Array.from(new Set(chain.map(serialFromInstance).filter(Boolean)));
            return identities.length === 1 && identities[0] === serial;
        }));
        const paths = Array.from(new Set(candidates.map(port => port.path)));
        const short = shortSerial(serial);
        // Full serial is an unambiguous extension for every colliding label.
        const label = serials.filter(value => shortSerial(value) === short).length > 1 ? serial : short;
        return {
            path: `microbit:${serial}`,
            serialNumber: serial,
            displayName: `microbit (${label})`,
            comPath: paths.length === 1 ? paths[0] : undefined,
            connectionError: redirected
                ? '리디렉션 장치의 통신 경로 대응이 검증되지 않았습니다. 일반 USB로 직접 연결하거나 관리자에게 장치 매핑 확인을 요청하세요.'
                : paths.length !== 1
                    ? '장치의 통신 경로를 하나로 확인하지 못했습니다. USB 연결 및 드라이버를 확인하세요.'
                    : undefined,
        };
    });
}

export function microbitNotice(message: string): ISerialPortScanData {
    return { path: 'microbit:notice', displayName: message, connectionError: message };
}

// Windows: retain the COM path and use only identity data from that same record.
// Missing serials remain usable through the original COM label.
export function buildWindowsMicrobitPorts(ports: ISerialPortScanData[]): ISerialPortScanData[] {
    const serialFor = (port: ISerialPortScanData) => {
        const isMicrobit = ((port.vendorId || '').toUpperCase() === '0D28' &&
            (port.productId || '').toUpperCase() === '0204') ||
            /VID_0D28&PID_0204/i.test(port.pnpId || '');
        if (!isMicrobit) { return undefined; }
        const serial = (port.serialNumber || '').trim();
        return /^[0-9A-F]{8,128}$/i.test(serial) ? serial.toUpperCase() : serialFromInstance(port.pnpId || '');
    };
    const short = (serial: string) => serial.length === 48 ? serial.substr(24, 8) : serial.slice(-8);
    const serials = ports.map(serialFor);
    return ports.map((port, index) => {
        const serial = serials[index];
        const collision = serial && serials.filter(value => value && short(value) === short(serial)).length > 1;
        return {
            ...port,
            displayName: serial ? `microbit (${collision ? serial : short(serial)})${collision ? ` [${port.path}]` : ''}` : port.path,
        };
    });
}

// macOS serialport supplies the USB serial on the same record as its device path.
export function buildMacMicrobitDevices(ports: ISerialPortScanData[]): MicrobitDevice[] {
    const candidates = ports.filter(port =>
        (port.vendorId || '').toUpperCase() === '0D28' &&
        (port.productId || '').toUpperCase() === '0204' &&
        /^[0-9A-F]{8,128}$/i.test(port.serialNumber || '')
    );
    const serials = Array.from(new Set(candidates.map(port => port.serialNumber!.toUpperCase()))).sort();
    const short = (serial: string) => serial.length === 48 ? serial.substr(24, 8) : serial.slice(-8);
    return serials.map(serial => {
        const paths = Array.from(new Set(candidates.filter(port =>
            port.serialNumber!.toUpperCase() === serial
        ).map(port => port.path)));
        const label = serials.filter(value => short(value) === short(serial)).length > 1 ? serial : short(serial);
        return {
            path: `microbit:${serial}`,
            serialNumber: serial,
            displayName: `microbit (${label})`,
            comPath: paths.length === 1 ? paths[0] : undefined,
            connectionError: paths.length === 1 ? undefined : '장치의 통신 경로를 하나로 확인하지 못했습니다. USB 연결을 확인하세요.',
        };
    });
}
