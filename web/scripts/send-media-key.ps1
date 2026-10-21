param(
    [Parameter(Mandatory)]
    [ValidateSet('PlayPause', 'Next', 'Previous', 'Stop')]
    [string]$Key
)

<#
.SYNOPSIS
    Sends an OS-level media key event for testing the Media Session API.
.DESCRIPTION
    Chromium blocks synthetic keyboard events (Playwright keyboard.press,
    CDP Input.dispatchKeyEvent) from reaching the Media Session API.
    This script calls user32!keybd_event to inject a real hardware-level
    key press that the browser treats as a physical media-key press.

    Uses the legacy keybd_event API rather than the modern SendInput because
    the KEYBDINPUT structure needed by SendInput requires significantly more
    P/Invoke scaffolding for no practical benefit in this testing context.

    Virtual-key codes used:
        VK_MEDIA_NEXT_TRACK   0xB0 (176)
        VK_MEDIA_PREV_TRACK   0xB1 (177)
        VK_MEDIA_STOP         0xB2 (178)
        VK_MEDIA_PLAY_PAUSE   0xB3 (179)
.EXAMPLE
    PowerShell -ExecutionPolicy Bypass -File scripts\send-media-key.ps1 -Key Next
.PARAMETER Key
    One of: PlayPause, Next, Previous, Stop
#>

$ErrorActionPreference = 'Stop'

try {
    Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class MediaKeys {
    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    public const byte VK_MEDIA_NEXT_TRACK  = 0xB0;
    public const byte VK_MEDIA_PREV_TRACK   = 0xB1;
    public const byte VK_MEDIA_STOP         = 0xB2;
    public const byte VK_MEDIA_PLAY_PAUSE   = 0xB3;
    public const uint KEYEVENTF_KEYUP       = 0x0002;

    public static void Send(byte vkCode) {
        keybd_event(vkCode, 0, 0, UIntPtr.Zero);
        keybd_event(vkCode, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    }
}
"@
} catch {
    Write-Error "Failed to load the MediaKeys helper. This script requires the .NET Framework and user32.dll access."
    exit 1
}

$keyMap = @{
    'PlayPause' = [MediaKeys]::VK_MEDIA_PLAY_PAUSE
    'Next'      = [MediaKeys]::VK_MEDIA_NEXT_TRACK
    'Previous'  = [MediaKeys]::VK_MEDIA_PREV_TRACK
    'Stop'      = [MediaKeys]::VK_MEDIA_STOP
}

[MediaKeys]::Send($keyMap[$Key])
