import time
from time_function_with_timeout import time_function_with_timeout


def test_half_second_function():
    def half_second_function():
        time.sleep(0.5)

    timing,_ = time_function_with_timeout(half_second_function, 0.6)
    assert timing > 0.49 and timing < 0.51

def test_function_returns():
    def function_returns():
        return 1

    timing,value = time_function_with_timeout(function_returns, 0.5)
    assert timing < 0.01 
    assert value == 1

def test_function_with_args():
    def function_with_args(a,b):
        return a+b

    timing,value = time_function_with_timeout(function_with_args, 0.5, 1, 2)
    assert timing < 0.01 
    assert value == 3

def test_function_with_kwargs():
    def function_with_kwargs(a,b):
        return a+b

    timing,value = time_function_with_timeout(function_with_kwargs, 0.5, a=1, b=2)
    assert timing < 0.01 
    assert value == 3

def test_function_timeout():
    def function_timeout():
        time.sleep(1)

    try:
        timing = time_function_with_timeout(function_timeout, 0.5)
    except TimeoutError:
        assert True
    else:
        assert False





