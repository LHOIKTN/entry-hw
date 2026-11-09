import { WindowsIdentityNode, WindowsRegistryIdentity } from './windowsMicrobitIdentity';

export interface MicrobitDevice extends ISerialPortScanData {
    serialNumber: string;
    displayName: string;
    connectionError?: string;
    comPath?: string;
}

// Only accept a complete USB instance serial, never an interface/location ID.
// Do not depend on the tested 990636 board prefix or 48-character length.
export function serialFromInstance(id: string): string | undefined {
    const match = /^(USB|TS_USB)\\VID_0D28&PID_0204\\(TS_)?([0-9A-F]{8,128})$/i.exec(id);
    return match ? match[3].toUpperCase() : undefined;
}

export function microbitNotice(message: string): ISerialPortScanData {
    return { path: 'microbit:notice', displayName: message, connectionError: message };
}

// Windows policy for the deployed school boards: only the complete, observed
// 48-hex DAPLink serial format with the user-specified family prefix.
// This is a pattern rule, not a list of previously registered boards.
// Never take an arbitrary suffix or remove session
// markers. This validates a format, not the authenticity of a driver response.
export function windowsBoardSerial(value: string): string | undefined {
    const serial = value.trim();
    return /^[0-9A-F]{48}$/i.test(serial) && serial.startsWith('990636020005282')
        ? serial.toUpperCase() : undefined;
}

function windowsInstanceSerial(value: string): string | undefined {
    const match = /^(?:USB|TS_USB)\\VID_0D28&PID_0204(?:&MI_[0-9A-F]{2})?\\(?:TS_)?([0-9A-F]{48})$/i.exec(value);
    return match ? windowsBoardSerial(match[1]) : undefined;
}

// Retain the COM path; supplement its identity using verified Windows device
// relationships. Missing identities remain usable through the original COM label.
export function buildWindowsMicrobitPorts(
    ports: ISerialPortScanData[], nodes: WindowsIdentityNode[] = [],
    registryIdentities: WindowsRegistryIdentity[] = [],
): ISerialPortScanData[] {
    const byId = new Map(nodes.map(node => [node.instanceId.toUpperCase(), node]));
    const container = (value?: string | null) => value &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) &&
        !/^00000000-0000-0000-(?:0000-000000000000|ffff-ffffffffffff)$/i.test(value) &&
        !/^ffffffff-ffff-ffff-ffff-ffffffffffff$/i.test(value) ? value.toUpperCase() : undefined;
    const serialFor = (port: ISerialPortScanData) => {
        const isMicrobit = ((port.vendorId || '').toUpperCase() === '0D28' &&
            (port.productId || '').toUpperCase() === '0204') ||
            /VID_0D28&PID_0204/i.test(port.pnpId || '');
        if (!isMicrobit) { return undefined; }
        const candidates = new Set<string>();
        const add = (serial?: string) => { if (serial) { candidates.add(serial); } };
        add(windowsBoardSerial(port.serialNumber || ''));
        add(windowsInstanceSerial(port.pnpId || ''));
        // Start at the exact COM devnode; SESSION, slot numbers and list order
        // are never used as a serial or as a relationship between devices.
        const own = byId.get((port.pnpId || '').toUpperCase());
        if (own && own.isPort) {
            const seen = new Set<string>();
            const deviceContainers = new Set<string>();
            const addContainer = (value?: string | null) => {
                const id = container(value);
                if (id) { deviceContainers.add(id); }
            };
            addContainer(own.containerId);
            let current: WindowsIdentityNode | undefined = own;
            for (let depth = 0; current && depth < 32; depth++) {
                const id = current.instanceId.toUpperCase();
                if (seen.has(id)) { return undefined; }
                seen.add(id);
                add(windowsInstanceSerial(current.instanceId));
                // MultiPoint gives COM interfaces fresh ContainerIDs, but their
                // micro:bit composite parent retains the TS_USB board's ID.
                // Accept only the actual ancestor with this board's VID/PID,
                // excluding interfaces, USB hubs and session-wide enumerators.
                if (/^(?:USB|TS_USB)\\VID_0D28&PID_0204(?:&REV_[0-9A-F]{4})?\\[^\\]+$/i.test(id)) {
                    addContainer(current.containerId);
                }
                current = current.parentId ? byId.get(current.parentId.toUpperCase()) : undefined;
            }
            if (current) { return undefined; } // Incomplete/cyclic ancestry is not evidence.
            nodes.filter(node => {
                const id = container(node.containerId);
                return !!id && deviceContainers.has(id);
            }).forEach(node => add(windowsInstanceSerial(node.instanceId)));
            // Registry records are identity metadata, not evidence that a COM
            // or board is present. Use them only for this live COM's verified
            // own/composite containers. Never add historical ports to the list.
            registryIdentities.filter(item => {
                const id = container(item.containerId);
                return item.source === 'registry' && !!id && deviceContainers.has(id);
            }).forEach(item => add(windowsInstanceSerial(item.instanceId)));
        }
        return candidates.size === 1 ? Array.from(candidates)[0] : undefined;
    };
    const short = (serial: string) => serial.substr(24, 8);
    const serials = ports.map(serialFor);
    return ports.map((port, index) => {
        const serial = serials[index];
        const collision = serial && serials.filter(value => value && short(value) === short(serial)).length > 1;
        return {
            ...port,
            // The UI tooltip must receive the same validated identity as the label.
            // Keep the untouched driver record in the discovery log only.
            serialNumber: serial,
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
