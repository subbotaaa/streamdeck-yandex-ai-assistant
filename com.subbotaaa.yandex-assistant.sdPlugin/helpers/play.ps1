# play.ps1 — plays a WAV file synchronously via WinMM/MCI.
# -Output selects a playback device by its waveOut name; empty = system default.
param(
    [Parameter(Mandatory = $true)][string]$File,
    [string]$Output = ''
)
$ErrorActionPreference = 'Stop'

Add-Type -Namespace Win32 -Name MCI -MemberDefinition @'
[DllImport("winmm.dll", CharSet=CharSet.Unicode)]
public static extern int mciSendStringW(string command, System.Text.StringBuilder ret, int retLen, System.IntPtr hwnd);
[DllImport("winmm.dll", CharSet=CharSet.Unicode)]
public static extern int mciGetErrorStringW(int err, System.Text.StringBuilder ret, int retLen);
[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
public struct WAVEOUTCAPS { public ushort wMid; public ushort wPid; public uint vDriverVersion; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string szPname; public uint dwFormats; public ushort wChannels; public ushort wReserved1; public uint dwSupport; }
[DllImport("winmm.dll")] public static extern uint waveOutGetNumDevs();
[DllImport("winmm.dll", CharSet=CharSet.Unicode)] public static extern uint waveOutGetDevCapsW(uint id, out WAVEOUTCAPS caps, uint size);
'@

function Send-Mci([string]$cmd) {
    $sb = New-Object System.Text.StringBuilder 512
    $code = [Win32.MCI]::mciSendStringW($cmd, $sb, $sb.Capacity, [IntPtr]::Zero)
    if ($code -ne 0) {
        $eb = New-Object System.Text.StringBuilder 512
        [void][Win32.MCI]::mciGetErrorStringW($code, $eb, $eb.Capacity)
        throw "MCI($code): $($eb.ToString()) [cmd: $cmd]"
    }
    return $sb.ToString()
}

function Find-OutputDevice([string]$name) {
    if ([string]::IsNullOrWhiteSpace($name)) { return -1 }
    $n = [Win32.MCI]::waveOutGetNumDevs()
    for ($i = 0; $i -lt $n; $i++) {
        $c = New-Object Win32.MCI+WAVEOUTCAPS
        [void][Win32.MCI]::waveOutGetDevCapsW($i, [ref]$c, [Runtime.InteropServices.Marshal]::SizeOf([type][Win32.MCI+WAVEOUTCAPS]))
        if ($c.szPname -eq $name) { return $i }
    }
    return -1
}

try {
    $null = Send-Mci ('open "' + $File + '" type waveaudio alias pl')
    $devId = Find-OutputDevice $Output
    if ($devId -ge 0) {
        # fall back to the default device if the driver rejects the selection
        try { $null = Send-Mci "set pl output $devId" } catch {}
    }
    $null = Send-Mci 'play pl wait'
    $null = Send-Mci 'close pl'
}
catch {
    try { $null = Send-Mci 'close pl' } catch {}
    Write-Output ("ERR " + $_.Exception.Message)
    exit 1
}
