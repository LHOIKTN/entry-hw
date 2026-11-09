import { execFile } from 'child_process';
import path from 'path';

export interface WindowsIdentityNode {
    instanceId: string;
    containerId?: string | null;
    parentId?: string | null;
    containerError?: number;
    parentError?: number;
    isPort: boolean;
}

export interface WindowsIdentitySnapshot {
    version: number;
    elapsedMs: number;
    nodes: WindowsIdentityNode[];
    registryIdentities?: WindowsRegistryIdentity[];
}

export interface WindowsRegistryIdentity {
    instanceId: string;
    containerId: string;
    source: 'registry';
}

export function readWindowsMicrobitIdentity(): Promise<WindowsIdentitySnapshot> {
    // Bundled mainRouter.build.js lives at app/src/main. Executables must use
    // the unpacked path in Entry Offline's ASAR distribution.
    const executable = path.resolve(__dirname, '../../native/MicrobitIdentity.exe')
        .replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
    return new Promise((resolve, reject) => {
        // .NET/native executable cold startup can exceed five seconds on the
        // deployment machines even though the actual device query takes ~20ms.
        execFile(executable, [], { windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024,
            encoding: 'utf8' }, (error, stdout, stderr) => {
            if (error) {
                Object.assign(error, { stderr, executable });
                reject(error);
                return;
            }
            try {
                const data = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
                if (data.version !== 1 || typeof data.elapsedMs !== 'number' || !Array.isArray(data.nodes) ||
                    data.nodes.length > 10000 || !data.nodes.every((node: WindowsIdentityNode) => node &&
                        typeof node.instanceId === 'string' && typeof node.isPort === 'boolean' &&
                        (node.containerId == null || typeof node.containerId === 'string') &&
                        (node.parentId == null || typeof node.parentId === 'string'))) {
                    throw new Error('Invalid Windows microbit identity snapshot');
                }
                const ids = data.nodes.map((node: WindowsIdentityNode) => node.instanceId.toUpperCase());
                if (new Set(ids).size !== ids.length) throw new Error('Duplicate Windows device instance IDs');
                if (data.registryIdentities != null && (!Array.isArray(data.registryIdentities) ||
                    data.registryIdentities.length > 10000 || !data.registryIdentities.every((item: WindowsRegistryIdentity) =>
                        item && item.source === 'registry' && typeof item.instanceId === 'string' &&
                        typeof item.containerId === 'string'))) {
                    throw new Error('Invalid Windows registry identities');
                }
                resolve(data);
            } catch (parseError) { reject(parseError); }
        });
    });
}
