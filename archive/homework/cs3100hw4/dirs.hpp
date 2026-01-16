#include<vector>
#include<string>
#include<iostream>

using namespace std;

class Dirs{
	public:
		Dirs();
		string pop();
		void push(string);
		void print();
	private:
		vector<string> dirStack;
};
