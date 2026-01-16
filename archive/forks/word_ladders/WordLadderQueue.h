#pragma once

#include "DoublyLinkedList.cpp"
#include "Dictionary.h"
#include <set>

class WordLadderQueue {
private:
	Dictionary currentDict;
	DoublyLinkedList<vector<string>> queue;
	set<string> usedWords;
	vector<string> findPossibilities(string);
public:
	WordLadderQueue(int wordSize);
	vector<string> findLadder(string,string);
	vector<string> findLadder(string,int);
	vector<string> findLadder(int, string);
	vector<string> findLadder(int);
};