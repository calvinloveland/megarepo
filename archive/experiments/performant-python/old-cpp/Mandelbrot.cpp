#include "Mandelbrot.h"



Mandelbrot::Mandelbrot(int h, int w)
{
	height = h;
	width = w;
	pc = new PixelCheck(height,width);
	map = new Color[height*width];
}

void Mandelbrot::generate()
{
	//vector<thread> threads;

	for (int i=0; i < width; i++) {
		for (int j = 0; j < height; j++) {
			//threads.push_back(thread(checkPixel, i, j));
			checkPixel(i,j);
			//map[(i*width) + j].print();
		}
		std::cout << ((double)i/(double)width) * 100  << "% done generating\r";
		
	}
	std::cout << "\n";
	/*for(thread& th : threads)
	{
		th.join();
	}*/
}

void Mandelbrot::print()
{
	PPM ppm("output.ppm",map,width,height);
}

void Mandelbrot::checkPixel(int i, int j)
{
	map[(i*width) + j] = pc->checkPixel(i, j);
}
