import numpy
import cython

DTYPE = numpy.intc

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
def optimized_cython_generate_set():
    """
    Generate the mandelbrot set using an interative algorithm.
    """
    cdef double x_min = -2.0
    cdef double x_max =  1.0
    cdef double y_min = -1.0
    cdef double y_max = 1.0
    cdef int width = 2000
    cdef int height = 2000
    cdef int max_iterations = 1000
    cdef int x
    cdef int y
    cdef int iteration 

    cdef double x_step = (x_max - x_min) / width
    cdef double y_step = (y_max - y_min) / height

    cdef double complex c
    cdef double complex z

    mandelbrot_set = numpy.zeros((height, width), dtype=DTYPE)
    if cython.compiled:
        print("Compiled")
    else:
        print("Not compiled")
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