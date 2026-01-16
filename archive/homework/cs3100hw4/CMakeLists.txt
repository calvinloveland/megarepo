cmake_minimum_required(VERSION 3.0)
project(CShell)

if (CMAKE_COMPILER_IS_GNUCXX)
    set(CMAKE_CXX_FLAGS "-std=c++11 -O0 ${CMAKE_CXX_FLAGS}")
endif()

add_executable(CShell main.cpp handle.cpp history.cpp dirs.cpp)
