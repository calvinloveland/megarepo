#include "compute-e.hpp"

long double factorial(int n) {
	if (n == 1) {
		return 1;
	}
	return n * factorial(n - 1);
}

long double e(int n) {
	if (n == 0) {
		return 2; // Janky? Yes. Works? Also yes.
	}
	return ((long double)(2 * n + 2)) / (factorial(2 * n + 1)) +
	       e(n - 1); // Doesn't do anything past like n=15 shhhhh
}
