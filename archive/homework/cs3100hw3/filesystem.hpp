#pragma once

#include<unistd.h>
#include<string>
#include<iostream>
#include<fstream>
#include<sys/stat.h>
#include<fcntl.h>

std::string whereAmI();
void changeDirectory();
void checkAccess();
void commitToDisk();
void changeOwner();
void duplicate();
