#pragma once

#include<iostream>
#include<vector>
#include<string>

using namespace std;

class History{
		public:
			History();
			void add(vector<string>);
			vector<string> get(int);
			void print();
		private:
			vector<vector<string>> history;
};
