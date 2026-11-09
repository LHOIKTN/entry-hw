// Read-only Windows device identity snapshot. No PowerShell, port opens or writes.
// Build using cli/buildMicrobitIdentity.js; requires .NET Framework 4 on Windows.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using Microsoft.Win32;

internal static class MicrobitIdentity {
    [StructLayout(LayoutKind.Sequential)]
    private struct DeviceInfo {
        public uint size;
        public Guid classGuid;
        public uint devInst;
        public UIntPtr reserved;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct PropertyKey { public Guid format; public uint id; }
    private sealed class Node {
        public string instanceId;
        public string containerId;
        public string parentId;
        public int containerError;
        public uint parentError;
        public bool isPort;
    }
    private sealed class RegistryIdentity {
        public string instanceId;
        public string containerId;
        public string source = "registry";
    }
    private static List<RegistryIdentity> ReadRegistryIdentities(IEnumerable<Node> nodes, List<object> errors) {
        var eligible = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (Node node in nodes) {
            if (!node.isPort && !Regex.IsMatch(node.instanceId,
                @"^(USB|TS_USB)\\VID_0D28&PID_0204(&REV_[0-9A-F]{4})?\\[^\\]+$", RegexOptions.IgnoreCase)) continue;
            Guid container;
            if (Guid.TryParse(node.containerId, out container) && container != Guid.Empty &&
                container.ToString() != "00000000-0000-0000-ffff-ffffffffffff" &&
                container.ToString() != "ffffffff-ffff-ffff-ffff-ffffffffffff") eligible.Add(container.ToString());
        }
        var identities = new List<RegistryIdentity>();
        if (eligible.Count == 0) return identities;
        foreach (string bus in new [] { "USB", "TS_USB" }) {
            string rootPath = @"SYSTEM\CurrentControlSet\Enum\" + bus + @"\VID_0D28&PID_0204";
            try {
                using (RegistryKey root = Registry.LocalMachine.OpenSubKey(rootPath, false)) {
                    if (root == null) continue;
                    foreach (string name in root.GetSubKeyNames()) {
                        if (!Regex.IsMatch(name, @"^(TS_)?990636020005282[0-9A-F]{33}$", RegexOptions.IgnoreCase)) continue;
                        try {
                            using (RegistryKey key = root.OpenSubKey(name, false)) {
                                if (key == null) continue;
                                Guid container;
                                if (!Guid.TryParse(Convert.ToString(key.GetValue("ContainerID")), out container) ||
                                    !eligible.Contains(container.ToString())) continue;
                                identities.Add(new RegistryIdentity { instanceId = bus + @"\VID_0D28&PID_0204\" + name,
                                    containerId = container.ToString() });
                            }
                        } catch (Exception error) {
                            if (errors.Count < 100) errors.Add(new { path = rootPath + @"\" + name,
                                code = error.HResult, message = error.Message });
                        }
                    }
                }
            } catch (Exception error) {
                if (errors.Count < 100) errors.Add(new { path = rootPath, code = error.HResult, message = error.Message });
            }
        }
        return identities;
    }
    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr SetupDiGetClassDevsW(IntPtr classGuid, string enumerator, IntPtr window, uint flags);
    [DllImport("setupapi.dll", SetLastError = true)]
    private static extern bool SetupDiEnumDeviceInfo(IntPtr set, uint index, ref DeviceInfo info);
    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool SetupDiGetDeviceInstanceIdW(IntPtr set, ref DeviceInfo info, StringBuilder text, uint size, out uint required);
    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool SetupDiGetDevicePropertyW(IntPtr set, ref DeviceInfo info, ref PropertyKey key,
        out uint type, byte[] data, uint size, out uint required, uint flags);
    [DllImport("setupapi.dll", SetLastError = true)]
    private static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);
    [DllImport("cfgmgr32.dll")]
    private static extern uint CM_Get_Parent(out uint parent, uint device, uint flags);
    [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)]
    private static extern uint CM_Get_Device_IDW(uint device, StringBuilder id, uint size, uint flags);

    public static int Main() {
        Console.OutputEncoding = new UTF8Encoding(false);
        var json = new JavaScriptSerializer();
        var watch = Stopwatch.StartNew();
        try {
            // DIGCF_PRESENT | DIGCF_ALLCLASSES: excludes disconnected registry history.
            IntPtr set = SetupDiGetClassDevsW(IntPtr.Zero, null, IntPtr.Zero, 2 | 4);
            if (set == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
            var nodes = new Dictionary<string, Node>(StringComparer.OrdinalIgnoreCase);
            try {
                for (uint i = 0; ; i++) {
                    var info = new DeviceInfo { size = (uint)Marshal.SizeOf(typeof(DeviceInfo)) };
                    if (!SetupDiEnumDeviceInfo(set, i, ref info)) {
                        int code = Marshal.GetLastWin32Error();
                        if (code == 259) break; // ERROR_NO_MORE_ITEMS
                        throw new Win32Exception(code);
                    }
                    uint required;
                    var id = new StringBuilder(4096);
                    if (!SetupDiGetDeviceInstanceIdW(set, ref info, id, (uint)id.Capacity, out required))
                        throw new Win32Exception(Marshal.GetLastWin32Error());
                    var node = new Node { instanceId = id.ToString(),
                        isPort = info.classGuid == new Guid("4d36e978-e325-11ce-bfc1-08002be10318") };
                    var key = new PropertyKey { format = new Guid("8c7ed206-3f8a-4827-b3ab-ae9e1faefc6c"), id = 2 };
                    uint type;
                    var bytes = new byte[16];
                    if (SetupDiGetDevicePropertyW(set, ref info, ref key, out type, bytes, 16, out required, 0)) {
                        if (type == 13 && required == 16) node.containerId = new Guid(bytes).ToString();
                    } else node.containerError = Marshal.GetLastWin32Error();
                    uint parent;
                    node.parentError = CM_Get_Parent(out parent, info.devInst, 0);
                    if (node.parentError == 0) {
                        var parentId = new StringBuilder(4096);
                        node.parentError = CM_Get_Device_IDW(parent, parentId, (uint)parentId.Capacity, 0);
                        if (node.parentError == 0) node.parentId = parentId.ToString();
                    }
                    nodes[node.instanceId] = node;
                }
            } finally { SetupDiDestroyDeviceInfoList(set); }
            // Emit COM/micro:bit nodes and their real ancestors, not unrelated inventory.
            var selected = new Dictionary<string, Node>(StringComparer.OrdinalIgnoreCase);
            foreach (Node seed in nodes.Values) {
                if (!seed.isPort && seed.instanceId.IndexOf("VID_0D28&PID_0204", StringComparison.OrdinalIgnoreCase) < 0) continue;
                Node current = seed;
                var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                for (int depth = 0; current != null && depth < 32 && visited.Add(current.instanceId); depth++) {
                    selected[current.instanceId] = current;
                    Node next;
                    current = current.parentId != null && nodes.TryGetValue(current.parentId, out next) ? next : null;
                }
            }
            var registryErrors = new List<object>();
            var registryIdentities = ReadRegistryIdentities(selected.Values, registryErrors);
            Console.WriteLine(json.Serialize(new { version = 1, elapsedMs = watch.ElapsedMilliseconds,
                nodes = new List<Node>(selected.Values), registryIdentities, registryErrors }));
            return 0;
        } catch (Exception error) {
            var win32 = error as Win32Exception;
            Console.Error.WriteLine(json.Serialize(new { code = win32 != null ? win32.NativeErrorCode : error.HResult,
                message = error.Message, stack = error.ToString(), elapsedMs = watch.ElapsedMilliseconds }));
            return 1;
        }
    }
}
