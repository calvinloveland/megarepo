#include "history.hpp"

History::History(){

}

void History::add(vector<string> commandVector){
	history.push_back(commandVector);
}

vector<string> History::get(int count){
		return history[count - 1];
}

void History::print(){
	cout << "-- Command History --" << endl << endl;
	for(int i = 0; i < history.size(); i++){
		cout << (i+1) << " : ";
		for( int j = 0; j < history[i].size(); j++){
				cout << history[i][j] << " ";
		}
		cout << endl;
	}
}
