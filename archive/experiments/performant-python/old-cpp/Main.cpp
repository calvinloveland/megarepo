#include "Mandelbrot.h"
#include <iostream>
#include <cstdio>
#include <ctime>

int main() {
	std::clock_t start = std::clock();
	Mandelbrot mandelbrot1(1000,1000);
	double initializingTime = (std::clock() - start) / (double)CLOCKS_PER_SEC;
	start = std::clock();
	mandelbrot1.generate();
	double generatingTime = (std::clock() - start) / (double)CLOCKS_PER_SEC;
	start = std::clock();
	mandelbrot1.print();
	double printingTime = (std::clock() - start) / (double)CLOCKS_PER_SEC;
	std::cout << "Done!\n" << "Initialization time: " << initializingTime << " Generation time: " << generatingTime << " Printing time: " << printingTime;
	int n;
	std::cin >> n;
	return 0;
}