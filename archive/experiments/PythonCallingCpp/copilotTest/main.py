



def function_timing_decorator(func):
    def wrapper(*args, **kwargs):
        import time
        start = time.time()
        result = func(*args, **kwargs)
        end = time.time()
        print("{} took {} seconds".format(func.__name__, end-start))
        return result
    return wrapper



if __name__ == '__main__':
    import sys
    sys.path.append('..')