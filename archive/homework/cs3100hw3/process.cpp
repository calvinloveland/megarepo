#include"process.hpp"

void sendSig(int sigInt){
	kill(getpid(),sigInt);
}

int time(){
	return clock() / CLOCKS_PER_SEC;
}

void sleep(int nanoseconds){
	struct timespec tim;
	tim.tv_sec = 0;
	tim.tv_nsec = nanoseconds;
	nanosleep(&tim,NULL);
}

void birth(){
	if(fork() > 0){
			wait(NULL);
	}
	else{
			_exit(0);
	}
}
