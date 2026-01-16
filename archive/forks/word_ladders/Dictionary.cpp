

#include "Dictionary.h"

Dictionary::Dictionary(int n) {
	string line;
	ifstream myfile("dictionary.txt");
	if (myfile.is_open())
	{
		while (getline(myfile, line))
		{
			if (line.length() == (unsigned)n) {
				words.push_back(line);
			}
		}
		myfile.close();
	}
	else {
		cout << "Can't find file";
	}
}
Dictionary::Dictionary() {
	Dictionary(1);
}
bool Dictionary::isWord(string word) {
	return binary_search(words.begin(),words.end(), word);
}

string Dictionary::randWord() {
	return words[rand() % words.size()];
}



