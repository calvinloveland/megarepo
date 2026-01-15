#pragma once
#include <iostream>
#include <string>

using namespace std;

class Color {
public:
	int r, g, b;
	Color();
	Color(int iterations);
	void print();
	std::string toString();
};