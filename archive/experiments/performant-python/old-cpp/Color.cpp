#include "Color.h"

Color::Color()
{
	r = 0;
	g = 0;
	b = 0;
}

Color::Color(int iterations)
{
	r = 0;
	g = iterations/1;
	b = 0;
}

void Color::print()
{
	std::cout << r <<" ";
	std::cout << g << " ";
	std::cout << b << " ";
}

std::string Color::toString()
{
	return std::to_string(r) + " " + std::to_string(g) + " " + std::to_string(b) + "	";
}
