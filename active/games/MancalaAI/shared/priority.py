"""Cross-platform process-priority helpers."""

import os


def set_background_priority():
    """Lower process priority for background training workloads."""
    if os.name == "nt":
        kernel32 = __import__("ctypes").windll.kernel32
        process = kernel32.GetCurrentProcess()
        idle_priority_class = 0x40
        kernel32.SetPriorityClass(process, idle_priority_class)
    elif os.name == "posix":
        os.nice(-20)
    else:
        print("Could not identify OS")
