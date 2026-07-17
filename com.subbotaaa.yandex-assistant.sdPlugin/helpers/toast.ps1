# toast.ps1 — shows the assistant's answer as a custom popup card (bottom-right,
# above the tray). Unlike system toasts, display time is fully configurable.
# The text is read from a UTF-8 file (avoids any command-line escaping issues).
param(
    [Parameter(Mandatory = $true)][string]$File,   # UTF-8 text file with the body
    [string]$Title = 'Yandex AI Assistant',
    [int]$Seconds = 5,                              # 0 = stay until clicked
    [switch]$Clip                                   # also copy the full text to the clipboard
)
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$text = [System.IO.File]::ReadAllText($File, [System.Text.Encoding]::UTF8)
if ($Clip) {
    try { Set-Clipboard -Value $text } catch {}
}

# Form subclass that never steals focus from the active application
Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'
using System.Windows.Forms;
public class NotifyForm : Form {
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams {
        get {
            CreateParams cp = base.CreateParams;
            cp.ExStyle |= 0x08000000 | 0x00000008; // WS_EX_NOACTIVATE | WS_EX_TOPMOST
            return cp;
        }
    }
}
'@

$W = 400
$pad = 16
$font = New-Object System.Drawing.Font('Segoe UI', 10)
$titleFont = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)

$measured = [System.Windows.Forms.TextRenderer]::MeasureText(
    $text, $font,
    (New-Object System.Drawing.Size(($W - 2 * $pad - 24), 0)),
    ([System.Windows.Forms.TextFormatFlags]::WordBreak))
$bodyH = [Math]::Min($measured.Height + 6, 430)
$H = $pad + 24 + 10 + $bodyH + $pad

$form = New-Object NotifyForm
$form.FormBorderStyle = 'None'
$form.ShowInTaskbar = $false
$form.StartPosition = 'Manual'
$form.Size = New-Object System.Drawing.Size($W, $H)
$form.BackColor = [System.Drawing.Color]::FromArgb(34, 40, 66)
$wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$form.Location = New-Object System.Drawing.Point(($wa.Right - $W - 12), ($wa.Bottom - $H - 12))

$closeAll = { $form.Close() }

# accent bar in the plugin's gradient hues
$accent = New-Object System.Windows.Forms.Panel
$accent.SetBounds(0, 0, 5, $H)
$accent.BackColor = [System.Drawing.Color]::FromArgb(124, 92, 255)
$form.Controls.Add($accent)

$titleLbl = New-Object System.Windows.Forms.Label
$titleLbl.Font = $titleFont
$titleLbl.ForeColor = [System.Drawing.Color]::FromArgb(170, 200, 255)
$titleLbl.Text = $Title
$titleLbl.AutoEllipsis = $true
$titleLbl.SetBounds($pad, $pad, $W - 2 * $pad - 24, 24)
$form.Controls.Add($titleLbl)

$closeLbl = New-Object System.Windows.Forms.Label
$closeLbl.Font = New-Object System.Drawing.Font('Segoe UI', 11, [System.Drawing.FontStyle]::Bold)
$closeLbl.ForeColor = [System.Drawing.Color]::FromArgb(150, 150, 170)
$closeLbl.Text = [char]0x00D7
$closeLbl.SetBounds($W - $pad - 18, $pad - 2, 20, 24)
$form.Controls.Add($closeLbl)

$panel = New-Object System.Windows.Forms.Panel
$panel.SetBounds($pad, $pad + 34, $W - 2 * $pad, $bodyH)
$panel.AutoScroll = $true
$form.Controls.Add($panel)

$bodyLbl = New-Object System.Windows.Forms.Label
$bodyLbl.Font = $font
$bodyLbl.ForeColor = [System.Drawing.Color]::FromArgb(232, 236, 247)
$bodyLbl.Text = $text
$bodyLbl.AutoSize = $true
$bodyLbl.MaximumSize = New-Object System.Drawing.Size(($W - 2 * $pad - 24), 0)
$panel.Controls.Add($bodyLbl)

foreach ($ctl in @($form, $titleLbl, $closeLbl, $bodyLbl, $panel, $accent)) {
    $ctl.Add_Click($closeAll)
}

if ($Seconds -gt 0) {
    $timer = New-Object System.Windows.Forms.Timer
    $timer.Interval = $Seconds * 1000
    $timer.Add_Tick({ $form.Close() })
    $timer.Start()
}

[System.Windows.Forms.Application]::Run($form)
