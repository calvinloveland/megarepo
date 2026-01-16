#include "WordLadderQueue.h"


using namespace std;
int main() {
	while (true) {
		string begin;
		string end;
		cout << "Enter first word, enter 'r' for a random word: ";
		cin >> begin;
		cout << "Enter second word, enter 'r' for a random word: ";
		cin >> end;
		vector<string> foundLadder;
		if (begin != "r") {
			if (end != "r") {
				WordLadderQueue wlq(begin.length());
				foundLadder = wlq.findLadder(begin, end);
			}
			else {
				WordLadderQueue wlq(begin.length());
				foundLadder = wlq.findLadder(begin, begin.length());
			}
		}
		else if (end != "r")
		{
			WordLadderQueue wlq(end.length());
			foundLadder = wlq.findLadder(end.length(), end);
		}
		else {
			int n = rand() % 8+2;
			WordLadderQueue wlq(n);
			foundLadder = wlq.findLadder(n);
		}
		for (size_t i = 0; i < foundLadder.size(); i++)
		{
			cout << foundLadder[i] << "\n";
		}
	}
}