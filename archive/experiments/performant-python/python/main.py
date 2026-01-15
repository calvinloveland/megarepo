import numpy
import colorsys

import numba
import os
import multiprocessing

def timer_decorator(func):
    """
    A decorator for timing functions.
    """
    import time

    def wrapper():
        start = time.time()
        value = func()
        end = time.time()
        print("Time taken for function {}: {:0.3f}".format(func.__name__, end - start))
        return value

    return wrapper

def mandelbrot_point(x, y):
    """
    Generate the mandelbrot set using an interative algorithm.
    """
    x_min, x_max = -2.0, 1.0
    y_min, y_max = -1.0, 1.0
    width, height = 2000, 2000
    max_iterations = 1000

    x_step = (x_max - x_min) / width
    y_step = (y_max - y_min) / height

    c = complex(x * x_step + x_min, y * y_step + y_min)
    z = 0.0j
    iteration = 0

    while abs(z) < 2 and iteration < max_iterations:
        z = z * z + c
        iteration += 1

    return iteration


def mandelbrot_row(y):
    """
    Generate the mandelbrot set using an interative algorithm.
    """
    x_min, x_max = -2.0, 1.0
    y_min, y_max = -1.0, 1.0
    width, height = 2000, 2000
    max_iterations = 1000

    x_step = (x_max - x_min) / width
    y_step = (y_max - y_min) / height

    mandelbrot_row = numpy.zeros(width)

    for x in range(width):
        c = complex(x * x_step + x_min, y * y_step + y_min)
        z = 0.0j
        iteration = 0

        while abs(z) < 2 and iteration < max_iterations:
            z = z * z + c
            iteration += 1

        mandelbrot_row[x] = iteration

    return mandelbrot_row

@timer_decorator
def pure_python_generate_set():
    """
    Generate the mandelbrot set using an interative algorithm.
    """
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


@timer_decorator
def multiprocessing_generate_set():
    """
    Generate the mandelbrot set using an interative algorithm.
    """
    width, height = 2000, 2000


    process_count = os.cpu_count()
    mandelbrot_set = numpy.zeros((height, width))

    async_rows = []

    with multiprocessing.Pool(process_count) as p:
        for y in range(height):
            async_rows.append(p.apply_async(mandelbrot_row, args=(y,)))
        for y in range(height):
            mandelbrot_set[y] = async_rows[y].get()

    
    return mandelbrot_set

@timer_decorator
@numba.jit(nopython=True)
def numba_jit_generate_set():
    """
    Generate the mandelbrot set using an interative algorithm.
    """
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


def mandelbrot_iterations_to_colors(iterations_array):
    height, width = iterations_array.shape
    colors = numpy.zeros((height, width, 3))
    precision = numpy.amax(iterations_array)
    for x in range(height):
        for y in range(width):
            color = (iterations_array[y, x] + 1) / (precision + 1)
            rgb = colorsys.hsv_to_rgb(color, (color / 2 + 0.4), (color / 2 + 0.4))
            if max(rgb) > 1:
                print(rgb)
            colors[y, x] = numpy.array(tuple(rgb))
    return colors


def set_to_picture(mandelbrot_set_colors):
    """
    Convert the mandelbrot set to a picture.
    """
    import matplotlib.pyplot as plt

    plt.imshow(mandelbrot_set_colors)
    plt.axis("off")
    plt.show()


if __name__ == "__main__":
    set_to_picture(mandelbrot_iterations_to_colors(pure_python_generate_set()))
    set_to_picture(mandelbrot_iterations_to_colors(multiprocessing_generate_set()))
    # set_to_picture(mandelbrot_iterations_to_colors(numba_jit_generate_set()))
    # m_set = numba_jit_generate_set()
    # print(m_set[500][500])
    # print(m_set[1000][1000])
    # print(m_set[750][750])
    # print(m_set[751][750])
