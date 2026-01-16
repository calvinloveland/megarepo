#pragma once

#include<vector>
#include<string>
#include<iostream>
#include<chrono>
#include<ctime>
#include<stdio.h>
#include<unistd.h>
#include <sys/types.h>
#include <bits/stdc++.h>
#include <sys/wait.h>



#include"history.hpp"
#include"dirs.hpp"

using namespace std;

class Handler{
	public:
		Handler();
		int handle(vector<string>);
		string cwd();
	private:
		History history;
		Dirs dirs;
		double ptime;
		bool pipeOut;
		bool pipeIn;
		int currentPipe[];

		string vstos(vector<string>);
		char** vstocpp(vector<string>);
		int findPipe(vector<string>);
};
