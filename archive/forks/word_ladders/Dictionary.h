#ifndef DICTIONARY
#define DICTIONARY


#include <string>
#include <iostream>
#include <vector>
#include <algorithm>
#include <fstream>

using namespace std;

class Dictionary {
private:
	vector<string> words;
public:
	Dictionary();
	Dictionary(int);
	bool isWord(string);
	string randWord();
};

#endif