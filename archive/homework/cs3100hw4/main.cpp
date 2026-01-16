#include<iostream>
#include<sstream>
#include<string>
#include<vector>
#include<signal.h>

#include "handle.hpp"

using namespace std;

vector<string> split(string split){
	istringstream splitStream(split);
	string temp;

	vector<string> returnVector;
	while(std::getline(splitStream, temp, ' ')) {
			returnVector.push_back(temp);
	}
	return returnVector;
}

void doNothing(int useless){}

int main(int argc, char *argv[]){
		signal(SIGINT,doNothing);
		Handler handler;
		bool exit = false;
		while(!exit){
			cout << "["<<handler.cwd()<<"]:";
			string command;
			if(getline(cin,command)){
				if (command != "exit"){
					vector<string> commandVector = split(command);
					handler.handle(commandVector);
				}
				else{
						exit = true;
				}
			}
		}
}



