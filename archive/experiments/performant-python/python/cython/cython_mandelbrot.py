# cython: profile=True

import numpy
import cython

def timer_decorator(func):
    """
    A decorator for timing functions.
    """
    import time
    def wrapper():
        start = time.time()
        value = func()
        end = time.time()
        print("Time taken for function {}: {:0.3f}".format(func.__name__,end - start))
        return value
    return wrapper

@timer_decorator
def cython_generate_set():
    """
    Generate the mandelbrot set using an interative algorithm.
    """
    if cython.compiled:
        print("Compiled")
    else:
        print("Not compiled")
    x_min, x_max = -2.0, 1.0
    y_min, y_max = -1.0, 1.0
    width, height = 2000, 2000
    max_iterations = 1000

    x_step = (x_max - x_min) / width
    y_step = (y_max - y_min) / height

    mandelbrot_set = numpy.zeros((height, width))

    for y in range(height):
        for x in range(width):
            c = complex(x * x_step + x_min, y * y_step + y_min)
            z = 0.0j
            iteration = 0

            while abs(z) < 2 and iteration < max_iterations:
                z = z * z + c
                iteration += 1

            mandelbrot_set[y, x] = iteration
    return mandelbrot_set
