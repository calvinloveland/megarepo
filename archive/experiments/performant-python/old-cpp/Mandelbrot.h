#pragma once
#include <vector>
#include <thread>
#include "PixelCheck.h"
#include "PPM.h"
class Mandelbrot {
public:
	Mandelbrot(int h,int w);
	void generate();
	void print();
private:
	void checkPixel(int i,int j);
	PixelCheck* pc;
	Color* map;
	int height, width;
};