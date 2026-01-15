#include "WordLadderQueue.h"

vector<string> WordLadderQueue::findPossibilities(string word) {
	vector<string> returnVector;
	string orig = word;
	for (size_t i = 0; i < word.length(); i++)
	{
		for (size_t j = 0; j < 26; j++)
		{
			word[i] = 'a' + j;
			if (usedWords.find(word) == usedWords.end()) {
				usedWords.insert(word);
				if (currentDict.isWord(word)) {
					returnVector.push_back(word);
				}
			}

		}
		word = orig;
	}
	return returnVector;
}

WordLadderQueue::WordLadderQueue(int wordSize)
{
	currentDict = Dictionary(wordSize);
}

vector<string> WordLadderQueue::findLadder(string begin, string end) {
	if (begin.length() != end.length()) {
		cout  << begin << " and " << end << " are not the same size" <<" \n";
		vector<string> empty;
		return empty;
	}
	currentDict = Dictionary(begin.length());
	int currentLadderLength = 0;
	vector<string> start;
	start.push_back(begin);
	queue.push(start);
	while (queue.length() > 0) {
		//cout << queue.length()<< "\n";
		vector<string> next = queue.pop();
		if (next.size() > currentLadderLength) {
			currentLadderLength++;
			cout << "Searching ladders length: " << currentLadderLength << "\n";
		}
		vector<string> possibilites = findPossibilities(next[next.size()-1]);
		for (size_t i = 0; i < possibilites.size(); i++)
		{
			if (possibilites[i] == end) {
				next.push_back(possibilites[i]);
				return next;
			}
			vector<string> newPossibility;
			newPossibility = next;
			newPossibility.push_back(possibilites[i]);
			queue.push(newPossibility);
		}
	}
	cout << "No ladder exists between " << begin << " and " <<  end << " \n";
	vector<string> empty;
	return empty;
}
vector<string> WordLadderQueue::findLadder(string begin,int n) {
	return findLadder(begin, currentDict.randWord());
}
vector<string> WordLadderQueue::findLadder(int n,  string end) {
	return findLadder(currentDict.randWord(), end);
}
vector<string> WordLadderQueue::findLadder(int n) {
	return findLadder(currentDict.randWord(),currentDict.randWord());
}