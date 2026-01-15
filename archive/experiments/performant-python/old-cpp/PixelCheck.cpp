#include "PixelCheck.h"

PixelCheck::PixelCheck(int h, int w)
{
	height = h;
	width = w;
}

Color PixelCheck::checkPixel(int x, int y)
{
	return Color(checkPixelIterations(x,y));
}


/*
For each pixel (Px, Py) on the screen, do:
{
x0 = scaled x coordinate of pixel (scaled to lie in the Mandelbrot X scale (-2.5, 1))
y0 = scaled y coordinate of pixel (scaled to lie in the Mandelbrot Y scale (-1, 1))
x = 0.0
y = 0.0
iteration = 0
max_iteration = 1000
while (x*x + y*y < 2*2  AND  iteration < max_iteration) {
xtemp = x*x - y*y + x0
y = 2*x*y + y0
x = xtemp
iteration = iteration + 1
}
color = palette[iteration]
plot(Px, Py, color)
}*/
int PixelCheck::checkPixelIterations(int xPos, int yPos)
{
	double x0 = (((double)xPos / (double)width)*3.5) - 2.5;
	double y0 = (((double)yPos / (double)height)*2) - 1;
	double x = 0.0;
	double y = 0.0;
	int iterations = 0;
	while (x*x + y*y < 2 * 2 && iterations < MAX_ITERATIONS) {
		double xtemp = x*x - y*y + x0;
		y = 2 * x*y + y0;
		x = xtemp;
		iterations++;
	}
	return iterations;
}
