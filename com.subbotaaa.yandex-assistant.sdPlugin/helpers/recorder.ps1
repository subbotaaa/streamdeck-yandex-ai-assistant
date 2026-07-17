# recorder.ps1 — persistent microphone recorder built on Windows WinMM/MCI (no external tools).
# Protocol over stdin/stdout, one command per line:
#   START            -> begins recording from the default microphone (16 kHz, 16-bit, mono)
#   START|<mic name> -> same, but from the named input device (waveIn device name)
#   STOP <path>      -> stops and saves a WAV file to <path>
#   BEEP <hz> <ms>   -> plays a short cue tone asynchronously (default output device)
#   CANCEL           -> stops and discards the recording
#   EXIT             -> terminates the process
# Responses: "READY", "OK START", "OK SAVED", "OK CANCEL", "ERR <message>"

$ErrorActionPreference = 'Stop'

Add-Type -Namespace Win32 -Name MCI -MemberDefinition @'
[DllImport("winmm.dll", CharSet=CharSet.Unicode)]
public static extern int mciSendStringW(string command, System.Text.StringBuilder ret, int retLen, System.IntPtr hwnd);
[DllImport("winmm.dll", CharSet=CharSet.Unicode)]
public static extern int mciGetErrorStringW(int err, System.Text.StringBuilder ret, int retLen);
[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
public struct WAVEINCAPS { public ushort wMid; public ushort wPid; public uint vDriverVersion; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string szPname; public uint dwFormats; public ushort wChannels; public ushort wReserved1; }
[DllImport("winmm.dll")] public static extern uint waveInGetNumDevs();
[DllImport("winmm.dll", CharSet=CharSet.Unicode)] public static extern uint waveInGetDevCapsW(uint id, out WAVEINCAPS caps, uint size);
public static void BeepAsync(int freq, int dur) {
    System.Threading.Tasks.Task.Run(() => { try { System.Console.Beep(freq, dur); } catch {} });
}
'@

function Find-InputDevice([string]$name) {
    if ([string]::IsNullOrWhiteSpace($name)) { return -1 }
    $n = [Win32.MCI]::waveInGetNumDevs()
    for ($i = 0; $i -lt $n; $i++) {
        $c = New-Object Win32.MCI+WAVEINCAPS
        [void][Win32.MCI]::waveInGetDevCapsW($i, [ref]$c, [Runtime.InteropServices.Marshal]::SizeOf([type][Win32.MCI+WAVEINCAPS]))
        if ($c.szPname -eq $name) { return $i }
    }
    return -1
}

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

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
# stdin must be read as UTF-8 explicitly: device names may contain Cyrillic
$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), [System.Text.Encoding]::UTF8)
$script:recording = $false

function Close-Capture {
    try { $null = Send-Mci 'close cap' } catch {}
    $script:recording = $false
}

Write-Output 'READY'

while ($true) {
    $line = $stdin.ReadLine()
    if ($null -eq $line) { break }
    $line = $line.Trim()
    if ($line -eq '') { continue }
    try {
        if ($line -eq 'START' -or $line.StartsWith('START|')) {
            if ($script:recording) { Close-Capture }
            $micName = if ($line.Length -gt 6) { $line.Substring(6).Trim() } else { '' }
            $null = Send-Mci 'open new type waveaudio alias cap'
            $null = Send-Mci 'set cap time format ms'
            $null = Send-Mci 'set cap format tag pcm bitspersample 16 channels 1 samplespersec 16000 bytespersec 32000 alignment 2'
            $micId = Find-InputDevice $micName
            if ($micId -ge 0) {
                # fall back to the default device if the driver rejects the selection
                try { $null = Send-Mci "set cap input $micId" } catch { $micId = -1 }
            }
            $null = Send-Mci 'record cap'
            $script:recording = $true
            Write-Output "OK START mic=$micId"
        }
        elseif ($line.StartsWith('STOP ')) {
            $path = $line.Substring(5).Trim()
            if (-not $script:recording) { Write-Output 'ERR not-recording'; continue }
            $null = Send-Mci 'stop cap'
            $null = Send-Mci ('save cap "' + $path + '"')
            Close-Capture
            Write-Output 'OK SAVED'
        }
        elseif ($line.StartsWith('BEEP')) {
            $parts = $line.Split(' ')
            $freq = 1000; $dur = 90
            if ($parts.Length -ge 2) { $freq = [int]$parts[1] }
            if ($parts.Length -ge 3) { $dur = [int]$parts[2] }
            [Win32.MCI]::BeepAsync($freq, $dur)
            Write-Output 'OK BEEP'
        }
        elseif ($line -eq 'CANCEL') {
            if ($script:recording) { try { $null = Send-Mci 'stop cap' } catch {}; Close-Capture }
            Write-Output 'OK CANCEL'
        }
        elseif ($line -eq 'EXIT') {
            if ($script:recording) { try { $null = Send-Mci 'stop cap' } catch {} }
            Close-Capture
            break
        }
        else {
            Write-Output 'ERR unknown-command'
        }
    }
    catch {
        Close-Capture
        $msg = $_.Exception.Message -replace "(`r|`n)+", ' '
        Write-Output ("ERR " + $msg)
    }
}
