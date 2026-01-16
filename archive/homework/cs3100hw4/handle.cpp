#include "handle.hpp"
#include "history.hpp"

const int WRITE = 1;
const int READ = 0;


Handler::Handler(){
	history = History();
	dirs = Dirs();
	pipeOut = false;
	pipeIn = false;
	
}

string Handler::vstos(vector<string> vs){
	string returnString = "";
	for(int i = 0; i < vs.size()-1; i++){
		returnString += vs[i] + " ";
	}
	returnString += vs[vs.size()-1];
	return returnString;
}

char ** Handler::vstocpp(vector<string> vs){
	char ** r = (char**)malloc(vstos(vs).length()*sizeof(char));
	for(int i = 0; i < vs.size(); i ++){
		r[i] = (char*)vs[i].c_str();
	}
	r[vs.size()] = (char*)NULL;
	return r;
}

string Handler::cwd(){
	char buffer[64];
	string r = getcwd(buffer, sizeof(buffer));
	return r;
}

int Handler::findPipe(vector<string> v){
	int location = find(begin(v),end(v),"|") - begin(v);
	if(location == end(v) -begin(v)){
		return -1;
	}
	else{
		return location;
	}
}

int Handler::handle(vector<string> args){
	if(args.size() > 0){
		auto start = chrono::system_clock::now();
		string command = args[0];
		//cout << "Command:"<< command;
		history.add(args);	
		int pipePos = findPipe(args);

		bool die = false;
		
		//cout << pipePos << endl;
		
		if(pipePos != -1){
			pipe(currentPipe);
			vector<string> secondArgs = vector<string>(begin(args) + pipePos +1, end(args));
			args = vector<string>(begin(args), begin(args) + pipePos);
			//cout <<"FIRST:" <<vstos(args) << "SECOND:"<< vstos(secondArgs)<<endl;
			if(fork() == 0){
				pipeIn = true;
				args = secondArgs;
				//handle(secondArgs);
				//_exit(0);
				die = true;
			}
			else{
				pipeOut = true;
			}	
		}

		if(command == "^"){
			handle(history.get(stoi(args[1])));
		}
		else if(command == "ptime"){
			cout << "Time spent executing child processes: " << ptime << " milliseconds" << endl;
		}
		else if(command == "history"){
			history.print();
		}
		else if(command == "cd"){
			char* directory = (char*)args[1].c_str();
			chdir(directory);
		}
		else if(command == "pwd"){
			cout << cwd() << endl;
		}
		else if(command == "dirs"){
			dirs.print();
		}
		else if(command == "popd"){
			cout << dirs.pop();
		}
		else if(command == "pushd"){
			dirs.push(args[1]);
		}
		else{
			if(fork() == 0){
				if(pipeIn){

					cout << "Piping in:" << vstos(args);
					dup2(currentPipe[READ], STDIN_FILENO);
					pipeIn = false;

				}
				else if(pipeOut){

					cout << "Piping out:" << vstos(args);
					dup2(currentPipe[WRITE], STDOUT_FILENO);
					pipeOut = false;

				}
				else{
				cout<<"NOT PIPING";
				}


				char ** execArgs = vstocpp(args);
				
				execvp(execArgs[0],execArgs);
				cout <<args[0] << " Command not found" << endl;
				_exit(1);
			}
			else{
				int wstatus;	
				wait(&wstatus);
				if(die){
					_exit(0);
				}
				cout << endl;
			}
		}

		auto end = chrono::system_clock::now();
		ptime = chrono::duration<double,milli>((end-start)).count();
	}
	return 0;
}
