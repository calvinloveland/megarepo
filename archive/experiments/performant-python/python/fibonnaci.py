import functools

import numpy as np


def loop_fibonnaci(n):
    a, b = 0, 1
    for i in range(n):
        a, b = b, a + b

    return a

def recursive_fibonnaci(n):
    if n <= 1:
        return n
    else:
        return recursive_fibonnaci(n - 1) + recursive_fibonnaci(n - 2)
    
@functools.lru_cache(maxsize=None)
def memoized_fibonnaci(n):
    if n <= 1:
        return n
    else:
        return memoized_fibonnaci(n - 1) + memoized_fibonnaci(n - 2)

def closed_form_fibonnaci(n):
    from decimal import Decimal
    sqrt5 = Decimal(5).sqrt()
    phi = (1 + sqrt5) / 2
    psi = (1 - sqrt5) / 2
    return int((phi ** n - psi ** n) / sqrt5)



def matrix_exponentiation_fibonnaci(n):
    if n == 0:
        return 0
    elif n == 1:
        return 1
    else:
        matrix = np.array([[1, 1], [1, 0]])
        return np.linalg.matrix_power(matrix, n - 1)[0][0]
    
def time_function_subsecond(f, n):
    import time
    start = time.perf_counter()
    f(n)
    end = time.perf_counter()
    return end - start

def display_results(data, title, xlabel, ylabel, legend,loglog=False):
    import matplotlib.pyplot as plt
    if loglog:
        plt.loglog()
        plt.title(title)
        plt.xlabel(xlabel)
        plt.ylabel(ylabel)
        for i in range(len(data)):
            plt.plot(data[i][0], data[i][1], label=legend[i])
        plt.legend()
        plt.show()
    else:
        plt.figure()
        plt.title(title)
        plt.xlabel(xlabel)
        plt.ylabel(ylabel)
        for i in range(len(data)):
            plt.plot(data[i][0], data[i][1], label=legend[i])
        plt.legend()
        plt.show()



def main():
    import numpy as np


    # Plot the time taken for each function on a log-log scale
    # Display each graph on it's own before showing a combined graph


if __name__ == '__main__':
    main()