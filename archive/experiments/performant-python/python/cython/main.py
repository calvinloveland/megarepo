import os

if os.system("python setup.py build_ext --inplace") != 0:
    raise RuntimeError("Cython build failed.")

# import pstats, cProfile

import cython_mandelbrot

cython_mandelbrot.optimized_cython_generate_set()

# cProfile.runctx("cython_mandelbrot.optimized_cython_generate_set()", globals(), locals(), "Profile.prof")

# s = pstats.Stats("Profile.prof")
# s.strip_dirs().sort_stats("time").print_stats()
