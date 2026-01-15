import os


def set_background_priority():
    if os.name == "nt":
        # Based on:
        #   "Recipe 496767: Set Process Priority In Windows" on ActiveState
        #   http://code.activestate.com/recipes/496767/
        import win32api
        import win32con
        import win32process

        pid = win32api.GetCurrentProcessId()
        handle = win32api.OpenProcess(win32con.PROCESS_ALL_ACCESS, True, pid)
        win32process.SetPriorityClass(handle, win32process.IDLE_PRIORITY_CLASS)
    if os.name == "posix":
        os.nice(-20)
    else:
        print("Could not identify OS")
