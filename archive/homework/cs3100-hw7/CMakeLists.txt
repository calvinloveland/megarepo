cmake_minimum_required (VERSION 3.0)
project (BeladysAnomaly)

if (CMAKE_COMPILER_IS_GNUCXX)
    set(CMAKE_CXX_FLAGS "-std=c++11 -pthread -O3 ${CMAKE_CXX_FLAGS}")
endif()

add_executable(BeladysAnomaly
	main.cpp
)
