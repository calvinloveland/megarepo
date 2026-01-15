#pragma once
#include "Color.h"


class PixelCheck {
public:
	PixelCheck(int h,int w);
	Color checkPixel(int x,int y);
private:
	int checkPixelIterations(int x, int y);
	int height, width;
	const int MAX_ITERATIONS = 255;
};