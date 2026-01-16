#include<math.h>

#include"c++lang.hpp"

extern bool quittingTime;

void divide() {
		while(!quittingTime && 4/2 == 2){}
}
void squareRoot() {
		if(sqrt(9) == 3){}
}
void allocate(bool safe){
		while(!quittingTime){
		int * test = new int[10];
		if(safe){
				delete test;
		}
		}
}
