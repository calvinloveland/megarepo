import time
import threading


def time_function_with_timeout(function, timeout=0, *args, **kwargs):
    """Execute a function and return the time it took to execute it.
    If the function does not return before the timeout, raise a TimeoutError.
    """
    def run():
        run.value = function(*args, **kwargs)
    run.value = None

    start_time = time.time()
    thread = threading.Thread(target=run)
    thread.start()
    thread.join(timeout)
    end_time = time.time()
    timing = end_time - start_time
    if thread.is_alive():
        raise TimeoutError("Function timed out after {} seconds".format(timeout))
    return timing,run.value

