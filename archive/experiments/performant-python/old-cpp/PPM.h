#pragma once
#include <string>
#include <fstream>
#include <iostream>
#include "Color.h"
class PPM {
public:
	PPM(std::string fileName,Color* map,int width, int height);
};