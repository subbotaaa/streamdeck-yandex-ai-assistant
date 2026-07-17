# devices.ps1 — prints the list of audio input/output devices as one JSON line.
$ErrorActionPreference = 'Stop'

Add-Type -Namespace Win32 -Name Audio -MemberDefinition @'
[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
public struct WAVEINCAPS { public ushort wMid; public ushort wPid; public uint vDriverVersion; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string szPname; public uint dwFormats; public ushort wChannels; public ushort wReserved1; }
[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
public struct WAVEOUTCAPS { public ushort wMid; public ushort wPid; public uint vDriverVersion; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string szPname; public uint dwFormats; public ushort wChannels; public ushort wReserved1; public uint dwSupport; }
[DllImport("winmm.dll")] public static extern uint waveInGetNumDevs();
[DllImport("winmm.dll", CharSet=CharSet.Unicode)] public static extern uint waveInGetDevCapsW(uint id, out WAVEINCAPS caps, uint size);
[DllImport("winmm.dll")] public static extern uint waveOutGetNumDevs();
[DllImport("winmm.dll", CharSet=CharSet.Unicode)] public static extern uint waveOutGetDevCapsW(uint id, out WAVEOUTCAPS caps, uint size);
'@

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$inputs = @()
$n = [Win32.Audio]::waveInGetNumDevs()
for ($i = 0; $i -lt $n; $i++) {
    $c = New-Object Win32.Audio+WAVEINCAPS
    [void][Win32.Audio]::waveInGetDevCapsW($i, [ref]$c, [Runtime.InteropServices.Marshal]::SizeOf([type][Win32.Audio+WAVEINCAPS]))
    $inputs += $c.szPname
}
$outputs = @()
$n = [Win32.Audio]::waveOutGetNumDevs()
for ($i = 0; $i -lt $n; $i++) {
    $c = New-Object Win32.Audio+WAVEOUTCAPS
    [void][Win32.Audio]::waveOutGetDevCapsW($i, [ref]$c, [Runtime.InteropServices.Marshal]::SizeOf([type][Win32.Audio+WAVEOUTCAPS]))
    $outputs += $c.szPname
}

@{ inputs = $inputs; outputs = $outputs } | ConvertTo-Json -Compress
