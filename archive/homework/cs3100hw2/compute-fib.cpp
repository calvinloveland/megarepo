#include "compute-fib.hpp"

int fib(int n) {
	if (n <= 0) {
		return 0;
	}
	if (n == 1) {
		return 1;
	}
	return fib(n - 1) +
	       fib(n - 2); // This is not the best way to do this. Fibonacci has a closed form
}
