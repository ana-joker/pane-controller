import sys
import subprocess
import ctypes
from ctypes import wintypes

class STARTUPINFO(ctypes.Structure):
    _fields_ = [
        ('cb', wintypes.DWORD),
        ('lpReserved', wintypes.LPWSTR),
        ('lpDesktop', wintypes.LPWSTR),
        ('lpTitle', wintypes.LPWSTR),
        ('dwX', wintypes.DWORD),
        ('dwY', wintypes.DWORD),
        ('dwXSize', wintypes.DWORD),
        ('dwYSize', wintypes.DWORD),
        ('dwXCountChars', wintypes.DWORD),
        ('dwYCountChars', wintypes.DWORD),
        ('dwFillAttribute', wintypes.DWORD),
        ('dwFlags', wintypes.DWORD),
        ('wShowWindow', wintypes.WORD),
        ('cbReserved2', wintypes.WORD),
        ('lpReserved2', ctypes.c_char_p),
        ('hStdInput', wintypes.HANDLE),
        ('hStdOutput', wintypes.HANDLE),
        ('hStdError', wintypes.HANDLE),
    ]

class PROCESS_INFORMATION(ctypes.Structure):
    _fields_ = [
        ('hProcess', wintypes.HANDLE),
        ('hThread', wintypes.HANDLE),
        ('dwProcessId', wintypes.DWORD),
        ('dwThreadId', wintypes.DWORD),
    ]

def main():
    args = sys.argv[1:]
    if not args:
        sys.exit(1)

    cmd_line = subprocess.list2cmdline(args)

    si = STARTUPINFO()
    si.cb = ctypes.sizeof(STARTUPINFO)
    si.lpDesktop = "WinSta0\\Default"

    pi = PROCESS_INFORMATION()

    kernel32 = ctypes.windll.kernel32
    # DETACHED_PROCESS = 0x00000008
    ok = kernel32.CreateProcessW(
        None,
        ctypes.c_wchar_p(cmd_line),
        None,
        None,
        False,
        0x00000008,
        None,
        None,
        ctypes.byref(si),
        ctypes.byref(pi)
    )
    if not ok:
        err = kernel32.GetLastError()
        print(f"CreateProcessW failed with error {err}", file=sys.stderr)
        sys.exit(err)

    kernel32.CloseHandle(pi.hProcess)
    kernel32.CloseHandle(pi.hThread)
    sys.exit(0)

if __name__ == '__main__':
    main()
