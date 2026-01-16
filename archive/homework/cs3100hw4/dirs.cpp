#include"dirs.hpp"

Dirs::Dirs(){

}

string Dirs::pop(){
	if(!dirStack.empty()){
		string r = dirStack.back();
		dirStack.pop_back();
		return r;
	}
	return "Directory stack empty";
}

void Dirs::push(string s){
	dirStack.push_back(s);
}

void Dirs::print(){
	for(int i = 0;i < dirStack.size(); i++){
		cout << dirStack[i] << endl;
	}
}
