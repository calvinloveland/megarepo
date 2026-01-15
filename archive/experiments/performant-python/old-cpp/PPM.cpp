#include "PPM.h"

PPM::PPM(std::string fileName,Color* map,int width,int height)
{
	std::ofstream output;
	output.open(fileName);
	output << "P3\n" << width << " " << height << "\n255\n";
	for (int i = 0; i < width; i++) {
		for (int j = 0; j < height; j++) {
			output<< map[(i*width) + j].toString();
		}
		output << "\n";
		std::cout << ((double)i / (double)width) * 100 << "% done writing\r";
	}
	std::cout << "\n";
	output.close();
}
