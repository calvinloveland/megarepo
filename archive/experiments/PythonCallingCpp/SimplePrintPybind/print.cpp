#include <pybind11/pybind11.h>
#include <string>
#include <iostream>

int add(int i, int j) {
    return i + j;
}

void print(std::string s){
    std::cout << s << std::endl;
}

PYBIND11_MODULE(example, m) {
    m.doc() = "pybind11 example plugin"; // optional module docstring

    m.def("add", &add, "A function which adds two numbers");

    m.def("print", &print, "A function to print a string");
}