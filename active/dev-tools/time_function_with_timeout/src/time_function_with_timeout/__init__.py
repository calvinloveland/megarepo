"""Module for timing function execution with timeout support."""

import threading
import time


def time_function_with_timeout(function, *args, timeout=0, **kwargs):
    """Execute a function and return the time it took to execute it.

    If the function does not return before the timeout, raise a TimeoutError.
    
    Args:
        function: The function to execute.
        *args: Positional arguments to pass to the function.
        timeout: Maximum time in seconds to wait (0 = no timeout).
        **kwargs: Keyword arguments to pass to the function.
        
    Returns:
        Tuple of (elapsed_time, return_value).
        
    Raises:
        TimeoutError: If the function doesn't complete within timeout.
    """

    def run():
        run.value = function(*args, **kwargs)

    run.value = None

    start_time = time.time()
    thread = threading.Thread(target=run)
    thread.start()
    thread.join(timeout if timeout > 0 else None)
    end_time = time.time()
    elapsed = end_time - start_time
    if thread.is_alive():
        raise TimeoutError(f"Function timed out after {timeout} seconds")
    return elapsed, run.value
